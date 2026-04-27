import "server-only";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  appendFileSync,
  rmSync,
  statSync,
  openSync,
  closeSync,
  readSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "..");
const JOBS_DIR = join(REPO_ROOT, "generated", "jobs");
const EXTRACT_PY = join(REPO_ROOT, "scripts", "extract.py");
const PROPOSE_DOMAIN_PY = join(REPO_ROOT, "scripts", "propose_domain.py");

export type JobStatus = "pending" | "running" | "done" | "error";
export type JobType = "ingest-pdf" | "ingest-url" | "propose-domain";

export interface JobLogLine {
  ts: number;
  text: string;
  stream: "stdout" | "stderr" | "system";
}

export interface JobUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface Job {
  id: string;
  type: JobType;
  source: string;
  // For ingest-*: existing domain id. For propose-domain: the proposed id.
  domainId: string;
  status: JobStatus;
  log: JobLogLine[];
  createdAt: Date;
  completedAt?: Date;
  exitCode?: number;
  // Populated by propose-domain jobs once the script logs the draft path.
  draftPath?: string;
  // Token usage summed across all LLM calls in the job.
  usage?: JobUsage;
  // For file-upload jobs: absolute path to the uploaded PDF, kept on disk
  // alongside the job so the user can download/preview it later.
  sourceFile?: string;
  // Original filename + size for nicer UI display.
  sourceFilename?: string;
  sourceSize?: number;
  // OS pid of the spawned subprocess. Persisted so a Node restart can
  // check `process.kill(pid, 0)` to see if the child is still running
  // (detached subprocesses survive parent death; the close-event listener
  // does not).
  pid?: number;
  // Byte offsets into stdout.log / stderr.log that have already been
  // converted into JSON-encoded lines in log.ndjson. Persisted so the
  // tailer can resume after a Node restart without losing or duplicating
  // output.
  tailerPos?: { stdout: number; stderr: number };
}

type Subscriber = (line: JobLogLine | null, status: JobStatus) => void;

// In Next.js (esp. dev with HMR), route handlers and server components can
// resolve to different module instances, each with their own copy of file-
// scoped state. Stash the in-memory job store on globalThis so all callers
// see the same Map regardless of which graph loaded this module.
const globalForJobs = globalThis as unknown as {
  __sapkbJobs?: Map<string, Job>;
  __sapkbSubscribers?: Map<string, Set<Subscriber>>;
  __sapkbHydrated?: boolean;
  // Active log tailers (one per running job). Stashed on globalThis so HMR
  // doesn't double up the timers when this module reloads.
  __sapkbTailers?: Map<string, NodeJS.Timeout>;
};
const jobs: Map<string, Job> = (globalForJobs.__sapkbJobs ??= new Map());
const subscribers: Map<string, Set<Subscriber>> = (globalForJobs.__sapkbSubscribers ??= new Map());
const tailers: Map<string, NodeJS.Timeout> = (globalForJobs.__sapkbTailers ??= new Map());

// On first import after a process restart, rehydrate from disk and reap any
// orphaned non-terminal jobs (their child processes died with the old
// process). Without this, an HMR-killed run would silently disappear from
// the UI.
if (!globalForJobs.__sapkbHydrated) {
  hydrateFromDisk();
  globalForJobs.__sapkbHydrated = true;
}

function uuid(): string {
  return crypto.randomUUID();
}

function jobDir(jobId: string): string {
  return join(JOBS_DIR, jobId);
}

function metaPath(jobId: string): string {
  return join(jobDir(jobId), "meta.json");
}

function logPath(jobId: string): string {
  return join(jobDir(jobId), "log.ndjson");
}

export function relativeLogPath(jobId: string): string {
  return `generated/jobs/${jobId}/log.ndjson`;
}

// Raw subprocess stdio goes here (one file each, plain text). The tailer
// converts these into JSON-encoded lines in log.ndjson. Keeping the raw
// files separately means a detached subprocess can keep writing even
// after the Node parent dies — the parent's tailer + log.ndjson resume
// from a persisted byte offset on the next hydrate.
function stdoutLogPath(jobId: string): string {
  return join(jobDir(jobId), "stdout.log");
}
function stderrLogPath(jobId: string): string {
  return join(jobDir(jobId), "stderr.log");
}
// Sentinel written by the sh wrapper after the python script exits.
// Lets the orphan reaper recover the true exit code even if the parent
// died before child.on('close') could fire.
function exitCodePath(jobId: string): string {
  return join(jobDir(jobId), "exit.code");
}

// POSIX shell escape for arbitrary strings used in `sh -c "..."`. The
// only metacharacter we have to defend against in practice is the path
// separator and spaces in filenames; single-quote wrapping handles both.
function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_./=:@%+-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// `process.kill(pid, 0)` is the standard "is this PID alive?" probe —
// signal 0 doesn't actually send a signal, just exercises the
// permission/existence check. ESRCH means the process is gone; EPERM
// means it exists but we can't signal it (different user) — still alive
// from our perspective.
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface JobMetaOnDisk {
  id: string;
  type: JobType;
  source: string;
  domainId: string;
  status: JobStatus;
  createdAt: string;
  completedAt?: string;
  exitCode?: number;
  draftPath?: string;
  usage?: JobUsage;
  sourceFile?: string;
  sourceFilename?: string;
  sourceSize?: number;
  pid?: number;
  tailerPos?: { stdout: number; stderr: number };
}

function persistMeta(job: Job): void {
  const meta: JobMetaOnDisk = {
    id: job.id,
    type: job.type,
    source: job.source,
    domainId: job.domainId,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    exitCode: job.exitCode,
    draftPath: job.draftPath,
    usage: job.usage,
    sourceFile: job.sourceFile,
    sourceFilename: job.sourceFilename,
    sourceSize: job.sourceSize,
    pid: job.pid,
    tailerPos: job.tailerPos,
  };
  try {
    mkdirSync(jobDir(job.id), { recursive: true });
    writeFileSync(metaPath(job.id), JSON.stringify(meta, null, 2) + "\n");
  } catch {
    // Disk write failures shouldn't crash the in-memory flow.
  }
}

function persistLogLine(jobId: string, line: JobLogLine): void {
  try {
    appendFileSync(logPath(jobId), JSON.stringify(line) + "\n");
  } catch {
    // ignore
  }
}

function loadJobFromDisk(jobId: string): Job | undefined {
  const mp = metaPath(jobId);
  if (!existsSync(mp)) return undefined;
  let meta: JobMetaOnDisk;
  try {
    meta = JSON.parse(readFileSync(mp, "utf-8"));
  } catch {
    return undefined;
  }
  const log: JobLogLine[] = [];
  const lp = logPath(jobId);
  if (existsSync(lp)) {
    const raw = readFileSync(lp, "utf-8");
    for (const ln of raw.split("\n")) {
      if (!ln) continue;
      try {
        log.push(JSON.parse(ln) as JobLogLine);
      } catch {
        // skip malformed
      }
    }
  }
  return {
    id: meta.id,
    type: meta.type,
    source: meta.source,
    domainId: meta.domainId,
    status: meta.status,
    log,
    createdAt: new Date(meta.createdAt),
    completedAt: meta.completedAt ? new Date(meta.completedAt) : undefined,
    exitCode: meta.exitCode,
    draftPath: meta.draftPath,
    usage: meta.usage,
    sourceFile: meta.sourceFile,
    sourceFilename: meta.sourceFilename,
    sourceSize: meta.sourceSize,
    pid: meta.pid,
    tailerPos: meta.tailerPos,
  };
}

function hydrateFromDisk(): void {
  if (!existsSync(JOBS_DIR)) return;
  let entries: string[];
  try {
    entries = readdirSync(JOBS_DIR);
  } catch {
    return;
  }
  for (const id of entries) {
    const job = loadJobFromDisk(id);
    if (!job) continue;

    // Three cases for non-terminal jobs:
    //
    //   1. PID present and process still alive → subprocess survived
    //      the parent restart (detached). Resume tailing; status stays
    //      `running`; the tailer will flip status when the child exits.
    //
    //   2. PID present but process is gone → subprocess finished while
    //      we were down. Recover the exit code from exit.code (if the
    //      sh wrapper got to write it) and finalize the status.
    //
    //   3. No PID at all → legacy job from before detached spawning,
    //      or one that crashed during spawn. Fall back to the old
    //      "mark errored" behavior.
    if (job.status === "pending" || job.status === "running") {
      jobs.set(job.id, job);
      if (job.pid && isPidAlive(job.pid)) {
        const note: JobLogLine = {
          ts: Date.now(),
          text: `parent restarted; resuming log tail of pid ${job.pid}`,
          stream: "system",
        };
        job.log.push(note);
        persistLogLine(job.id, note);
        startTailer(job.id);
      } else if (job.pid) {
        // Drain the final batch of output the dead subprocess wrote
        // before exiting, then resolve status from exit.code.
        tailOnce(job.id, "stdout");
        tailOnce(job.id, "stderr");
        flushTailerBuffers(job.id);
        let code = -1;
        try {
          const c = readFileSync(exitCodePath(job.id), "utf-8").trim();
          const parsed = parseInt(c, 10);
          if (Number.isFinite(parsed)) code = parsed;
        } catch {
          // No exit.code — child was killed (-9) or never wrote it.
        }
        job.status = code === 0 ? "done" : "error";
        job.exitCode = code;
        job.completedAt = new Date();
        const note: JobLogLine = {
          ts: Date.now(),
          text:
            code >= 0
              ? `subprocess exited ${code} while parent was down`
              : "subprocess exit code unknown (no exit.code file) — likely killed",
          stream: "system",
        };
        job.log.push(note);
        persistLogLine(job.id, note);
        persistMeta(job);
      } else {
        const note: JobLogLine = {
          ts: Date.now(),
          text: "process restarted before completion — run was interrupted",
          stream: "system",
        };
        job.log.push(note);
        persistLogLine(job.id, note);
        job.status = "error";
        job.exitCode = -1;
        job.completedAt = new Date();
        persistMeta(job);
      }
    } else {
      jobs.set(job.id, job);
    }
  }
}

export function getJob(id: string): Job | undefined {
  const cached = jobs.get(id);
  const fromDisk = loadJobFromDisk(id);
  if (!cached && !fromDisk) return undefined;
  if (!cached) {
    jobs.set(fromDisk!.id, fromDisk!);
    return fromDisk;
  }
  if (!fromDisk) return cached;
  // Both exist. Disk is the canonical source of truth for metadata (it
  // can be hand-patched to backfill missing fields like sourceFile on
  // legacy jobs). Memory wins for the log, since live `append()` writes
  // there before flushing to disk.
  const merged: Job = {
    ...cached,
    ...fromDisk,
    log: cached.log.length >= fromDisk.log.length ? cached.log : fromDisk.log,
  };
  jobs.set(id, merged);
  return merged;
}

export function listJobs(): Job[] {
  return Array.from(jobs.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

export type DeleteResult =
  | { ok: true }
  | { ok: false; error: string };

export type CancelResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Send SIGTERM to a running job's subprocess. Idempotent — calling
 * cancel on a job whose subprocess is already gone is a no-op that
 * still flips the in-memory status to `error` so the UI can move on.
 *
 * Why kill the process group (negative pid) instead of just the pid:
 * the spawn wrapper is `sh -c "python3 ...; echo $? > exit.code"`.
 * The pid we recorded is sh's. SIGTERM-ing only sh leaves python
 * orphaned and still spending tokens for several seconds. Killing
 * the whole group (which detached: true creates) takes both down
 * cleanly.
 */
export function cancelJob(id: string): CancelResult {
  const job = getJob(id);
  if (!job) return { ok: false, error: "job not found" };
  if (job.status !== "pending" && job.status !== "running") {
    return { ok: false, error: `job is already ${job.status}` };
  }
  if (!job.pid) {
    // Legacy job from before detached spawning, or spawn never assigned
    // a pid. We can't kill what we can't address; flip to error so the
    // UI stops showing "running" indefinitely.
    append(id, "cancel requested but no pid recorded; marking errored", "system");
    setStatus(id, "error", -1);
    return { ok: true };
  }
  try {
    // Negative pid = process group kill. Detached spawn put the child
    // (and its children) in their own group, with pgid == pid.
    process.kill(-job.pid, "SIGTERM");
    append(id, `cancel requested by user (SIGTERM sent to pgid ${job.pid})`, "system");
    // Don't flip status here — the file tailer's pid-dead branch will
    // pick up exit.code (likely empty since sh got killed mid-write)
    // and finalize. If for some reason that doesn't happen within a
    // few seconds, the user can re-cancel.
    return { ok: true };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      // Process is already gone but our status hadn't caught up yet.
      // Drain the tailer and finalize so the UI doesn't lie.
      append(id, "cancel requested but process already gone; finalizing", "system");
      tailOnce(id, "stdout");
      tailOnce(id, "stderr");
      flushTailerBuffers(id);
      setStatus(id, "error", -1);
      return { ok: true };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Permanently delete a job: removes the in-memory entry, drops any active
 * subscribers, and recursively removes `generated/jobs/<id>/` from disk
 * (meta.json, log.ndjson, source/ if present).
 *
 * Refuses to delete jobs in `pending` or `running` status. Their subprocess
 * is still alive; deleting the disk record would orphan a process that's
 * still spending tokens. Wait for it to finish (or restart the dev server
 * to reap it as an orphan) before deleting.
 *
 * Path safety: `id` is only used as a Map key and via `jobDir(id)` (a join
 * with the fixed JOBS_DIR), so a malicious id can't escape the jobs dir.
 * `rmSync` with `force: true` makes the call idempotent if the disk dir
 * was already removed by hand.
 */
export function deleteJob(id: string): DeleteResult {
  const job = getJob(id);
  if (!job) return { ok: false, error: "job not found" };
  if (job.status === "pending" || job.status === "running") {
    return {
      ok: false,
      error:
        "cannot delete an active job; wait for it to finish or restart the server to reap it",
    };
  }
  // Defensive: stop any leftover tailer before removing the disk dir.
  // Should be a no-op for terminal jobs (the tailer self-stops on
  // pid-dead or close), but a stale interval polling a just-deleted
  // path would log noisy errors otherwise.
  stopTailer(id);
  tailerBufs.delete(id);
  try {
    rmSync(jobDir(id), { recursive: true, force: true });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  jobs.delete(id);
  subscribers.delete(id);
  return { ok: true };
}

/**
 * Bulk-delete every job in `error` status. Convenience wrapper around
 * `deleteJob` since failed runs accumulate during iteration. Returns the
 * count actually deleted (some may have been already gone, race-wise).
 */
export function deleteErroredJobs(): { deleted: number } {
  let deleted = 0;
  for (const job of Array.from(jobs.values())) {
    if (job.status === "error") {
      const r = deleteJob(job.id);
      if (r.ok) deleted++;
    }
  }
  return { deleted };
}

const DRAFT_PATH_RE = /draft written to (.+\.yaml)/;
const USAGE_RE = /usage:\s+input=(\d+)\s+output=(\d+)\s+model=(\S+)/;

function append(jobId: string, text: string, stream: JobLogLine["stream"]): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const line: JobLogLine = { ts: Date.now(), text, stream };
  job.log.push(line);
  persistLogLine(jobId, line);
  // Sniff the propose-domain draft path out of stdout so the UI can offer
  // an Apply button on completion. The script logs a path relative to the
  // repo root; resolve to absolute for downstream consumers.
  if (job.type === "propose-domain" && stream === "stdout") {
    const m = text.match(DRAFT_PATH_RE);
    if (m) {
      job.draftPath = resolve(REPO_ROOT, m[1].trim());
      persistMeta(job);
    }
  }
  // Sniff token usage from any LLM-using script. Sum across calls in case
  // a job makes more than one (it doesn't today, but cheap to be future-
  // proof).
  if (stream === "stdout") {
    const u = text.match(USAGE_RE);
    if (u) {
      const inT = parseInt(u[1], 10);
      const outT = parseInt(u[2], 10);
      const model = u[3];
      const prev = job.usage;
      job.usage = {
        inputTokens: (prev?.inputTokens ?? 0) + inT,
        outputTokens: (prev?.outputTokens ?? 0) + outT,
        model,
      };
      persistMeta(job);
    }
  }
  for (const cb of subscribers.get(jobId) ?? []) cb(line, job.status);
}

function setStatus(jobId: string, status: JobStatus, exitCode?: number): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  if (status === "done" || status === "error") {
    job.completedAt = new Date();
    job.exitCode = exitCode;
  }
  persistMeta(job);
  for (const cb of subscribers.get(jobId) ?? []) cb(null, status);
}

export function subscribe(jobId: string, cb: Subscriber): () => void {
  let set = subscribers.get(jobId);
  if (!set) {
    set = new Set();
    subscribers.set(jobId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) subscribers.delete(jobId);
  };
}

export interface StartUploadOptions {
  domainId: string;
  file: { filename: string; bytes: ArrayBuffer };
}

export interface StartUrlOptions {
  domainId: string;
  url: string;
}

function registerJob(job: Job): void {
  jobs.set(job.id, job);
  mkdirSync(jobDir(job.id), { recursive: true });
  persistMeta(job);
}

async function persistUploadInJob(
  jobId: string,
  file: { filename: string; bytes: ArrayBuffer },
): Promise<{ path: string; safeName: string; size: number }> {
  const safeName = sanitizeFilename(file.filename);
  const dir = join(jobDir(jobId), "source");
  await mkdir(dir, { recursive: true });
  const target = join(dir, safeName);
  await writeFile(target, Buffer.from(file.bytes));
  return { path: target, safeName, size: file.bytes.byteLength };
}

export async function startUploadJob(
  opts: StartUploadOptions,
): Promise<Job> {
  const jobId = uuid();
  const saved = await persistUploadInJob(jobId, opts.file);

  const job: Job = {
    id: jobId,
    type: "ingest-pdf",
    source: saved.path,
    sourceFile: saved.path,
    sourceFilename: saved.safeName,
    sourceSize: saved.size,
    domainId: opts.domainId,
    status: "pending",
    log: [],
    createdAt: new Date(),
  };
  registerJob(job);
  append(
    job.id,
    `saved upload to ${saved.path.replace(REPO_ROOT + "/", "")} (${saved.size.toLocaleString()} bytes)`,
    "system",
  );
  runExtraction(job, ["--domain", opts.domainId, saved.path]);
  return job;
}

export function startUrlJob(opts: StartUrlOptions): Job {
  const job: Job = {
    id: uuid(),
    type: "ingest-url",
    source: opts.url,
    domainId: opts.domainId,
    status: "pending",
    log: [],
    createdAt: new Date(),
  };
  registerJob(job);
  append(job.id, `fetching ${opts.url}`, "system");
  runExtraction(job, ["--domain", opts.domainId, "--url", opts.url]);
  return job;
}

export interface ProposeDomainOptions {
  domainId: string;
  domainName: string;
  sapModule?: string;
  // Exactly one of file/url must be provided.
  file?: { filename: string; bytes: ArrayBuffer };
  url?: string;
}

export async function startProposeDomainJob(
  opts: ProposeDomainOptions,
): Promise<Job> {
  const jobId = uuid();
  const args = [
    "--domain-id", opts.domainId,
    "--domain-name", opts.domainName,
  ];
  if (opts.sapModule) args.push("--sap-module", opts.sapModule);

  let source: string;
  let sourceFile: string | undefined;
  let sourceFilename: string | undefined;
  let sourceSize: number | undefined;
  if (opts.file) {
    const saved = await persistUploadInJob(jobId, opts.file);
    source = saved.path;
    sourceFile = saved.path;
    sourceFilename = saved.safeName;
    sourceSize = saved.size;
    args.push(saved.path);
  } else if (opts.url) {
    source = opts.url;
    args.push("--url", opts.url);
  } else {
    throw new Error("file or url required");
  }

  const job: Job = {
    id: jobId,
    type: "propose-domain",
    source,
    sourceFile,
    sourceFilename,
    sourceSize,
    domainId: opts.domainId,
    status: "pending",
    log: [],
    createdAt: new Date(),
  };
  registerJob(job);
  if (opts.file && sourceFile && sourceSize != null) {
    append(
      job.id,
      `saved upload to ${sourceFile.replace(REPO_ROOT + "/", "")} (${sourceSize.toLocaleString()} bytes)`,
      "system",
    );
  }
  runPython(job, PROPOSE_DOMAIN_PY, args);
  return job;
}

function runExtraction(job: Job, args: string[]): void {
  runPython(job, EXTRACT_PY, args);
}

function runPython(job: Job, scriptPath: string, args: string[]): void {
  const argv = ["python3", scriptPath, ...args];
  append(job.id, `$ ${argv.join(" ")}`, "system");
  setStatus(job.id, "running");

  // Stdio goes to disk files, not parent pipes. Two reasons:
  //   1. Parent pipes close when the parent dies (HMR / restart),
  //      which would crash a detached subprocess on its next write.
  //   2. The on-disk files (stdout.log, stderr.log) are durable —
  //      a new Node process can resume tailing them after restart.
  // The tailer (started below) polls these files and feeds the
  // existing in-memory log + SSE infrastructure via `append()`.
  mkdirSync(jobDir(job.id), { recursive: true });
  const stdoutFd = openSync(stdoutLogPath(job.id), "a");
  const stderrFd = openSync(stderrLogPath(job.id), "a");

  // Wrap in `sh -c` so the shell can write the python exit code to a
  // sentinel file after the script returns. Without this, a parent
  // that dies before child.on('close') fires loses the exit code
  // forever — we'd never know if the run succeeded or failed.
  const escaped = argv.map(shellEscape).join(" ");
  const wrapped = `${escaped} ; echo $? > ${shellEscape(exitCodePath(job.id))}`;

  const child = spawn("sh", ["-c", wrapped], {
    cwd: REPO_ROOT,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    // detached: true puts the child in its own process group so a
    // SIGTERM to the Node parent doesn't propagate. unref() removes
    // the parent's reference so Node can exit independently.
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
  });
  closeSync(stdoutFd);
  closeSync(stderrFd);
  child.unref();

  job.pid = child.pid;
  job.tailerPos = job.tailerPos ?? { stdout: 0, stderr: 0 };
  persistMeta(job);

  startTailer(job.id);

  // Best-effort completion handlers for the common case (parent stays
  // alive throughout the run). If the parent dies first, the tailer's
  // pid-liveness check handles completion via exit.code on the next
  // hydrate. The two paths are coordinated by status: setStatus is a
  // no-op once status is already terminal.
  child.on("error", (err) => {
    append(job.id, `process error: ${err.message}`, "system");
    stopTailer(job.id);
    setStatus(job.id, "error", -1);
  });
  child.on("close", (code) => {
    // Give the tailer one more poll to drain anything written between
    // our last interval and the close. Then stop it and finalize.
    setTimeout(() => {
      tailOnce(job.id, "stdout");
      tailOnce(job.id, "stderr");
      flushTailerBuffers(job.id);
      stopTailer(job.id);
      const j = jobs.get(job.id);
      if (j && (j.status === "running" || j.status === "pending")) {
        setStatus(job.id, code === 0 ? "done" : "error", code ?? -1);
      }
    }, 500);
  });
}

// Read bytes [start, end) from `path` synchronously. We use sync I/O on
// purpose — the tailer runs on a setInterval; jumping in and out of
// promises here would just add complexity without changing throughput
// (the polled chunks are tiny).
function readRange(path: string, start: number, end: number): string {
  const len = end - start;
  if (len <= 0) return "";
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(len);
    let read = 0;
    while (read < len) {
      const n = readSync(fd, buf, read, len - read, start + read);
      if (n === 0) break;
      read += n;
    }
    return buf.slice(0, read).toString("utf-8");
  } finally {
    closeSync(fd);
  }
}

interface TailerBufs {
  stdoutBuf: string;
  stderrBuf: string;
}
const tailerBufs: Map<string, TailerBufs> = new Map();

// Read any bytes appended to a stream file since the last tail and feed
// completed lines to `append()`. Holds an in-memory buffer for the
// trailing partial line so a chunk that ends mid-line gets joined to the
// next chunk.
function tailOnce(jobId: string, kind: "stdout" | "stderr"): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const path = kind === "stdout" ? stdoutLogPath(jobId) : stderrLogPath(jobId);
  if (!existsSync(path)) return;
  const stat = statSync(path);
  const pos = (job.tailerPos ?? { stdout: 0, stderr: 0 })[kind];
  if (stat.size <= pos) return;
  const text = readRange(path, pos, stat.size);
  const bufs = tailerBufs.get(jobId) ?? { stdoutBuf: "", stderrBuf: "" };
  let combined = (kind === "stdout" ? bufs.stdoutBuf : bufs.stderrBuf) + text;
  const parts = combined.split("\n");
  combined = parts.pop() ?? "";
  for (const line of parts) append(jobId, line, kind);
  if (kind === "stdout") bufs.stdoutBuf = combined;
  else bufs.stderrBuf = combined;
  tailerBufs.set(jobId, bufs);
  job.tailerPos = {
    stdout: kind === "stdout" ? stat.size : (job.tailerPos?.stdout ?? 0),
    stderr: kind === "stderr" ? stat.size : (job.tailerPos?.stderr ?? 0),
  };
  // Persist the position so a parent restart can resume without losing
  // or re-emitting lines. Skip persistence if the job already exited;
  // setStatus's persistMeta will catch the final positions.
  if (job.status === "running" || job.status === "pending") {
    persistMeta(job);
  }
}

function flushTailerBuffers(jobId: string): void {
  const bufs = tailerBufs.get(jobId);
  if (!bufs) return;
  if (bufs.stdoutBuf.length > 0) append(jobId, bufs.stdoutBuf, "stdout");
  if (bufs.stderrBuf.length > 0) append(jobId, bufs.stderrBuf, "stderr");
  tailerBufs.delete(jobId);
}

// Poll-based file tailer. Runs on a 400ms interval — fast enough that
// the live SSE feels responsive, slow enough that the cost is invisible
// for a long-running LLM call. Stops itself when the subprocess pid is
// no longer alive (and reads exit.code to set final status).
function startTailer(jobId: string): void {
  if (tailers.has(jobId)) return;
  const job = jobs.get(jobId);
  if (!job) return;
  const tick = () => {
    const j = jobs.get(jobId);
    if (!j) {
      stopTailer(jobId);
      return;
    }
    tailOnce(jobId, "stdout");
    tailOnce(jobId, "stderr");
    // Detect completion by PID liveness. If the close event in runPython
    // fires first (parent alive case) it'll call stopTailer + setStatus
    // directly. If the parent died and a new parent is running this
    // tailer (resume-after-restart case), this branch is what flips the
    // status from `running` to `done`/`error`.
    if (j.pid && !isPidAlive(j.pid)) {
      // Final read in case the subprocess wrote one last batch between
      // our last poll and exit.
      tailOnce(jobId, "stdout");
      tailOnce(jobId, "stderr");
      flushTailerBuffers(jobId);
      let code = -1;
      try {
        const c = readFileSync(exitCodePath(jobId), "utf-8").trim();
        const parsed = parseInt(c, 10);
        if (Number.isFinite(parsed)) code = parsed;
      } catch {
        // exit.code missing — child died unexpectedly (kill -9, OOM).
        // Leave code = -1 so status flips to error.
      }
      stopTailer(jobId);
      if (j.status === "running" || j.status === "pending") {
        setStatus(jobId, code === 0 ? "done" : "error", code);
      }
    }
  };
  const timer = setInterval(tick, 400);
  tailers.set(jobId, timer);
  // Drain whatever's already on disk before the first interval fires.
  tick();
}

function stopTailer(jobId: string): void {
  const t = tailers.get(jobId);
  if (t) {
    clearInterval(t);
    tailers.delete(jobId);
  }
}

function sanitizeFilename(name: string): string {
  // Strip path separators and odd chars, keep extension.
  const base = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_");
  return base.length > 0 ? base : `upload-${Date.now()}.pdf`;
}

import "server-only";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "..");
const SOURCES_DIR = join(REPO_ROOT, "sources");
const EXTRACT_PY = join(REPO_ROOT, "scripts", "extract.py");

export type JobStatus = "pending" | "running" | "done" | "error";
export type JobType = "ingest-pdf" | "ingest-url";

export interface JobLogLine {
  ts: number;
  text: string;
  stream: "stdout" | "stderr" | "system";
}

export interface Job {
  id: string;
  type: JobType;
  source: string;
  domainId: string;
  status: JobStatus;
  log: JobLogLine[];
  createdAt: Date;
  completedAt?: Date;
  exitCode?: number;
}

type Subscriber = (line: JobLogLine | null, status: JobStatus) => void;

const jobs = new Map<string, Job>();
const subscribers = new Map<string, Set<Subscriber>>();

function uuid(): string {
  return crypto.randomUUID();
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return Array.from(jobs.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

function append(jobId: string, text: string, stream: JobLogLine["stream"]): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const line: JobLogLine = { ts: Date.now(), text, stream };
  job.log.push(line);
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

export async function startUploadJob(
  opts: StartUploadOptions,
): Promise<Job> {
  await mkdir(SOURCES_DIR, { recursive: true });
  const safeName = sanitizeFilename(opts.file.filename);
  const target = join(SOURCES_DIR, safeName);
  await writeFile(target, Buffer.from(opts.file.bytes));

  const job: Job = {
    id: uuid(),
    type: "ingest-pdf",
    source: target,
    domainId: opts.domainId,
    status: "pending",
    log: [],
    createdAt: new Date(),
  };
  jobs.set(job.id, job);
  append(job.id, `saved upload to ${target.replace(REPO_ROOT + "/", "")}`, "system");
  runExtraction(job, ["--domain", opts.domainId, target]);
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
  jobs.set(job.id, job);
  append(job.id, `fetching ${opts.url}`, "system");
  runExtraction(job, ["--domain", opts.domainId, "--url", opts.url]);
  return job;
}

function runExtraction(job: Job, args: string[]): void {
  const argv = ["python3", EXTRACT_PY, ...args];
  append(job.id, `$ ${argv.join(" ")}`, "system");
  setStatus(job.id, "running");

  const child = spawn(argv[0], argv.slice(1), {
    cwd: REPO_ROOT,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  attachLineStream(job.id, child.stdout, "stdout");
  attachLineStream(job.id, child.stderr, "stderr");

  child.on("error", (err) => {
    append(job.id, `process error: ${err.message}`, "system");
    setStatus(job.id, "error", -1);
  });
  child.on("close", (code) => {
    setStatus(
      job.id,
      code === 0 ? "done" : "error",
      code ?? -1,
    );
  });
}

function attachLineStream(
  jobId: string,
  stream: NodeJS.ReadableStream,
  kind: "stdout" | "stderr",
): void {
  let buffer = "";
  stream.setEncoding("utf-8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) append(jobId, line, kind);
  });
  stream.on("end", () => {
    if (buffer.length > 0) append(jobId, buffer, kind);
  });
}

function sanitizeFilename(name: string): string {
  // Strip path separators and odd chars, keep extension.
  const base = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_");
  return base.length > 0 ? base : `upload-${Date.now()}.pdf`;
}

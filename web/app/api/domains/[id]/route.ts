import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { NextResponse } from "next/server";
import { parseDocument } from "yaml";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { invalidateDomainCache } from "@/lib/yaml";
import schema from "../../../../../schema.json";

export const runtime = "nodejs";

const REPO_ROOT = resolve(process.cwd(), "..");
const DOMAINS_DIR = join(REPO_ROOT, "domains");

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

// Whitelist of paths an admin may edit. Anything not matching is rejected.
// Structural ids (domain.id, table.id, relationship.id, field.name) are
// intentionally excluded because they're load-bearing references — changing
// them would silently break URLs, joins, or annotation targets.
function isEditablePath(path: unknown): path is (string | number)[] {
  if (!Array.isArray(path) || path.length === 0) return false;
  // Each segment must be a string or a non-negative integer. Negative or
  // fractional indexes would let setIn corrupt the YAML structure.
  for (const seg of path) {
    if (typeof seg === "string") continue;
    if (
      typeof seg === "number" &&
      Number.isInteger(seg) &&
      seg >= 0 &&
      seg < 10_000
    )
      continue;
    return false;
  }
  const joined = path
    .map((seg) => (typeof seg === "number" ? "*" : seg))
    .join(".");
  return [
    /^domain\.(name|description|sap_module)$/,
    /^tables\.\*\.(name|description|notes)$/,
    /^tables\.\*\.fields\.\*\.description$/,
    /^relationships\.\*\.description$/,
  ].some((re) => re.test(joined));
}

interface PatchBody {
  path?: unknown;
  value?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json(
      { error: "admin access required to edit domain content" },
      { status: 403 },
    );
  }

  const { id } = await params;
  if (!/^[a-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "invalid domain id" }, { status: 400 });
  }
  const filePath = join(DOMAINS_DIR, `${id}.yaml`);

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  if (!isEditablePath(body.path)) {
    return NextResponse.json(
      { error: "path is not editable (or malformed)" },
      { status: 400 },
    );
  }
  if (typeof body.value !== "string") {
    return NextResponse.json(
      { error: "value must be a string" },
      { status: 400 },
    );
  }
  // Trim trailing whitespace; allow empty for optional fields, but reject
  // an empty value on required fields. Required-ness is enforced by the
  // schema check below — we only normalize here.
  const newValue = body.value.replace(/\s+$/, "");

  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch {
    return NextResponse.json({ error: "domain not found" }, { status: 404 });
  }

  // parseDocument preserves comments and original formatting on toString().
  const doc = parseDocument(text);
  doc.setIn(body.path, newValue);

  // Round-trip into plain JS to schema-validate. If it'd produce an
  // invalid YAML, refuse the edit — the file on disk stays clean.
  const json = doc.toJS();
  if (!validate(json)) {
    const errors = (validate.errors ?? [])
      .map((e) => `${e.instancePath || "<root>"}: ${e.message}`)
      .join("; ");
    return NextResponse.json(
      { error: `edit would invalidate schema: ${errors}` },
      { status: 400 },
    );
  }

  try {
    await writeFile(filePath, doc.toString(), "utf-8");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  invalidateDomainCache();
  return NextResponse.json({ ok: true, value: newValue });
}

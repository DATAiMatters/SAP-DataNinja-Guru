import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import {
  readSettings,
  writeSettings,
  type AppSettings,
} from "@/lib/settings";

export const runtime = "nodejs";

// GET /api/settings — read current app-level settings.
//
// Auth model: admin-only. Settings control which models are used and
// where requests are sent (potentially to local boxes), so signed-in
// non-admins shouldn't be able to redirect the pipeline.
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  return NextResponse.json(readSettings());
}

// POST /api/settings — replace settings wholesale. Caller must send
// every field; this isn't a partial-update API. Validation is light
// (string/boolean shape only) — the actual model-spec strings are
// validated by llm_clients.parse_spec when a job spawns.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const settings = coerceSettings(body);
  if (!settings) {
    return NextResponse.json({ error: "bad settings shape" }, { status: 400 });
  }
  writeSettings(settings);
  return NextResponse.json({ ok: true });
}

function coerceSettings(body: unknown): AppSettings | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const str = (k: string): string =>
    typeof b[k] === "string" ? (b[k] as string) : "";
  const bool = (k: string): boolean =>
    typeof b[k] === "boolean" ? (b[k] as boolean) : false;
  return {
    modelExtractor: str("modelExtractor"),
    modelReviewer: str("modelReviewer"),
    modelRepair: str("modelRepair"),
    modelExtract: str("modelExtract"),
    modelVision: str("modelVision"),
    visionPdfEnabled: bool("visionPdfEnabled"),
    ollamaHost: str("ollamaHost"),
  };
}

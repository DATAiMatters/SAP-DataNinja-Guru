import "server-only";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NextResponse } from "next/server";
import { setTableLayout, type LayoutPatch } from "@/lib/yaml-write";
import { invalidateDomainCache } from "@/lib/yaml";

const REPO_ROOT = resolve(process.cwd(), "..");
const DOMAINS_DIR = join(REPO_ROOT, "domains");

interface Body {
  tableId?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: domainId } = await params;
  if (!/^[a-z0-9_-]+$/i.test(domainId)) {
    return NextResponse.json({ error: "invalid domain id" }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (
    typeof body.tableId !== "string" ||
    typeof body.x !== "number" ||
    typeof body.y !== "number" ||
    !Number.isFinite(body.x) ||
    !Number.isFinite(body.y)
  ) {
    return NextResponse.json(
      { error: "tableId (string), x (number), y (number) required" },
      { status: 400 },
    );
  }
  if (
    (body.width != null && typeof body.width !== "number") ||
    (body.height != null && typeof body.height !== "number")
  ) {
    return NextResponse.json({ error: "width/height must be numbers if provided" }, { status: 400 });
  }

  const layout: LayoutPatch = {
    x: body.x,
    y: body.y,
    ...(typeof body.width === "number" && { width: body.width }),
    ...(typeof body.height === "number" && { height: body.height }),
  };

  const filePath = join(DOMAINS_DIR, `${domainId}.yaml`);
  try {
    const before = readFileSync(filePath, "utf-8");
    const after = setTableLayout(before, body.tableId, layout);
    writeFileSync(filePath, after, "utf-8");
    invalidateDomainCache();
    return NextResponse.json({ ok: true, tableId: body.tableId, layout });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { castVote, getVoteSummary } from "@/lib/votes";
import type { TargetType } from "@/lib/db/schema";

const ALLOWED_TYPES: TargetType[] = [
  "table",
  "relationship",
  "gotcha",
  "sql_example",
  "annotation",
];

interface Body {
  targetType?: unknown;
  targetId?: unknown;
  value?: unknown;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (
    typeof body.targetType !== "string" ||
    typeof body.targetId !== "string" ||
    typeof body.value !== "number" ||
    ![-1, 0, 1].includes(body.value)
  ) {
    return NextResponse.json(
      { error: "targetType, targetId (string), value (-1|0|1) required" },
      { status: 400 },
    );
  }
  if (!ALLOWED_TYPES.includes(body.targetType as TargetType)) {
    return NextResponse.json(
      { error: `targetType must be one of ${ALLOWED_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  await castVote(
    session.user.id,
    body.targetType as TargetType,
    body.targetId,
    body.value as -1 | 0 | 1,
  );
  const summary = await getVoteSummary(body.targetId, session.user.id);
  return NextResponse.json(summary);
}

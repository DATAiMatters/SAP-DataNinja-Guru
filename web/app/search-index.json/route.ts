import { NextResponse } from "next/server";
import { serializeSearchIndex } from "@/lib/search";

// Static-generated at build time; served as a single JSON blob the
// CommandK client island fetches on first open.
export const dynamic = "force-static";

export async function GET() {
  return new NextResponse(serializeSearchIndex(), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=3600, immutable",
    },
  });
}

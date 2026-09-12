import { NextRequest, NextResponse } from "next/server";
import { listTargets, upsertTarget } from "@/lib/store";
import { TargetInput, formatZodError } from "@/lib/schema";
import { handle, jsonBody, badRequest } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Auth for POST is enforced in middleware (bearer). GET is behind Basic Auth.
export async function GET() {
  return NextResponse.json(await listTargets());
}

// Agent ingest door (vaulted INGEST_TOKEN). Validates the same way the MCP door does,
// so a malformed field can't reach storage and later 500 an export or crash the drawer.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const parsed = TargetInput.safeParse(await jsonBody(req));
    if (!parsed.success) badRequest(formatZodError(parsed.error));
    const t = await upsertTarget(parsed.data);
    return NextResponse.json({ ok: true, slug: t.slug });
  });
}

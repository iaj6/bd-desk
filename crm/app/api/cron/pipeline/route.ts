import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Overnight worker (auth: CRON_SECRET bearer, enforced in middleware). Finalizes
// finished research, starts new research on promising targets, drafts missing
// outreach. Runs first in the night; /api/cron/brief runs later to catch the
// sessions this run started and email the morning report.
export async function GET() {
  const report = await runPipeline();
  return NextResponse.json(report);
}

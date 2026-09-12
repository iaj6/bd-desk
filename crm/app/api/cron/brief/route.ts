import { NextResponse } from "next/server";
import { runPipeline, renderBrief } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Morning run (auth: CRON_SECRET bearer, enforced in middleware). Runs the same
// idempotent pipeline but WITHOUT starting new research — it finalizes the sessions the
// overnight run started, drafts their outreach, and emails the brief. Starting research
// here too would spend the daily RESEARCH_CAP a second time.
export async function GET() {
  const report = await runPipeline({ startNewResearch: false });

  const to = process.env.BRIEF_EMAIL;
  const key = process.env.RESEND_API_KEY;
  let email: string = "skipped (BRIEF_EMAIL / RESEND_API_KEY unset)";
  if (to && key) {
    const crmUrl = process.env.CRM_PUBLIC_URL ?? "";
    const { subject, html } = renderBrief(report, crmUrl);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "BD Desk <onboarding@resend.dev>", to: [to], subject, html }),
      });
      email = res.ok ? `sent: ${((await res.json()) as { id?: string }).id}` : `failed: ${res.status} ${await res.text()}`;
    } catch (e) {
      // The pipeline's work already landed; a Resend outage must not fail the whole run.
      email = `failed: ${(e as Error).message}`;
    }
  }

  return NextResponse.json({ ...report, email });
}

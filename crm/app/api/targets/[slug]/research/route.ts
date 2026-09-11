import { NextRequest, NextResponse } from "next/server";
import { readOneBySlug } from "@/lib/store";
import { finalizeResearch, startResearch } from "@/lib/research";

export const runtime = "nodejs";
// The POST returns fast, but its `after()` kickoff blocks ~100s while the sandbox
// provisions; the function must stay alive that long to finish it (README note 9).
export const maxDuration = 300;

// POST — kick off a research session and return immediately (it runs for minutes).
export async function POST(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  try {
    const started = await startResearch(slug);
    if (!started) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(started);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// GET — poll. If the session has finished, finalizeResearch pulls the brief + people
// and attaches it. Idempotent, and shares the exact logic used by the on-load reconciler.
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const want = new URL(req.url).searchParams.get("session");
  const t = await readOneBySlug(slug);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Re-research: the client polls for a specific NEW session, but the record may still
  // show the previous run (a re-research writes "running" with the new id, and Blob is
  // eventually consistent). Never report the old dossier as this run's result — hold at
  // "running" until the record catches up to the session the client is waiting on.
  if (want && t.dossier_session && t.dossier_session !== want) {
    return NextResponse.json({ status: "running" });
  }
  if (t.dossier_status === "done") return NextResponse.json({ status: "done", dossier: t.dossier, people: t.people });
  if (t.dossier_status === "error") return NextResponse.json({ status: "error" });
  if (!t.dossier_session) return NextResponse.json({ status: t.dossier_status ?? "none" });

  try {
    const updated = await finalizeResearch(t);
    if (!updated) return NextResponse.json({ status: "running" });
    return NextResponse.json({ status: "done", dossier: updated.dossier, people: updated.people });
  } catch (e) {
    return NextResponse.json({ status: "error", error: (e as Error).message });
  }
}

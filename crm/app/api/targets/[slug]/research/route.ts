import { NextRequest, NextResponse } from "next/server";
import { readOneBySlug } from "@/lib/store";
import { finalizeResearch, startResearch } from "@/lib/research";

export const runtime = "nodejs";
export const maxDuration = 60;

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
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const t = await readOneBySlug(slug);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (t.dossier_status === "done") return NextResponse.json({ status: "done", dossier: t.dossier, people: t.people });
  if (!t.dossier_session) return NextResponse.json({ status: t.dossier_status ?? "none" });

  try {
    const updated = await finalizeResearch(t);
    if (!updated) return NextResponse.json({ status: "running" });
    return NextResponse.json({ status: "done", dossier: updated.dossier, people: updated.people });
  } catch (e) {
    return NextResponse.json({ status: "error", error: (e as Error).message });
  }
}

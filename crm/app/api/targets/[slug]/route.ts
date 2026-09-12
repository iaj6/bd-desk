import { NextRequest, NextResponse } from "next/server";
import { patchTarget, deleteTarget, readOneBySlug } from "@/lib/store";
import { PatchInput, formatZodError } from "@/lib/schema";
import { handle, jsonBody, badRequest } from "@/lib/http";

export const runtime = "nodejs";

// Edit the human fields only (status/notes/next_step/follow_up/outreach/linkedin_note/
// dossier/contact). The async research state (dossier_status, people, grade) is written
// by finalizeResearch, never over this door. Behind Basic Auth via middleware.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return handle(async () => {
    const parsed = PatchInput.safeParse(await jsonBody(req));
    if (!parsed.success) badRequest(formatZodError(parsed.error));
    const updated = await patchTarget(slug, parsed.data);
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return handle(async () => {
    // Report a real 404 for an unknown slug, so a client can't mistake "already gone"
    // (or a typo) for a successful delete.
    if (!(await readOneBySlug(slug))) return NextResponse.json({ error: "not found" }, { status: 404 });
    await deleteTarget(slug);
    return NextResponse.json({ ok: true });
  });
}

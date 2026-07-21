import { NextRequest, NextResponse } from "next/server";
import { patchTarget, deleteTarget } from "@/lib/store";

export const runtime = "nodejs";

// Edit human fields (status/notes/next_step/follow_up). Behind Basic Auth via middleware.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  let fields: Record<string, unknown>;
  try {
    fields = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    const updated = await patchTarget(slug, fields);
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  await deleteTarget(slug);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { draftOutreach } from "@/lib/outreach";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const channel = (await req.json().catch(() => ({})))?.channel === "linkedin" ? "linkedin" : "email";

  try {
    const result = await draftOutreach(slug, channel);
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { listTargets, upsertTarget } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Auth for POST is enforced in middleware (bearer). GET is behind Basic Auth.
export async function GET() {
  return NextResponse.json(await listTargets());
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body?.company) {
    return NextResponse.json({ error: "company is required" }, { status: 400 });
  }
  const t = await upsertTarget(body);
  return NextResponse.json({ ok: true, slug: t.slug });
}

import { NextRequest, NextResponse } from "next/server";
import { getBrandPack, putBrandPack, type BrandPack } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST auth (bearer INGEST_TOKEN) is enforced in middleware; GET is behind Basic Auth.
// The repo's brand-pack compiler (`npm run brand-pack`) POSTs the compiled canon here.
export async function GET() {
  const pack = await getBrandPack();
  return pack ? NextResponse.json(pack) : NextResponse.json({ error: "no pack yet" }, { status: 404 });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body?.blocks?.outreach) {
    return NextResponse.json({ error: "pack.blocks.outreach is required" }, { status: 400 });
  }
  await putBrandPack(body as BrandPack);
  return NextResponse.json({ ok: true, version: body.version ?? null, blocks: Object.keys(body.blocks) });
}

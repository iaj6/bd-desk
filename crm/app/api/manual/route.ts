import { NextRequest, NextResponse } from "next/server";
import { upsertTarget, slugify } from "@/lib/store";

export const runtime = "nodejs";

// Manual add from the UI (not the agent ingest path). Behind Basic Auth via middleware.
// Handles both company targets and contact entries (kind === "contact").
export async function POST(req: NextRequest) {
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body?.company || typeof body.company !== "string") {
    return NextResponse.json({ error: "company/org is required" }, { status: 400 });
  }

  const isContact = body.kind === "contact";
  if (isContact && !body.contact_name) {
    return NextResponse.json({ error: "contact name is required" }, { status: 400 });
  }
  // Contacts slug by person+org so multiple people at one org don't collide.
  const slug = isContact ? slugify(`${body.contact_name} ${body.company}`) : undefined;

  const t = await upsertTarget({ ...body, company: body.company, manual: true, ...(slug ? { slug } : {}) });
  return NextResponse.json(t);
}

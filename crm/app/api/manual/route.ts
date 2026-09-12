import { NextRequest, NextResponse } from "next/server";
import { upsertTarget, slugify } from "@/lib/store";
import { TargetInput, formatZodError } from "@/lib/schema";
import { handle, jsonBody, badRequest } from "@/lib/http";

export const runtime = "nodejs";

// Manual add from the UI (not the agent ingest path). Behind Basic Auth via middleware.
// Handles both company targets and contact entries (kind === "contact").
export async function POST(req: NextRequest) {
  return handle(async () => {
    const parsed = TargetInput.safeParse(await jsonBody(req));
    if (!parsed.success) badRequest(formatZodError(parsed.error));
    const body = parsed.data;

    const isContact = body.kind === "contact";
    if (isContact && !body.contact_name) badRequest("contact name is required");
    // Contacts slug by person+org so multiple people at one org don't collide.
    const slug = isContact ? slugify(`${body.contact_name} ${body.company}`) : undefined;

    const t = await upsertTarget({ ...body, manual: true, ...(slug ? { slug } : {}) });
    return NextResponse.json(t);
  });
}

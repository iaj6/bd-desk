import { NextRequest, NextResponse } from "next/server";
import { listTargets, readOneBySlug } from "@/lib/store";
import { targetsToCsv, peopleToCsv, pipelineWorkbook, targetToMarkdown } from "@/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Human-facing export, behind Basic Auth via the proxy (no bearer door on purpose —
// agents read through MCP; this endpoint exists for the operator's own data).
//   GET /api/export                → full pipeline, JSON (lossless)
//   GET /api/export?format=csv     → full pipeline, flat CSV (one row per target)
//   GET /api/export?format=people  → rolodex CSV (one row per person, with company context)
//   GET /api/export?format=xlsx    → Excel workbook: Targets + People sheets (the 1-to-many in one file)
//   GET /api/export?slug=x         → one target as a markdown brief
//   GET /api/export?slug=x&format=json → one target, raw record

const attachment = (body: string | Uint8Array<ArrayBuffer>, filename: string, type: string) =>
  new NextResponse(body, {
    headers: {
      "content-type": type,
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const slug = params.get("slug");
  const format = params.get("format") ?? (slug ? "md" : "json");
  const date = new Date().toISOString().slice(0, 10);

  if (slug) {
    const t = await readOneBySlug(slug);
    if (!t) return NextResponse.json({ error: `no target with slug "${slug}"` }, { status: 404 });
    if (format === "json")
      return attachment(JSON.stringify(t, null, 2) + "\n", `${t.slug}-${date}.json`, "application/json");
    return attachment(targetToMarkdown(t), `${t.slug}-${date}.md`, "text/markdown; charset=utf-8");
  }

  const targets = await listTargets();
  if (format === "csv")
    return attachment(targetsToCsv(targets), `bd-desk-${date}.csv`, "text/csv; charset=utf-8");
  if (format === "people")
    return attachment(peopleToCsv(targets), `bd-desk-people-${date}.csv`, "text/csv; charset=utf-8");
  if (format === "xlsx")
    return attachment(
      new Uint8Array(pipelineWorkbook(targets)),
      `bd-desk-${date}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  return attachment(JSON.stringify(targets, null, 2) + "\n", `bd-desk-${date}.json`, "application/json");
}

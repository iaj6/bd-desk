import type { Target } from "./store";

// Export builders — pure functions over Target so they're testable without Blob.
// Three shapes: JSON is the lossless full record (route serializes directly),
// CSV is the flat spreadsheet view, markdown is the shareable per-target brief.

// One cell. Quotes/commas/newlines get RFC-4180 quoting; leading =, +, -, @ get a
// literal-text prefix so agent-sourced strings can't execute as formulas when the
// file lands in Excel or Sheets.
function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Long texts (dossier, outreach, notes) stay in the JSON export; the CSV carries
// presence flags so rows stay row-sized.
const CSV_COLUMNS: [string, (t: Target) => unknown][] = [
  ["slug", (t) => t.slug],
  ["company", (t) => t.company],
  ["kind", (t) => t.kind ?? "company"],
  ["contact_name", (t) => t.contact_name],
  ["contact_title", (t) => t.contact_title],
  ["sponsor", (t) => t.sponsor],
  ["hq", (t) => t.hq],
  ["vertical", (t) => t.vertical],
  ["fit", (t) => t.fit],
  ["status", (t) => t.status],
  ["next_step", (t) => t.next_step],
  ["follow_up", (t) => t.follow_up],
  ["why_now", (t) => t.why_now],
  ["entry_persona", (t) => t.entry_persona],
  ["green_signals", (t) => t.green_signals?.join("; ")],
  ["sources", (t) => t.sources?.join(" ")],
  ["people", (t) => t.people?.map((p) => p.name).join("; ")],
  ["grade", (t) => t.grade],
  ["has_dossier", (t) => Boolean(t.dossier)],
  ["has_outreach", (t) => Boolean(t.outreach || t.linkedin_note)],
  ["manual", (t) => Boolean(t.manual)],
  ["discovered_at", (t) => t.discovered_at],
  ["updated_at", (t) => t.updated_at],
];

export function targetsToCsv(targets: Target[]): string {
  const header = CSV_COLUMNS.map(([name]) => name).join(",");
  const rows = targets.map((t) => CSV_COLUMNS.map(([, get]) => csvCell(get(t))).join(","));
  return [header, ...rows].join("\r\n") + "\r\n";
}

export function targetToMarkdown(t: Target): string {
  const title = t.kind === "contact" ? `${t.contact_name ?? t.company} — ${t.company}` : t.company;
  const out: string[] = [`# ${title}`, ""];

  const fact = (label: string, v?: string) => {
    if (v) out.push(`- **${label}:** ${v}`);
  };
  fact("Sponsor", t.sponsor);
  fact("HQ", t.hq);
  fact("Vertical", t.vertical);
  fact("Fit", t.fit);
  fact("Status", t.status);
  fact("Next step", t.next_step);
  fact("Follow-up", t.follow_up);
  fact("Entry persona", t.entry_persona);
  fact("Research grade", t.grade);

  const section = (h: string, body?: string) => {
    if (body) out.push("", `## ${h}`, "", body);
  };
  section("Why now", t.why_now);
  if (t.green_signals?.length) section("Signals", t.green_signals.map((s) => `- ${s}`).join("\n"));
  if (t.people?.length)
    section(
      "Key people",
      t.people
        .map((p) => `- **${p.name}**${p.title ? ` — ${p.title}` : ""}${p.persona ? ` (${p.persona})` : ""}${p.linkedin ? ` · ${p.linkedin}` : ""}`)
        .join("\n"),
    );
  section("Notes", t.notes);
  if (t.outreach) section("Outreach draft (email)", "```\n" + t.outreach + "\n```");
  if (t.linkedin_note) section("LinkedIn note", "```\n" + t.linkedin_note + "\n```");
  if (t.sources?.length) section("Sources", t.sources.map((s) => `- ${s}`).join("\n"));
  if (t.dossier) out.push("", "---", "", t.dossier); // already markdown, own H1
  out.push("", "---", `*Exported from BD Desk, ${new Date().toISOString().slice(0, 10)}.*`, "");
  return out.join("\n");
}

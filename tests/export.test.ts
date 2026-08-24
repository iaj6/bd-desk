import { describe, it, expect } from "vitest";
import { targetsToCsv, peopleToCsv, targetToMarkdown } from "../crm/lib/export.ts";
import type { Target } from "../crm/lib/store.ts";

// Every value in an export originates from agent web research — untrusted text that
// lands in Excel or Sheets. The tests that matter here are the escaping ones.

const target = (over: Partial<Target> = {}): Target => ({
  slug: "acme-freight",
  company: "Acme Freight",
  status: "new",
  ...over,
});

const rows = (csv: string) => csv.split("\r\n").filter(Boolean);
const cols = (line: string) => {
  // RFC-4180 aware split, so assertions read fields not substrings.
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
};

describe("targetsToCsv", () => {
  it("emits a header row and one row per target, CRLF-terminated", () => {
    const csv = targetsToCsv([target(), target({ slug: "b", company: "B Corp" })]);
    expect(csv.endsWith("\r\n")).toBe(true);
    const lines = rows(csv);
    expect(lines).toHaveLength(3);
    expect(cols(lines[0]).slice(0, 3)).toEqual(["slug", "company", "kind"]);
    expect(cols(lines[1])[1]).toBe("Acme Freight");
  });

  it("neutralizes formula injection from agent-sourced values", () => {
    // A company name the agent scraped could start with =, +, - or @. Excel would
    // execute it. Each must arrive as literal text.
    for (const evil of ["=cmd|'/c calc'!A1", "+1+1", "-2+3", "@SUM(1)"]) {
      const csv = targetsToCsv([target({ company: evil })]);
      const cell = cols(rows(csv)[1])[1];
      expect(cell.startsWith("'")).toBe(true);
      expect(cell.slice(1)).toBe(evil); // prefixed, never mangled
    }
  });

  it("quotes and doubles embedded quotes, commas, and newlines", () => {
    const csv = targetsToCsv([
      target({ company: 'The "Big" One, Inc.', notes: "line one\nline two", next_step: "call Bob" }),
    ]);
    const line = rows(csv)[1];
    expect(line).toContain('"The ""Big"" One, Inc."');
    expect(cols(line)[1]).toBe('The "Big" One, Inc.');
  });

  it("renders missing fields as empty cells, never 'undefined'", () => {
    const csv = targetsToCsv([target()]);
    const line = rows(csv)[1];
    expect(line).not.toContain("undefined");
    expect(line).not.toContain("null");
    expect(cols(line)[3]).toBe(""); // contact_name
  });

  it("flattens arrays and reduces long text to presence flags", () => {
    const csv = targetsToCsv([
      target({
        green_signals: ["PE-backed", "new CIO"],
        sources: ["https://a.example", "https://b.example"],
        people: [{ name: "Dana Reed", title: "VP Ops" }, { name: "Sam Fox" }],
        dossier: "# a very long brief…",
        outreach: "Subject: hi",
      }),
    ]);
    const c = cols(rows(csv)[1]);
    const head = cols(rows(csv)[0]);
    expect(c[head.indexOf("green_signals")]).toBe("PE-backed; new CIO");
    expect(c[head.indexOf("sources")]).toBe("https://a.example https://b.example");
    expect(c[head.indexOf("people")]).toBe("Dana Reed (VP Ops); Sam Fox");
    expect(c[head.indexOf("has_dossier")]).toBe("true");
    expect(c[head.indexOf("has_outreach")]).toBe("true");
    expect(rows(csv)[1]).not.toContain("very long brief");
  });
});

describe("peopleToCsv", () => {
  it("denormalizes one row per person with company context repeated", () => {
    const csv = peopleToCsv([
      target({
        people: [
          { name: "Dana Reed", title: "VP Ops", persona: "operator", linkedin: "https://li/dana", source: "https://s" },
          { name: "Sam Fox", title: "CFO" },
        ],
        sponsor: "Blackpine",
        fit: "Strong",
      }),
    ]);
    const lines = rows(csv);
    expect(lines).toHaveLength(3);
    expect(cols(lines[1])).toEqual([
      "Dana Reed", "VP Ops", "operator", "https://li/dana", "https://s",
      "Acme Freight", "Blackpine", "acme-freight", "Strong", "new",
    ]);
    expect(cols(lines[2])[0]).toBe("Sam Fox");
    expect(cols(lines[2])[5]).toBe("Acme Freight"); // company repeated per person
  });

  it("includes contact-kind targets as their own person row", () => {
    const csv = peopleToCsv([
      target({ kind: "contact", contact_name: "Pat Lee", contact_title: "Operating Partner", entry_persona: "sponsor" }),
    ]);
    const c = cols(rows(csv)[1]);
    expect(c[0]).toBe("Pat Lee");
    expect(c[1]).toBe("Operating Partner");
    expect(c[2]).toBe("sponsor");
    expect(c[7]).toBe("acme-freight"); // target_slug joins back to the targets sheet
  });

  it("emits a header-only file when nobody has been researched yet", () => {
    expect(rows(peopleToCsv([target()]))).toHaveLength(1);
  });

  it("escapes person names the same way as the targets sheet", () => {
    const csv = peopleToCsv([target({ people: [{ name: "=HYPERLINK(\"http://x\")" }] })]);
    expect(cols(rows(csv)[1])[0].startsWith("'=")).toBe(true);
  });
});

describe("targetToMarkdown", () => {
  it("titles a company brief with the company and lists only present facts", () => {
    const md = targetToMarkdown(target({ sponsor: "Blackpine", fit: "Strong" }));
    expect(md).toMatch(/^# Acme Freight\n/);
    expect(md).toContain("- **Sponsor:** Blackpine");
    expect(md).toContain("- **Fit:** Strong");
    expect(md).not.toContain("**HQ:**"); // absent fields are omitted, not blank
  });

  it("titles a contact brief with the person and their organization", () => {
    const md = targetToMarkdown(target({ kind: "contact", contact_name: "Pat Lee" }));
    expect(md).toMatch(/^# Pat Lee — Acme Freight\n/);
  });

  it("fences drafted outreach so markdown in the draft cannot restructure the brief", () => {
    const md = targetToMarkdown(target({ outreach: "Subject: hi\n\n# not a heading" }));
    expect(md).toContain("## Outreach draft (email)\n\n```\nSubject: hi\n\n# not a heading\n```");
  });

  it("appends the dossier verbatim below a rule and closes with an export stamp", () => {
    const md = targetToMarkdown(target({ dossier: "# Pre-Engagement Dossier\n\nbody" }));
    expect(md).toContain("---\n\n# Pre-Engagement Dossier\n\nbody");
    expect(md).toMatch(/\*Exported from BD Desk, \d{4}-\d{2}-\d{2}\.\*/);
  });

  it("omits every optional section for a bare target", () => {
    const md = targetToMarkdown(target());
    for (const h of ["## Why now", "## Signals", "## Key people", "## Notes", "## Sources"]) {
      expect(md).not.toContain(h);
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  isSessionTerminal, lastVerdict, trimToDeliverable, extractBlock,
  parsePeople, nameTokens, isNameVariant, portcoReceipt,
} from "../crm/lib/deliverable.ts";

describe("isSessionTerminal", () => {
  it("treats a terminated session as done regardless of evaluations", () => {
    expect(isSessionTerminal({ status: "terminated" })).toBe(true);
    expect(isSessionTerminal({ status: "terminated", outcome_evaluations: [{ result: "pending" }] })).toBe(true);
  });

  it("treats an idle session with every evaluation settled as done", () => {
    for (const result of ["satisfied", "max_iterations_reached", "failed", "interrupted"]) {
      expect(isSessionTerminal({ status: "idle", outcome_evaluations: [{ result }] })).toBe(true);
    }
  });

  it("does NOT finalize while an evaluation is still pending — the grader may send it back", () => {
    // The bug this guards: naive idle-means-done grabs a half-written deliverable
    // during a revision cycle.
    expect(isSessionTerminal({ status: "idle", outcome_evaluations: [{ result: "pending" }] })).toBe(false);
    expect(isSessionTerminal({ status: "idle", outcome_evaluations: [{ result: "evaluating" }] })).toBe(false);
    expect(
      isSessionTerminal({ status: "idle", outcome_evaluations: [{ result: "satisfied" }, { result: "pending" }] }),
    ).toBe(false);
  });

  it("does not finalize an idle session that is waiting on the caller", () => {
    expect(isSessionTerminal({ status: "idle", stop_reason: { type: "requires_action" } })).toBe(false);
  });

  it("treats an idle session with no evaluations as done (ungraded run)", () => {
    expect(isSessionTerminal({ status: "idle" })).toBe(true);
    expect(isSessionTerminal({ status: "idle", outcome_evaluations: [] })).toBe(true);
    expect(isSessionTerminal({ status: "idle", outcome_evaluations: null })).toBe(true);
  });

  it("is false for any still-working status", () => {
    for (const status of ["running", "queued", "provisioning", undefined]) {
      expect(isSessionTerminal({ status })).toBe(false);
    }
  });
});

describe("lastVerdict", () => {
  it("returns the last COMPLETED evaluation, ignoring ones still in flight", () => {
    expect(
      lastVerdict({
        outcome_evaluations: [
          { result: "max_iterations_reached", completed_at: "2026-01-01T00:00:00Z", explanation: "first pass" },
          { result: "satisfied", completed_at: "2026-01-01T00:05:00Z", explanation: "after revision" },
          { result: "pending", completed_at: null },
        ],
      }),
    ).toEqual({ result: "satisfied", explanation: "after revision" });
  });

  it("returns null when nothing has completed", () => {
    expect(lastVerdict({})).toBeNull();
    expect(lastVerdict({ outcome_evaluations: [{ result: "pending", completed_at: null }] })).toBeNull();
  });

  it("normalizes a null explanation to undefined so it is not stored as 'null'", () => {
    expect(lastVerdict({ outcome_evaluations: [{ result: "failed", completed_at: "t", explanation: null }] }))
      .toEqual({ result: "failed", explanation: undefined });
  });
});

describe("trimToDeliverable", () => {
  it("drops research narration before the deliverable's first H1", () => {
    const raw = "Let me search for recent filings…\nFound three sources.\n\n# Pre-Engagement Dossier\n\nbody";
    expect(trimToDeliverable(raw)).toBe("# Pre-Engagement Dossier\n\nbody");
  });

  it("leaves a brief that already starts at its H1 untouched", () => {
    expect(trimToDeliverable("# Sponsor Profile\n\nbody")).toBe("# Sponsor Profile\n\nbody");
  });

  it("keeps everything when the agent never wrote an H1", () => {
    expect(trimToDeliverable("  no heading at all  ")).toBe("no heading at all");
  });

  it("ignores deeper headings and mid-line hashes", () => {
    expect(trimToDeliverable("intro\n## Section\ntext")).toBe("intro\n## Section\ntext");
    expect(trimToDeliverable("see issue #1 here")).toBe("see issue #1 here");
  });

  it("cuts at the FIRST H1 so later sections survive", () => {
    const raw = "narration\n\n# Dossier\n\nbody\n\n# Appendix\n\nmore";
    expect(trimToDeliverable(raw)).toBe("# Dossier\n\nbody\n\n# Appendix\n\nmore");
  });
});

describe("extractBlock", () => {
  it("pulls the array out and removes the block from the prose", () => {
    const brief = '# Dossier\n\nbody\n\n<people>[{"name":"Dana Reed"}]</people>';
    const { items, rest } = extractBlock(brief, "people");
    expect(items).toEqual([{ name: "Dana Reed" }]);
    expect(rest).toBe("# Dossier\n\nbody");
  });

  it("tolerates the model wrapping the block in a json fence", () => {
    const brief = '<people>```json\n[{"name":"Sam"}]\n```</people>';
    expect(extractBlock(brief, "people").items).toEqual([{ name: "Sam" }]);
  });

  it("strips a malformed block anyway, so raw JSON never reaches the reader", () => {
    const { items, rest } = extractBlock("body\n\n<people>[{name: broken]</people>", "people");
    expect(items).toBeNull();
    expect(rest).toBe("body");
  });

  it("leaves the brief alone when the block is absent", () => {
    const brief = "# Dossier\n\nno blocks here";
    expect(extractBlock(brief, "portcos")).toEqual({ items: null, rest: brief });
  });

  it("rejects a non-array payload", () => {
    expect(extractBlock('<people>{"name":"Dana"}</people>', "people").items).toBeNull();
  });

  it("matches case-insensitively and across newlines", () => {
    const { items } = extractBlock('<PEOPLE>\n[\n  {"name":"Dana"}\n]\n</PEOPLE>', "people");
    expect(items).toEqual([{ name: "Dana" }]);
  });

  it("extracts each block independently when both are present", () => {
    const brief = '# Profile\n\nbody\n\n<people>[{"name":"Pat"}]</people>\n<portcos>[{"company":"Acme"}]</portcos>';
    const first = extractBlock(brief, "people");
    const second = extractBlock(first.rest, "portcos");
    expect(first.items).toEqual([{ name: "Pat" }]);
    expect(second.items).toEqual([{ company: "Acme" }]);
    expect(second.rest).toBe("# Profile\n\nbody");
  });

  it("accepts an empty array — 'we found nobody' is a valid answer", () => {
    expect(extractBlock("<people>[]</people>", "people").items).toEqual([]);
  });
});

describe("parsePeople", () => {
  it("keeps entries with a name and drops model noise", () => {
    expect(
      parsePeople([{ name: "Dana", title: "VP" }, { title: "no name" }, null, "string", { name: 42 }]),
    ).toEqual([{ name: "Dana", title: "VP" }]);
  });

  it("distinguishes 'no block' from 'an empty block'", () => {
    expect(parsePeople(null)).toBeUndefined();
    expect(parsePeople([])).toEqual([]);
  });
});

describe("nameTokens / isNameVariant", () => {
  it("ignores generic corporate filler when comparing names", () => {
    expect([...nameTokens("Acme Holdings, LLC")]).toEqual(["acme"]);
    expect([...nameTokens("Acme Group Inc")]).toEqual(["acme"]);
    expect(isNameVariant(nameTokens("Acme Holdings, LLC"), nameTokens("Acme Group Inc"))).toBe(true);
  });

  it("matches a short form against its longer form — the prod failure that motivated it", () => {
    expect(isNameVariant(nameTokens("Northwind"), nameTokens("Northwind Freight Systems"))).toBe(true);
  });

  it("does not collapse genuinely different companies", () => {
    expect(isNameVariant(nameTokens("Acme Freight"), nameTokens("Beta Freight"))).toBe(false);
    expect(isNameVariant(nameTokens("Northwind"), nameTokens("Southwind"))).toBe(false);
  });

  it("falls back to all tokens when every word is generic, rather than matching everything", () => {
    expect([...nameTokens("The Holdings Group")].sort()).toEqual(["group", "holdings", "the"]);
    expect(isNameVariant(nameTokens("The Holdings Group"), nameTokens("Acme"))).toBe(false);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(isNameVariant(nameTokens("ACME  FREIGHT!"), nameTokens("acme-freight"))).toBe(true);
  });

  it("drops single characters that carry no signal", () => {
    expect([...nameTokens("A Acme")]).toEqual(["acme"]);
  });
});

describe("portcoReceipt", () => {
  it("reports the plain count when nothing was capped", () => {
    expect(portcoReceipt(3, 0, 8)).toContain("3 portcos added to the pipeline.");
    expect(portcoReceipt(3, 0, 8)).not.toContain("cap");
  });

  it("uses the singular for exactly one", () => {
    expect(portcoReceipt(1, 0, 8)).toContain("1 portco added");
  });

  it("names what was dropped, so a capped sweep never reads like a complete one", () => {
    const r = portcoReceipt(8, 4, 8);
    expect(r).toContain("8 portcos added");
    expect(r).toContain("4 more qualified but hit the per-profile cap (8)");
  });

  it("still reports a zero-add run", () => {
    expect(portcoReceipt(0, 0, 8)).toContain("0 portcos added");
  });
});

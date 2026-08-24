import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineOutcome, rubric, MAX_ITERATIONS } from "../src/rubrics.ts";
import { defineOutcome as crmDefineOutcome, MAX_ITERATIONS as CRM_MAX_ITERATIONS } from "../crm/lib/rubrics.ts";

const repo = resolve(import.meta.dirname, "..");
const file = (name: string) => readFileSync(resolve(repo, "agents/rubrics", name), "utf8");

describe("defineOutcome", () => {
  it("sends the task and its rubric as one graded kickoff event", () => {
    const e = defineOutcome("dossier", "Build a BD dossier on: Acme Freight.");
    expect(e.type).toBe("user.define_outcome");
    expect(e.description).toContain("Build a BD dossier on: Acme Freight.");
    expect(e.rubric).toEqual({ type: "text", content: file("bd-dossier.rubric.md") });
    expect(e.max_iterations).toBe(MAX_ITERATIONS);
  });

  it("keeps revision cycles low — every one is another opus turn", () => {
    expect(MAX_ITERATIONS).toBe(2);
    expect(MAX_ITERATIONS).toBeLessThanOrEqual(20); // platform ceiling
  });

  it("routes ingested deliverables to a pinned output file", () => {
    // The CRM and the eval harness both fetch this exact path via the Files API.
    for (const agent of ["dossier", "sponsor"] as const) {
      const { description } = defineOutcome(agent, "task");
      expect(description).toContain("/mnt/session/outputs/deliverable.md");
      expect(description).not.toContain("as your final message");
    }
  });

  it("keeps the radar's report in the message stream, where a human reads it", () => {
    const { description } = defineOutcome("radar", "sweep");
    expect(description).toContain("as your final message");
    expect(description).not.toContain("/mnt/session/outputs/");
  });

  it("pairs each agent with its own rubric file", () => {
    expect(rubric("dossier")).toBe(file("bd-dossier.rubric.md"));
    expect(rubric("sponsor")).toBe(file("sponsor-profile.rubric.md"));
    expect(rubric("radar")).toBe(file("opportunity-radar.rubric.md"));
  });
});

describe("crm/lib/rubrics.ts stays in sync with agents/rubrics/", () => {
  // The CRM deploys from crm/ alone, so it cannot read the repo-root rubric files at
  // runtime — it carries a copy. That copy is the one deliberate duplication in the
  // repo, and this is what stops it drifting: edit the .md, and this fails until the
  // copy follows. Otherwise the CRM would grade research against a stale bar while
  // the CLI graded against the current one.
  it("uses the same dossier rubric the CLI does", () => {
    expect(crmDefineOutcome("dossier", "task").rubric.content).toBe(file("bd-dossier.rubric.md"));
  });

  it("uses the same sponsor rubric the CLI does", () => {
    expect(crmDefineOutcome("sponsor", "task").rubric.content).toBe(file("sponsor-profile.rubric.md"));
  });

  it("agrees on the revision budget", () => {
    expect(CRM_MAX_ITERATIONS).toBe(MAX_ITERATIONS);
  });

  it("agrees on the delivery contract", () => {
    expect(crmDefineOutcome("dossier", "task").description).toBe(defineOutcome("dossier", "task").description);
  });
});

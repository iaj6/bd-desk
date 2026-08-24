import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { setStore, type Store } from "../crm/lib/storage.ts";

// The nightly pipeline is the part that runs unattended, so the tests that matter
// are the invariants: it never sends, never touches human triage state, never
// exceeds its spend caps, and survives a step that throws.

const calls: string[] = [];
const started = new Set<string>();
const drafted = new Set<string>();
const failDraft = new Set<string>();
const failStart = new Set<string>();
const finalizes = new Map<string, boolean>(); // slug → did it finish this run

vi.mock("../crm/lib/outreach.ts", () => ({
  draftOutreach: async (slug: string, channel: string) => {
    calls.push(`draft:${slug}:${channel}`);
    if (failDraft.has(slug)) throw new Error("model overloaded");
    drafted.add(`${slug}:${channel}`);
    return { channel, text: "draft" };
  },
}));

vi.mock("../crm/lib/research.ts", () => ({
  startResearch: async (slug: string) => {
    calls.push(`start:${slug}`);
    if (failStart.has(slug)) throw new Error("session create failed");
    started.add(slug);
    return { status: "running", session: `sess-${slug}` };
  },
  finalizeResearch: async (t: { slug: string }) => {
    calls.push(`finalize:${t.slug}`);
    return finalizes.get(t.slug) ? { ...t, dossier: "brief", dossier_status: "done" } : null;
  },
}));

const { upsertTarget, patchTarget } = await import("../crm/lib/store.ts");
const { runPipeline, renderBrief } = await import("../crm/lib/pipeline.ts");

const records = new Map<string, string>();
const memoryStore: Store = {
  async read(k) { return records.get(k) ?? null; },
  async write(k, b) { records.set(k, b); },
  async list(p) { return [...records.keys()].filter((k) => k.startsWith(p)); },
  async remove(k) { records.delete(k); },
};
setStore(memoryStore);
afterAll(() => setStore(null));

beforeEach(() => {
  records.clear();
  calls.length = 0;
  started.clear();
  drafted.clear();
  failDraft.clear();
  failStart.clear();
  finalizes.clear();
});

// Seed a target: sourced fields via upsert, human/async state via patch.
async function seed(company: string, sourced: Record<string, unknown> = {}, human: Record<string, unknown> = {}) {
  const t = await upsertTarget({ company, ...sourced } as never);
  if (Object.keys(human).length) await patchTarget(t.slug, human as never);
  return t.slug;
}

const day = 24 * 3600 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const ymd = (offsetMs: number) => iso(offsetMs).slice(0, 10);

describe("runPipeline — ordering", () => {
  it("drafts before finalizing, so an eventually-consistent read cannot clobber a fresh dossier", async () => {
    // Documented prod failure: a draft's read-modify-write seconds after a finalize
    // reads the pre-finalize record and wipes the just-attached dossier.
    await seed("Ready To Draft", {}, { dossier_status: "done", dossier: "old brief" });
    await seed("Still Running", {}, { dossier_status: "running", dossier_session: "s1" });

    await runPipeline();

    expect(calls.indexOf("draft:ready-to-draft:email")).toBeLessThan(calls.indexOf("finalize:still-running"));
  });

  it("defers a target finalized this run to the next run rather than drafting it immediately", async () => {
    await seed("Finishes Now", {}, { dossier_status: "running", dossier_session: "s1" });
    finalizes.set("finishes-now", true);

    const report = await runPipeline();

    expect(report.finalized).toEqual(["finishes-now"]);
    expect(report.drafted).toEqual([]); // drafted on the NEXT run
  });
});

describe("runPipeline — drafting", () => {
  it("drafts email for a researched company that has none", async () => {
    await seed("Acme", {}, { dossier_status: "done" });
    const report = await runPipeline();
    expect(report.drafted).toEqual([{ slug: "acme", channels: ["email"] }]);
  });

  it("adds a LinkedIn note only for contact-kind targets", async () => {
    await seed("Pat Lee Fund", { kind: "contact", contact_name: "Pat Lee" }, { dossier_status: "done" });
    await seed("Acme Co", {}, { dossier_status: "done" });
    const report = await runPipeline();
    const byslug = Object.fromEntries(report.drafted.map((d) => [d.slug, d.channels]));
    expect(byslug["pat-lee-fund"]).toEqual(["email", "linkedin"]);
    expect(byslug["acme-co"]).toEqual(["email"]);
  });

  it("is idempotent — a target that already has its drafts is skipped", async () => {
    await seed("Acme", {}, { dossier_status: "done", outreach: "already written" });
    const report = await runPipeline();
    expect(report.drafted).toEqual([]);
    expect(calls.filter((c) => c.startsWith("draft:"))).toEqual([]);
  });

  it("never drafts for a target the human killed or won", async () => {
    await seed("Dead One", {}, { dossier_status: "done", status: "dead" });
    await seed("Won One", {}, { dossier_status: "done", status: "won" });
    const report = await runPipeline();
    expect(report.drafted).toEqual([]);
  });

  it("never drafts before research has finished", async () => {
    await seed("Unresearched");
    await seed("Mid Flight", {}, { dossier_status: "running", dossier_session: "s" });
    const report = await runPipeline();
    expect(report.drafted).toEqual([]);
  });

  it("caps drafting at four targets per run", async () => {
    for (let i = 0; i < 7; i++) await seed(`Company ${i}`, {}, { dossier_status: "done" });
    const report = await runPipeline();
    expect(report.drafted).toHaveLength(4);
  });

  it("records a failed channel as an error and keeps going", async () => {
    failDraft.add("breaks");
    await seed("Breaks", {}, { dossier_status: "done" });
    await seed("Works", {}, { dossier_status: "done" });
    const report = await runPipeline();
    expect(report.errors).toEqual([{ slug: "breaks", step: "draft:email", message: "model overloaded" }]);
    expect(report.drafted).toEqual([{ slug: "works", channels: ["email"] }]);
  });
});

describe("runPipeline — research", () => {
  it("starts research on promising, untouched targets", async () => {
    await seed("Strong One", { fit: "Strong" });
    await seed("Maybe One", { fit: "Worth a look" });
    const report = await runPipeline();
    expect(report.started.sort()).toEqual(["maybe-one", "strong-one"]);
    expect(report.running.sort()).toEqual(["maybe-one", "strong-one"]);
  });

  it("does not spend a session on a Skip, an unrated target, or a killed one", async () => {
    await seed("Skip One", { fit: "Skip" });
    await seed("Unrated");
    await seed("Dead Strong", { fit: "Strong" }, { status: "dead" });
    const report = await runPipeline();
    expect(report.started).toEqual([]);
  });

  it("does not re-research a target that already has a dossier or a session", async () => {
    await seed("Has Brief", { fit: "Strong" }, { dossier: "brief", dossier_status: "done" });
    await seed("In Flight", { fit: "Strong" }, { dossier_status: "running", dossier_session: "s" });
    const report = await runPipeline();
    expect(report.started).toEqual([]);
  });

  it("caps research at three sessions per run — each one costs real money", async () => {
    for (let i = 0; i < 6; i++) await seed(`Strong ${i}`, { fit: "Strong" });
    const report = await runPipeline();
    expect(report.started).toHaveLength(3);
  });

  it("does not consume budget for a session that failed to start", async () => {
    failStart.add("breaks");
    await seed("Breaks", { fit: "Strong" });
    for (let i = 0; i < 3; i++) await seed(`Strong ${i}`, { fit: "Strong" });
    const report = await runPipeline();
    expect(report.errors[0]).toMatchObject({ slug: "breaks", step: "research" });
    expect(report.started).toHaveLength(3); // the failure did not eat a slot
  });
});

describe("runPipeline — finalize", () => {
  it("reports sessions still in flight separately from finished ones", async () => {
    await seed("Done Now", {}, { dossier_status: "running", dossier_session: "s1" });
    await seed("Still Going", {}, { dossier_status: "running", dossier_session: "s2" });
    finalizes.set("done-now", true);
    const report = await runPipeline();
    expect(report.finalized).toEqual(["done-now"]);
    expect(report.running).toEqual(["still-going"]);
  });

  it("captures a finalize failure without aborting the run", async () => {
    await seed("Explodes", {}, { dossier_status: "running", dossier_session: "s1" });
    finalizes.set("explodes", true);
    const mod = await import("../crm/lib/research.ts");
    vi.spyOn(mod, "finalizeResearch").mockRejectedValueOnce(new Error("files api down"));
    await seed("Strong", { fit: "Strong" });
    const report = await runPipeline();
    expect(report.errors).toEqual([{ slug: "explodes", step: "finalize", message: "files api down" }]);
    expect(report.started).toEqual(["strong"]); // later steps still ran
  });
});

describe("runPipeline — report", () => {
  it("surfaces follow-ups due today and overdue, but not future or closed ones", async () => {
    await seed("Due Today", {}, { follow_up: ymd(0) });
    await seed("Overdue", {}, { follow_up: ymd(-5 * day) });
    await seed("Future", {}, { follow_up: ymd(5 * day) });
    await seed("Dead But Due", {}, { follow_up: ymd(-day), status: "dead" });
    const report = await runPipeline();
    expect(report.followupsDue.map((f) => f.slug).sort()).toEqual(["due-today", "overdue"]);
  });

  it("lists targets discovered in the last 24 hours", async () => {
    await seed("Fresh");
    await seed("Old");
    // Age one record past the window.
    const key = "targets/old.json";
    records.set(key, JSON.stringify({ ...JSON.parse(records.get(key)!), discovered_at: iso(-2 * day) }));
    const report = await runPipeline();
    expect(report.newTargets.map((t) => t.slug)).toEqual(["fresh"]);
  });

  it("queues researched-and-drafted targets that the human has not triaged yet", async () => {
    await seed("Ready", {}, { dossier_status: "done", outreach: "draft" });
    await seed("Already Triaged", {}, { dossier_status: "done", outreach: "draft", status: "contacted" });
    const report = await runPipeline();
    expect(report.readyForReview.map((t) => t.slug)).toEqual(["ready"]);
  });

  it("returns an empty report for an empty pipeline without calling anything", async () => {
    const report = await runPipeline();
    expect(report).toEqual({
      finalized: [], started: [], drafted: [], followupsDue: [],
      newTargets: [], running: [], readyForReview: [], errors: [],
    });
    expect(calls).toEqual([]);
  });
});

describe("renderBrief", () => {
  const empty = {
    finalized: [], started: [], drafted: [], followupsDue: [],
    newTargets: [], running: [], readyForReview: [], errors: [],
  };

  it("summarizes the run in the subject line", () => {
    const { subject } = renderBrief(
      { ...empty, drafted: [{ slug: "a", channels: ["email"] }], finalized: ["b"], followupsDue: [{ slug: "c", company: "C", follow_up: "2026-01-01", status: "new" }] },
      "https://crm.example",
    );
    expect(subject).toBe("Pipeline overnight — 1 drafted, 1 researched, 1 follow-ups due");
  });

  it("escapes company names, which come from agent web research", () => {
    const { html } = renderBrief(
      { ...empty, newTargets: [{ slug: "x", company: '<img src=x onerror="alert(1)">', fit: "Strong" }] },
      "https://crm.example",
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("escapes error text and follow-up fields too", () => {
    const { html } = renderBrief(
      {
        ...empty,
        errors: [{ slug: "<b>s</b>", step: "<i>x</i>", message: "<script>bad</script>" }],
        followupsDue: [{ slug: "s", company: "<u>C</u>", follow_up: "2026-01-01", status: "new" }],
      },
      "https://crm.example",
    );
    // The template's own <b> wrapper is fine; what must never survive is markup
    // that arrived inside a value.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<u>");
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(html).toContain("&lt;u&gt;C&lt;/u&gt;");
    expect(html).toContain("&lt;i&gt;x&lt;/i&gt;");
  });

  it("refuses a non-http CRM url rather than emitting a javascript: link", () => {
    const { html } = renderBrief(empty, "javascript:alert(1)");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="#">Open the CRM</a>');
  });

  it("accepts a normal https url", () => {
    expect(renderBrief(empty, "https://crm.example").html).toContain('href="https://crm.example"');
  });

  it("shows an explicit empty state for every section rather than a blank email", () => {
    const { html } = renderBrief(empty, "https://crm.example");
    for (const msg of ["No new drafts.", "None finished overnight.", "Nothing due. Clear runway.", "Queue is clear."]) {
      expect(html).toContain(msg);
    }
  });

  it("omits the errors section entirely when the run was clean", () => {
    expect(renderBrief(empty, "https://crm.example").html).not.toContain("Errors");
  });

  it("restates the human-in-the-loop rule in the footer", () => {
    expect(renderBrief(empty, "https://crm.example").html).toContain("nothing is ever sent without you");
  });
});

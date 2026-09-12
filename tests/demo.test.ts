import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { setStore, type Store } from "../crm/lib/storage.ts";
import { upsertTarget, readOneBySlug, listTargets, type Target } from "../crm/lib/store.ts";
import { startResearch, finalizeResearch } from "../crm/lib/research.ts";
import { draftOutreach } from "../crm/lib/outreach.ts";

// The README's headline promise: run the demo with no key, open a target, research it,
// watch a brief attach, draft outreach, run a sponsor profile and watch its portfolio
// auto-add. Every module behind those verbs was previously unexecuted by the suite.
// Demo mode fakes the session on a 4s timer (lib/demo.ts), so fake timers drive the
// whole round-trip deterministically — and prove the canned path never touches the SDK.

const records = new Map<string, string>();
const memoryStore: Store = {
  async read(k) { return records.get(k) ?? null; },
  async write(k, b) { records.set(k, b); },
  async list(p) { return [...records.keys()].filter((k) => k.startsWith(p)); },
  async remove(k) { records.delete(k); },
};

// isDemo() = BD_DESK_DEMO===1 && !VERCEL. Force both for the file, restore after.
const savedEnv = { demo: process.env.BD_DESK_DEMO, vercel: process.env.VERCEL };
beforeAll(() => { process.env.BD_DESK_DEMO = "1"; delete process.env.VERCEL; });
afterAll(() => {
  if (savedEnv.demo === undefined) delete process.env.BD_DESK_DEMO;
  else process.env.BD_DESK_DEMO = savedEnv.demo;
  if (savedEnv.vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = savedEnv.vercel;
  setStore(null);
});

const T0 = new Date("2026-03-02T12:00:00.000Z");

beforeEach(() => {
  records.clear();
  setStore(memoryStore);
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const seed = async (input: Partial<Target> & { company: string }) => (await upsertTarget(input)).slug;
const advancePastDeadline = () => vi.setSystemTime(new Date(T0.getTime() + 5000));

describe("demo research round-trip", () => {
  it("reports running until the demo session's deadline, then attaches the canned brief + people", async () => {
    const slug = await seed({ company: "Cascade Provisions Co.", fit: "Strong" });

    const started = await startResearch(slug);
    expect(started).toMatchObject({ status: "running" });
    expect(started!.session).toMatch(/^demo:/);

    // Before the 4s demo deadline: the poll returns null (still "running").
    expect(await finalizeResearch((await readOneBySlug(slug))!)).toBeNull();

    advancePastDeadline();
    const done = await finalizeResearch((await readOneBySlug(slug))!);
    expect(done!.dossier_status).toBe("done");
    expect(done!.dossier).toMatch(/^# Pre-Engagement Dossier/);
    expect(done!.people!.length).toBeGreaterThan(0);
    expect(done!.grade).toBe("satisfied");
  });

  it("finalizes a second company on the canned path without a key set", async () => {
    // Proof the demo path never constructs an Anthropic client: no ANTHROPIC_API_KEY
    // is set here, so a leak to the real path would throw rather than resolve.
    const slug = await seed({ company: "Marlow Beverage Works", fit: "Strong" });
    await startResearch(slug);
    advancePastDeadline();
    await expect(finalizeResearch((await readOneBySlug(slug))!)).resolves.toBeTruthy();
  });
});

describe("demo sponsor profile — the self-feeding portco loop", () => {
  it("auto-adds qualifying portcos, skips a name-variant of an existing target and a Skip", async () => {
    // Seed the target the demo portfolio deliberately duplicates, so the dedup can fire.
    await seed({ company: "Cascade Provisions Co.", fit: "Strong" });
    const contactSlug = await seed({
      company: "Thornbury Fund", kind: "contact", contact_name: "Dana Reed", sponsor: "Thornbury Fund",
    });
    const before = (await listTargets()).length;

    await startResearch(contactSlug);
    advancePastDeadline();
    const done = await finalizeResearch((await readOneBySlug(contactSlug))!);

    expect(done!.dossier).toMatch(/^# Sponsor Profile/);
    expect(done!.dossier).toMatch(/portcos added to the pipeline/);

    const after = await listTargets();
    // Two qualifying portcos added; the "Cascade Provisions" variant and the Skip are not.
    expect(after.length).toBe(before + 2);
    const companies = after.map((t) => t.company);
    expect(companies).toContain("Fairhaven Foods Group");
    expect(companies).toContain("Sterling Creek Beverage");
    expect(companies).not.toContain("Bellweather Snack Co."); // Skip — below the fit bar
    expect(companies.filter((c) => /^Cascade Provisions/.test(c))).toHaveLength(1); // no duplicate
  });
});

describe("demo outreach", () => {
  it("drafts a canned email and LinkedIn note off the card and saves them to the record", async () => {
    const slug = await seed({ company: "Cascade Provisions Co.", fit: "Strong" });

    const email = await draftOutreach(slug, "email");
    expect(email!.text).toMatch(/^Subject:/);
    expect((await readOneBySlug(slug))!.outreach).toBe(email!.text);

    const li = await draftOutreach(slug, "linkedin");
    expect(li!.text.length).toBeGreaterThan(0);
    expect((await readOneBySlug(slug))!.linkedin_note).toBe(li!.text);
  });
});

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// The REAL (non-demo) research lifecycle: the graded session poll, the deliverable
// fetch with its retry + message-log fallback, the empty-deliverable→error rule, the
// self-feeding portco add, and the deferred-kickoff wiring in startResearch. All of it
// was previously untested because it needs the Managed Agents SDK and next/server's
// after(). Both are mocked here so the lifecycle logic runs against fixtures we control.
//
// Env is set inside vi.hoisted so it lands BEFORE research.ts reads process.env for its
// module-level AGENT_ID / SPONSOR_AGENT_ID / ENVIRONMENT_ID consts.
const fx = vi.hoisted(() => {
  process.env.DOSSIER_AGENT_ID = "agent_dossier";
  process.env.SPONSOR_AGENT_ID = "agent_sponsor";
  process.env.ENVIRONMENT_ID = "env_1";
  delete process.env.BD_DESK_DEMO; // force the real path, never the canned one
  return {
    session: null as unknown,
    files: [] as unknown[],
    fileText: "",
    events: [] as unknown[],
    created: null as unknown,
    createdId: "sess_new",
    sent: [] as unknown[],
    throwOnSend: false,
    afterCalls: [] as Promise<unknown>[],
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    beta = {
      sessions: {
        retrieve: async () => fx.session,
        create: async (args: unknown) => { fx.created = args; return { id: fx.createdId }; },
        events: {
          list: async () => ({ data: fx.events }),
          send: async (id: string, body: unknown) => {
            fx.sent.push({ id, body });
            if (fx.throwOnSend) throw new Error("send failed");
          },
        },
      },
      files: {
        list: async () => ({ data: fx.files }),
        download: async () => ({ text: async () => fx.fileText }),
      },
    };
  }
  return { default: MockAnthropic };
});

// after(cb) runs post-response in prod; here we run cb now and keep its promise so a
// test can await the deferred kickoff deterministically.
vi.mock("next/server", () => ({ after: (cb: () => Promise<unknown>) => { fx.afterCalls.push(cb()); } }));

import { setStore, type Store } from "../crm/lib/storage.ts";
import { upsertTarget, patchTarget, readOneBySlug, listTargets, type Target } from "../crm/lib/store.ts";
import { finalizeResearch, startResearch } from "../crm/lib/research.ts";

const records = new Map<string, string>();
const memoryStore: Store = {
  async read(k) { return records.get(k) ?? null; },
  async write(k, b) { records.set(k, b); },
  async list(p) { return [...records.keys()].filter((k) => k.startsWith(p)); },
  async remove(k) { records.delete(k); },
};

beforeEach(() => {
  records.clear();
  setStore(memoryStore);
  fx.session = null; fx.files = []; fx.fileText = ""; fx.events = [];
  fx.created = null; fx.createdId = "sess_new"; fx.sent = []; fx.throwOnSend = false; fx.afterCalls = [];
});
afterAll(() => setStore(null));

const terminal = (result = "satisfied", explanation = "meets the bar") => ({
  status: "idle",
  stop_reason: null,
  outcome_evaluations: [{ result, completed_at: "2026-03-02T12:00:00Z", explanation }],
});
const stillRunning = () => ({ status: "idle", stop_reason: null, outcome_evaluations: [] });

// A downloadable deliverable.md, so fetchDeliverable resolves on the first attempt
// (empty text falls through to the message-log fallback with no retry sleeps).
const withFile = (text: string) => { fx.files = [{ id: "f1", filename: "outputs/deliverable.md", downloadable: true }]; fx.fileText = text; };

async function seedRunning(company: string, session = "sess_1"): Promise<Target> {
  const { slug } = await upsertTarget({ company, fit: "Strong" });
  await patchTarget(slug, { dossier_status: "running", dossier_session: session });
  return (await readOneBySlug(slug))!;
}

describe("finalizeResearch — guards", () => {
  it("returns null when the target isn't running", async () => {
    const t = { slug: "x", company: "X", status: "new" } as Target;
    expect(await finalizeResearch(t)).toBeNull();
  });

  it("returns null (leaves it running) when the graded session hasn't finished", async () => {
    const t = await seedRunning("Acme Foods");
    fx.session = stillRunning(); // idle but zero evaluations → not done under requireEvaluation
    expect(await finalizeResearch(t)).toBeNull();
    expect((await readOneBySlug(t.slug))!.dossier_status).toBe("running");
  });
});

describe("finalizeResearch — attaching a finished brief", () => {
  it("strips the machine blocks, attaches people, auto-adds a portco, and records the grade", async () => {
    const t = await seedRunning("Acme Foods");
    fx.session = terminal("satisfied", "clears the rubric");
    withFile(
      `# Pre-Engagement Dossier — Acme Foods\n\nThe angle, in prose.\n\n` +
        `<people>[{"name":"Dana Whitfield","title":"VP Ops"}]</people>\n\n` +
        `<portcos>[{"company":"New Portco Inc","fit":"Strong","sponsor":"Blackstone"}]</portcos>\n`,
    );

    const done = (await finalizeResearch(t))!;
    expect(done.dossier_status).toBe("done");
    expect(done.dossier).toMatch(/^# Pre-Engagement Dossier/);
    expect(done.dossier).not.toMatch(/<people>|<portcos>/); // raw JSON blocks never reach the reader
    expect(done.dossier).toMatch(/portco added to the pipeline/); // the auto-add receipt
    expect(done.people).toEqual([{ name: "Dana Whitfield", title: "VP Ops" }]);
    expect(done.grade).toBe("satisfied");
    expect(done.grade_notes).toBe("clears the rubric");

    // The portco is now its own pipeline target — the self-feeding loop.
    expect((await listTargets()).map((x) => x.company)).toContain("New Portco Inc");
  });

  it("falls back to the message log when the deliverable file is empty", async () => {
    const t = await seedRunning("Bevco");
    fx.session = terminal();
    withFile(""); // file present but empty → fetchDeliverable returns "" with no retry wait
    fx.events = [
      { type: "agent.message", content: [{ type: "text", text: "# Pre-Engagement Dossier — Bevco\n\nrebuilt from events" }] },
    ];

    const done = (await finalizeResearch(t))!;
    expect(done.dossier_status).toBe("done");
    expect(done.dossier).toMatch(/rebuilt from events/);
  });

  it("marks a terminal session with no deliverable as error, never freezing an empty brief", async () => {
    const t = await seedRunning("Ghostco");
    fx.session = terminal("max_iterations_reached");
    withFile(""); // no file text …
    fx.events = []; // … and no messages either

    const done = (await finalizeResearch(t))!;
    expect(done.dossier_status).toBe("error");
    expect(done.dossier ?? "").not.toMatch(/#/);
  });

  it("polls past the file-index lag before giving up (retry loop, no file yet)", async () => {
    vi.useFakeTimers();
    try {
      const t = await seedRunning("Laggard Co");
      fx.session = terminal();
      fx.files = []; // file never indexes → fetchDeliverable burns its 4 attempts
      fx.events = [
        { type: "agent.message", content: [{ type: "text", text: "# Pre-Engagement Dossier — Laggard Co\n\nlate but here" }] },
      ];
      const p = finalizeResearch(t);
      await vi.advanceTimersByTimeAsync(8000); // cover 3×2000ms retry sleeps
      const done = (await p)!;
      expect(done.dossier_status).toBe("done");
      expect(done.dossier).toMatch(/late but here/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("startResearch — real path", () => {
  it("creates a session, marks it running, and defers the graded kickoff to after()", async () => {
    const { slug } = await upsertTarget({ company: "Acme Foods", fit: "Strong" });
    fx.createdId = "sess_abc";

    const started = await startResearch(slug);
    expect(started).toEqual({ status: "running", session: "sess_abc" });
    expect((fx.created as { agent: string; environment_id: string }).agent).toBe("agent_dossier");
    expect((fx.created as { environment_id: string }).environment_id).toBe("env_1");

    const t = (await readOneBySlug(slug))!;
    expect(t.dossier_status).toBe("running");
    expect(t.dossier_session).toBe("sess_abc");

    // The kickoff was deferred, not sent inline.
    await Promise.all(fx.afterCalls);
    expect(fx.sent).toHaveLength(1);
    expect((fx.sent[0] as { id: string }).id).toBe("sess_abc");
  });

  it("hands back the in-flight session instead of starting a second run", async () => {
    const t = await seedRunning("Acme Foods", "sess_live");
    const again = await startResearch(t.slug);
    expect(again).toEqual({ status: "running", session: "sess_live" });
    expect(fx.created).toBeNull(); // no new session created
  });

  it("marks the target errored if the deferred kickoff throws", async () => {
    const { slug } = await upsertTarget({ company: "Acme Foods", fit: "Strong" });
    fx.throwOnSend = true;

    await startResearch(slug);
    await Promise.all(fx.afterCalls);

    expect((await readOneBySlug(slug))!.dossier_status).toBe("error");
  });
});

describe("startResearch — contact without a sponsor agent", () => {
  it("refuses rather than routing a sponsor prompt through the dossier agent", async () => {
    // Fresh module graph with SPONSOR_AGENT_ID unset, wired to the same memory store.
    vi.resetModules();
    const saved = process.env.SPONSOR_AGENT_ID;
    delete process.env.SPONSOR_AGENT_ID;
    try {
      const storage = await import("../crm/lib/storage.ts");
      const store = await import("../crm/lib/store.ts");
      const research = await import("../crm/lib/research.ts");
      records.clear();
      storage.setStore(memoryStore);
      const { slug } = await store.upsertTarget({ company: "Thornbury Fund", kind: "contact", contact_name: "Dana Reed" });

      await expect(research.startResearch(slug)).rejects.toThrow(/SPONSOR_AGENT_ID/);
      expect((await store.readOneBySlug(slug))!.dossier_status).toBe("error");
    } finally {
      if (saved === undefined) delete process.env.SPONSOR_AGENT_ID;
      else process.env.SPONSOR_AGENT_ID = saved;
      vi.resetModules();
    }
  });
});

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setStore, type Store } from "../crm/lib/storage.ts";
import {
  slugify, upsertTarget, patchTarget, listTargets, readOneBySlug,
  deleteTarget, addContentSeed, EDITABLE,
} from "../crm/lib/store.ts";

// store.ts is the only place human-owned fields and agent-sourced fields meet, so
// these tests are about one question: can a re-send from an agent ever clobber
// something the operator typed? An in-memory driver stands in for Vercel Blob.
const records = new Map<string, string>();
const memoryStore: Store = {
  async read(key) {
    return records.get(key) ?? null;
  },
  async write(key, body) {
    records.set(key, body);
  },
  async list(prefix) {
    return [...records.keys()].filter((k) => k.startsWith(prefix));
  },
  async remove(key) {
    records.delete(key);
  },
};

setStore(memoryStore);
afterAll(() => setStore(null));

beforeEach(() => records.clear());

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Freight Systems")).toBe("acme-freight-systems");
  });

  it("collapses punctuation runs and trims leading/trailing hyphens", () => {
    expect(slugify("  ***Acme & Co., Inc.***  ")).toBe("acme-co-inc");
  });

  it("caps length so a pathological name can't produce an unbounded key", () => {
    expect(slugify("a".repeat(500))).toHaveLength(80);
  });

  it("falls back to a usable slug when nothing survives", () => {
    expect(slugify("!!!")).toBe("target");
    expect(slugify("")).toBe("target");
  });

  it("strips path separators so caller input can never shape the blob key", () => {
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("a/b")).toBe("a-b");
  });
});

describe("upsertTarget", () => {
  it("creates a record with a slug derived from the company", async () => {
    const t = await upsertTarget({ company: "Acme Freight" });
    expect(t.slug).toBe("acme-freight");
    expect(t.status).toBe("new");
    expect(t.discovered_at).toBeTruthy();
  });

  it("re-slugifies a caller-supplied slug rather than trusting it", async () => {
    const t = await upsertTarget({ company: "Acme", slug: "../escape/Attempt" });
    expect(t.slug).toBe("escape-attempt");
    expect([...records.keys()]).toEqual(["targets/escape-attempt.json"]);
  });

  it("refreshes sourced fields on a re-send", async () => {
    await upsertTarget({ company: "Acme", fit: "Worth a look", hq: "Denver" });
    const t = await upsertTarget({ company: "Acme", fit: "Strong", hq: "Boulder" });
    expect(t.fit).toBe("Strong");
    expect(t.hq).toBe("Boulder");
  });

  it("never lets a re-send overwrite a human-edited field", async () => {
    await upsertTarget({ company: "Acme" });
    await patchTarget("acme", {
      status: "contacted",
      notes: "spoke to Dana",
      next_step: "send proposal",
      outreach: "my own rewrite",
    });
    // The Radar re-sends the same company with its own idea of every field.
    const t = await upsertTarget({
      company: "Acme",
      status: "new",
      notes: "agent notes",
      next_step: "agent step",
      outreach: "agent draft",
      fit: "Strong",
    } as never);
    expect(t.status).toBe("contacted");
    expect(t.notes).toBe("spoke to Dana");
    expect(t.next_step).toBe("send proposal");
    expect(t.outreach).toBe("my own rewrite");
    expect(t.fit).toBe("Strong"); // sourced field still refreshes
  });

  it("protects every field listed in EDITABLE", async () => {
    // Guards against someone adding a human-owned field to the Target interface
    // and forgetting the merge rule — the list is the contract.
    await upsertTarget({ company: "Acme" });
    const human = Object.fromEntries(EDITABLE.map((k) => [k, `human-${k}`]));
    await patchTarget("acme", { ...human, status: "won" } as never);
    const t = await upsertTarget({
      company: "Acme",
      ...Object.fromEntries(EDITABLE.map((k) => [k, `agent-${k}`])),
    } as never);
    for (const k of EDITABLE) {
      if (k === "status") continue; // covered above; not a free-text field
      expect(t[k]).toBe(`human-${k}`);
    }
  });

  it("preserves discovered_at and advances updated_at", async () => {
    const first = await upsertTarget({ company: "Acme" });
    await new Promise((r) => setTimeout(r, 5));
    const second = await upsertTarget({ company: "Acme" });
    expect(second.discovered_at).toBe(first.discovered_at);
    expect(second.updated_at! > first.updated_at!).toBe(true);
  });
});

describe("patchTarget", () => {
  it("returns null for an unknown slug instead of creating one", async () => {
    expect(await patchTarget("nope", { notes: "x" })).toBeNull();
    expect(records.size).toBe(0);
  });

  it("ignores fields outside EDITABLE", async () => {
    await upsertTarget({ company: "Acme", fit: "Strong" });
    const t = await patchTarget("acme", { fit: "Skip", company: "Hijacked", slug: "elsewhere" } as never);
    expect(t!.fit).toBe("Strong");
    expect(t!.company).toBe("Acme");
    expect(t!.slug).toBe("acme");
  });

  it("rejects a status outside the known set", async () => {
    await upsertTarget({ company: "Acme" });
    await expect(patchTarget("acme", { status: "archived" } as never)).rejects.toThrow("bad status");
    expect((await readOneBySlug("acme"))!.status).toBe("new"); // unchanged on disk
  });

  it("accepts every valid status", async () => {
    await upsertTarget({ company: "Acme" });
    for (const s of ["new", "researching", "contacted", "won", "dead"] as const) {
      expect((await patchTarget("acme", { status: s }))!.status).toBe(s);
    }
  });
});

describe("addContentSeed", () => {
  it("appends seeds in order with a timestamp and source", async () => {
    await upsertTarget({ company: "Acme" });
    await addContentSeed("acme", "  they hated the onboarding  ", "dossier");
    const t = await addContentSeed("acme", "second one", "reply");
    expect(t!.content_seeds).toHaveLength(2);
    expect(t!.content_seeds![0].note).toBe("they hated the onboarding"); // trimmed
    expect(t!.content_seeds![0].source).toBe("dossier");
    expect(t!.content_seeds![1].source).toBe("reply");
    expect(t!.content_seeds![0].captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("defaults the source to manual and returns null for an unknown slug", async () => {
    await upsertTarget({ company: "Acme" });
    expect((await addContentSeed("acme", "note"))!.content_seeds![0].source).toBe("manual");
    expect(await addContentSeed("ghost", "note")).toBeNull();
  });
});

describe("listTargets / deleteTarget", () => {
  it("sorts newest-discovered first", async () => {
    await upsertTarget({ company: "First" });
    await new Promise((r) => setTimeout(r, 5));
    await upsertTarget({ company: "Second" });
    expect((await listTargets()).map((t) => t.company)).toEqual(["Second", "First"]);
  });

  it("returns an empty list when nothing is stored", async () => {
    expect(await listTargets()).toEqual([]);
  });

  it("removes only the requested record", async () => {
    await upsertTarget({ company: "Keep" });
    await upsertTarget({ company: "Drop" });
    await deleteTarget("drop");
    expect((await listTargets()).map((t) => t.company)).toEqual(["Keep"]);
    expect(await readOneBySlug("drop")).toBeNull();
  });
});

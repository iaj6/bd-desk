import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setStore, type Store } from "../crm/lib/storage.ts";
import { upsertTarget, readOneBySlug } from "../crm/lib/store.ts";
import { GET, POST } from "../crm/app/api/targets/route.ts";
import { PATCH, DELETE } from "../crm/app/api/targets/[slug]/route.ts";

// The REST doors are where a malformed write is supposed to bounce off zod (lib/schema)
// and map to a clean status via lib/http, instead of reaching storage and later 500-ing
// an export or crashing the drawer. These tests drive the real handlers against an
// in-memory store — the `@/lib/*` imports inside the routes resolve to the SAME module
// instances the test swaps, so setStore() reaches the handler.

const records = new Map<string, string>();
const memoryStore: Store = {
  async read(k) { return records.get(k) ?? null; },
  async write(k, b) { records.set(k, b); },
  async list(p) { return [...records.keys()].filter((k) => k.startsWith(p)); },
  async remove(k) { records.delete(k); },
};
beforeEach(() => { records.clear(); setStore(memoryStore); });
afterAll(() => setStore(null));

// The routes only ever call req.json(); a plain web Request satisfies the NextRequest
// parameter at runtime. Params arrive as a promise, matching the Next 16 signature.
const post = (body: unknown) =>
  POST(new Request("http://t/api/targets", { method: "POST", body: JSON.stringify(body) }) as never);
const postRaw = (raw: string) =>
  POST(new Request("http://t/api/targets", { method: "POST", body: raw }) as never);
const patch = (slug: string, body: unknown) =>
  PATCH(new Request("http://t", { method: "PATCH", body: JSON.stringify(body) }) as never, {
    params: Promise.resolve({ slug }),
  });
const del = (slug: string) =>
  DELETE(new Request("http://t", { method: "DELETE" }) as never, { params: Promise.resolve({ slug }) });

// NextResponse.json() is typed to resolve `unknown`; the doors return small, known shapes.
const body = <T = Record<string, unknown>>(res: Response) => res.json() as Promise<T>;

describe("POST /api/targets (agent ingest door)", () => {
  it("rejects a body with no company as 400, without writing anything", async () => {
    const res = await post({ fit: "Strong" });
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatch(/company/);
    expect(records.size).toBe(0);
  });

  it("rejects an out-of-enum fit as 400", async () => {
    const res = await post({ company: "Acme Co", fit: "Amazing" });
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatch(/fit/);
  });

  it("maps malformed JSON to 400, not 500", async () => {
    const res = await postRaw("{not json");
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatch(/JSON/i);
  });

  it("accepts a valid target, persists it, and returns its slug", async () => {
    const res = await post({ company: "Cascade Provisions Co.", fit: "Strong", sponsor: "Calderwick Capital" });
    expect(res.status).toBe(200);
    const { ok, slug } = await body<{ ok: boolean; slug: string }>(res);
    expect(ok).toBe(true);
    expect(slug).toBe("cascade-provisions-co");
    expect((await readOneBySlug(slug))!.sponsor).toBe("Calderwick Capital");
  });

  it("strips server-owned and unknown keys — status starts at 'new' regardless of input", async () => {
    const res = await post({ company: "Marlow Beverage Works", status: "won", evil: "drop table" });
    expect(res.status).toBe(200);
    const stored = (await readOneBySlug("marlow-beverage-works"))!;
    expect(stored.status).toBe("new"); // status is server-owned; the ingest value is ignored
    expect((stored as unknown as Record<string, unknown>).evil).toBeUndefined();
  });
});

describe("GET /api/targets", () => {
  it("returns the stored targets as JSON", async () => {
    await upsertTarget({ company: "Harrow & Vance Ingredients", fit: "Worth a look" });
    const res = await GET();
    const list = (await res.json()) as { company: string }[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.map((t) => t.company)).toContain("Harrow & Vance Ingredients");
  });
});

describe("PATCH /api/targets/[slug] (human-fields door)", () => {
  it("updates an editable field and echoes the record", async () => {
    await upsertTarget({ company: "Cascade Provisions Co.", fit: "Strong" });
    const res = await patch("cascade-provisions-co", { status: "contacted", notes: "Dana replied" });
    expect(res.status).toBe(200);
    const updated = await body(res);
    expect(updated.status).toBe("contacted");
    expect(updated.notes).toBe("Dana replied");
  });

  it("rejects an out-of-enum status as 400", async () => {
    await upsertTarget({ company: "Cascade Provisions Co.", fit: "Strong" });
    const res = await patch("cascade-provisions-co", { status: "closed-won" });
    expect(res.status).toBe(400);
  });

  it("strips a non-editable field — a fit patch is a no-op, never a clobber", async () => {
    await upsertTarget({ company: "Cascade Provisions Co.", fit: "Strong" });
    const res = await patch("cascade-provisions-co", { fit: "Skip", notes: "kept" });
    expect(res.status).toBe(200);
    const stored = (await readOneBySlug("cascade-provisions-co"))!;
    expect(stored.fit).toBe("Strong"); // fit isn't a human-editable field; the patch drops it
    expect(stored.notes).toBe("kept");
  });

  it("returns 404 for an unknown slug", async () => {
    const res = await patch("nope", { status: "won" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/targets/[slug]", () => {
  it("deletes an existing target", async () => {
    await upsertTarget({ company: "Sablefish Foods" });
    const res = await del("sablefish-foods");
    expect(res.status).toBe(200);
    expect(await readOneBySlug("sablefish-foods")).toBeNull();
  });

  it("returns 404 for an unknown slug rather than a silent ok", async () => {
    const res = await del("never-existed");
    expect(res.status).toBe(404);
  });
});

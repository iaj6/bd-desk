import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// blobStore reaches @vercel/blob; mock it so the pagination loop can be exercised
// without a real Blob store (and without touching the network). @vercel/blob is a
// crm-only dep, so hold the mock via vi.hoisted rather than importing it from here.
const blobMock = vi.hoisted(() => ({ list: vi.fn(), put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => blobMock);

import { fileStore, isDemo, blobStore } from "../crm/lib/storage.ts";

// The filesystem driver only runs in demo mode, but it is the one that turns a
// storage key into a real path — so the traversal guard is worth pinning down.

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bd-desk-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("fileStore", () => {
  it("round-trips a value and creates nested directories on the way", async () => {
    const s = fileStore(dir);
    await s.write("targets/acme-freight.json", '{"company":"Acme"}');
    expect(await s.read("targets/acme-freight.json")).toBe('{"company":"Acme"}');
    expect(await readFile(join(dir, "targets/acme-freight.json"), "utf8")).toBe('{"company":"Acme"}');
  });

  it("returns null for a missing key rather than throwing", async () => {
    expect(await fileStore(dir).read("targets/ghost.json")).toBeNull();
  });

  it("overwrites in place", async () => {
    const s = fileStore(dir);
    await s.write("k.json", "one");
    await s.write("k.json", "two");
    expect(await s.read("k.json")).toBe("two");
  });

  it("lists by string prefix, not just by directory", async () => {
    const s = fileStore(dir);
    await s.write("targets/a.json", "1");
    await s.write("targets/b.json", "2");
    await s.write("brand/pack.json", "3");
    expect((await s.list("targets/")).sort()).toEqual(["targets/a.json", "targets/b.json"]);
    expect(await s.list("brand/")).toEqual(["brand/pack.json"]);
    expect((await s.list("")).sort()).toEqual(["brand/pack.json", "targets/a.json", "targets/b.json"]);
  });

  it("returns an empty list for an unseeded directory", async () => {
    expect(await fileStore(join(dir, "nothing-here")).list("targets/")).toEqual([]);
  });

  it("removes a key and is a no-op on a key that never existed", async () => {
    const s = fileStore(dir);
    await s.write("k.json", "v");
    await s.remove("k.json");
    expect(await s.read("k.json")).toBeNull();
    await expect(s.remove("k.json")).resolves.toBeUndefined();
  });

  it("refuses keys that would escape the data directory", async () => {
    const s = fileStore(dir);
    for (const evil of ["../outside.json", "targets/../../outside.json", "/etc/passwd"]) {
      await expect(s.write(evil, "x")).rejects.toThrow(/unsafe storage key|EACCES|EROFS/);
    }
  });

  it("does not confuse a sibling directory with a prefix match", async () => {
    // resolve() on "targets-evil" must not be accepted as living under "targets".
    const s = fileStore(join(dir, "targets"));
    await expect(s.write("../targets-evil/x.json", "x")).rejects.toThrow("unsafe storage key");
  });

  it("tolerates a pre-existing directory tree it did not create", async () => {
    await mkdir(join(dir, "targets"), { recursive: true });
    await writeFile(join(dir, "targets/seeded.json"), "seeded");
    expect(await fileStore(dir).read("targets/seeded.json")).toBe("seeded");
  });
});

describe("isDemo", () => {
  const saved = { demo: process.env.BD_DESK_DEMO, vercel: process.env.VERCEL };
  afterEach(() => {
    process.env.BD_DESK_DEMO = saved.demo;
    process.env.VERCEL = saved.vercel;
    if (saved.demo === undefined) delete process.env.BD_DESK_DEMO;
    if (saved.vercel === undefined) delete process.env.VERCEL;
  });

  it("is off unless explicitly requested", () => {
    delete process.env.BD_DESK_DEMO;
    delete process.env.VERCEL;
    expect(isDemo()).toBe(false);
  });

  it("is on locally when requested", () => {
    process.env.BD_DESK_DEMO = "1";
    delete process.env.VERCEL;
    expect(isDemo()).toBe(true);
  });

  it("never activates on Vercel, so a stray env var can't downgrade a deploy", () => {
    process.env.BD_DESK_DEMO = "1";
    process.env.VERCEL = "1";
    expect(isDemo()).toBe(false);
  });
});

describe("blobStore.list pagination", () => {
  const mock = blobMock.list;

  it("follows the cursor past the first page instead of truncating at 1000", async () => {
    // The whole CRM (board, exports, digest, portco dedup) reads through list(); a
    // single un-paged call would silently drop everything past the first 1000 blobs.
    mock.mockReset();
    mock
      .mockResolvedValueOnce({ blobs: [{ pathname: "targets/a.json" }], hasMore: true, cursor: "c1" })
      .mockResolvedValueOnce({ blobs: [{ pathname: "targets/b.json" }], hasMore: false });

    const keys = await blobStore.list("targets/");

    expect(keys).toEqual(["targets/a.json", "targets/b.json"]);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[1][0]).toMatchObject({ prefix: "targets/", cursor: "c1" });
  });

  it("makes a single call when the first page is the last", async () => {
    mock.mockReset();
    mock.mockResolvedValueOnce({ blobs: [{ pathname: "targets/only.json" }], hasMore: false });

    expect(await blobStore.list("targets/")).toEqual(["targets/only.json"]);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

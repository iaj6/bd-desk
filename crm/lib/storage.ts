// The one place the CRM touches durable storage.
//
// Production runs on Vercel Blob. Demo mode (`npm run demo`) runs on the local
// filesystem, so anyone can boot the CRM with seeded data and no cloud account —
// see lib/demo.ts. Nothing above this file knows which driver is in play.
//
// Keys are blob-style paths ("targets/acme-freight.json"). Callers build them from
// slugified input, and the filesystem driver refuses anything with a path segment
// that could climb out of its data directory.
//
// SERVER ONLY. This module reaches for node:fs and the Blob API, so a client
// component that imports it (directly, or via lib/store.ts) drags node builtins into
// the browser bundle and the build fails. Client components import shapes and
// constants from lib/types.ts instead.

import { put, list as blobList, get, del } from "@vercel/blob";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export interface Store {
  /** Returns null when the key does not exist — absence is not an error. */
  read(key: string): Promise<string | null>;
  write(key: string, body: string): Promise<void>;
  /** Keys under a prefix, in no particular order. */
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
}

export const blobStore: Store = {
  async read(key) {
    try {
      const r = await get(key, { access: "private" });
      if (!r || r.statusCode !== 200) return null;
      return await new Response(r.stream).text();
    } catch {
      return null; // BlobNotFoundError → treat as absent
    }
  },
  async write(key, body) {
    await put(key, body, {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
    });
  },
  async list(prefix) {
    // Vercel Blob's list caps at 1000 per page and signals more via hasMore/cursor.
    // Follow the cursor to the end — otherwise the whole CRM (board, exports, digest,
    // portco dedup) silently truncates at 1000 targets, and the demo's filesystem
    // driver means no test or demo run could ever surface it.
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await blobList({ prefix, cursor, limit: 1000 });
      out.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  async remove(key) {
    await del(key);
  },
};

export function fileStore(dir: string): Store {
  const root = resolve(dir);
  // Defence in depth: callers already slugify, but a driver that can be pointed at
  // an arbitrary key should never be able to write outside its own directory.
  const pathFor = (key: string) => {
    const full = resolve(root, key);
    if (full !== root && !full.startsWith(root + sep)) throw new Error(`unsafe storage key: ${key}`);
    return full;
  };

  return {
    async read(key) {
      try {
        return await readFile(pathFor(key), "utf8");
      } catch {
        return null;
      }
    },
    async write(key, body) {
      const file = pathFor(key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body, "utf8");
    },
    async list(prefix) {
      // Blob prefixes are plain string prefixes, not directories ("targets/" and
      // "targets/acme" are both valid). Walk the tree and filter the same way.
      const walk = async (rel: string): Promise<string[]> => {
        let entries;
        try {
          entries = await readdir(join(root, rel), { withFileTypes: true });
        } catch {
          return [];
        }
        const out: string[] = [];
        for (const e of entries) {
          const key = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) out.push(...(await walk(key)));
          else out.push(key);
        }
        return out;
      };
      return (await walk("")).filter((k) => k.startsWith(prefix));
    },
    async remove(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}

// Demo mode is opt-in and local-only: it is never selected on Vercel, so a
// misconfigured deploy can't silently fall back to a throwaway filesystem.
export const isDemo = () => process.env.BD_DESK_DEMO === "1" && !process.env.VERCEL;

let active: Store | null = null;

export function store(): Store {
  if (!active) active = isDemo() ? fileStore(process.env.BD_DESK_DEMO_DIR ?? ".demo-data") : blobStore;
  return active;
}

/** Test/demo seam — swap the driver, or pass null to fall back to env selection. */
export function setStore(s: Store | null): void {
  active = s;
}

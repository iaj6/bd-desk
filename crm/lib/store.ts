import { store } from "./storage";
import {
  STATUSES, slugify, EDITABLE,
  type Target, type ContentSeed, type SeedSource,
} from "./types";

// Re-exported so server-side callers can keep importing shapes and storage from one
// place; client components must import from ./types directly.
export * from "./types";

// One private JSON record per target, keyed by slug. Independent writes → no
// read-modify-write races across a sweep. The storage driver (Vercel Blob in
// production, the local filesystem in demo mode) lives in ./storage.
const KEY = (slug: string) => `targets/${slug}.json`;

async function readOne(slug: string): Promise<Target | null> {
  const body = await store().read(KEY(slug));
  if (body === null) return null;
  try {
    return JSON.parse(body) as Target;
  } catch {
    return null; // corrupt record → treat as absent rather than break every read
  }
}

async function write(t: Target): Promise<void> {
  await store().write(KEY(t.slug), JSON.stringify(t));
}

export async function listTargets(): Promise<Target[]> {
  const keys = await store().list("targets/");
  const bodies = await Promise.all(keys.map((k) => store().read(k)));
  // A record can vanish between the list and the read (a concurrent delete), and a
  // half-written one can fail to parse. Neither should 500 the whole board.
  const targets = bodies.flatMap((body): Target[] => {
    if (body === null) return [];
    try {
      return [JSON.parse(body) as Target];
    } catch {
      return [];
    }
  });
  return targets.sort((a, b) =>
    (b.discovered_at ?? "").localeCompare(a.discovered_at ?? ""),
  );
}

// Upsert by slug. A re-send may refresh sourced fields (fit, signals, sources, …)
// but never clobbers the human-owned EDITABLE fields on an existing record.
export async function upsertTarget(input: Partial<Target> & { company: string }): Promise<Target> {
  // Callers may pass a slug; re-slugify it so caller input can never shape blob keys.
  const slug = slugify(input.slug || input.company);
  const existing = await readOne(slug);
  const now = new Date().toISOString();
  const sourced: Partial<Target> = { ...input };
  if (existing) for (const k of EDITABLE) delete (sourced as Record<string, unknown>)[k];
  const merged: Target = {
    ...existing,
    ...sourced,
    slug,
    company: input.company,
    status: existing?.status ?? "new", // never let a re-send reset human triage state
    discovered_at: existing?.discovered_at ?? now,
    updated_at: now,
  };
  await write(merged);
  return merged;
}

// Human edit from the UI — only touches EDITABLE fields.
export async function patchTarget(slug: string, fields: Partial<Target>): Promise<Target | null> {
  const existing = await readOne(slug);
  if (!existing) return null;
  const patch: Partial<Target> = {};
  for (const k of EDITABLE) if (k in fields) (patch as Record<string, unknown>)[k] = fields[k];
  if (patch.status && !STATUSES.includes(patch.status)) throw new Error("bad status");
  const updated: Target = { ...existing, ...patch, updated_at: new Date().toISOString() };
  await write(updated);
  return updated;
}

// Append a content seed to a target (reverse flywheel). Read-modify-write on a single
// blob. NOTE: Vercel Blob is eventually consistent, so two appends to the SAME slug
// within a few seconds can lost-update (the second reads the pre-first state). Capture
// seeds one at a time per target; don't batch same-slug captures back-to-back.
export async function addContentSeed(
  slug: string,
  note: string,
  source: SeedSource = "manual",
): Promise<Target | null> {
  const existing = await readOne(slug);
  if (!existing) return null;
  const seed: ContentSeed = { note: note.trim(), source, captured_at: new Date().toISOString() };
  const updated: Target = {
    ...existing,
    content_seeds: [...(existing.content_seeds ?? []), seed],
    updated_at: new Date().toISOString(),
  };
  await write(updated);
  return updated;
}

export async function deleteTarget(slug: string): Promise<void> {
  await store().remove(KEY(slug));
}

export async function readOneBySlug(slug: string): Promise<Target | null> {
  return readOne(slug);
}

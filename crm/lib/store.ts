import { put, list, get, del } from "@vercel/blob";

// One private JSON blob per target, keyed by slug. Independent writes → no
// read-modify-write races across a sweep. Token comes from BLOB_READ_WRITE_TOKEN.
const KEY = (slug: string) => `targets/${slug}.json`;

export type Fit = "Strong" | "Worth a look" | "Skip";
export type Status = "new" | "researching" | "contacted" | "won" | "dead";
export const STATUSES: Status[] = ["new", "researching", "contacted", "won", "dead"];

export interface Person {
  name: string;
  title?: string;
  persona?: string;
  linkedin?: string;
  source?: string;
}

// A content seed: a specifically-true observation from a real account (a "why now"
// trigger, an objection that landed, a reply-worthy hook) worth turning into a post.
// Stored raw + account-linked here; de-identified only when harvested into the content
// system (see managed_agents/src/content-harvest.ts). Never let a raw seed leave the CRM.
export type SeedSource = "dossier" | "reply" | "radar" | "manual";
export interface ContentSeed {
  note: string;
  source?: SeedSource;
  captured_at: string; // ISO
}

export interface Target {
  slug: string;
  company: string;
  kind?: "company" | "contact"; // 'contact' = a person you're reaching out to (e.g. a PE operating partner)
  contact_name?: string;
  contact_title?: string;
  sponsor?: string;
  hq?: string;
  vertical?: string;
  fit?: Fit;
  green_signals?: string[];
  why_now?: string;
  entry_persona?: string;
  sources?: string[];
  status: Status;
  // human-edited fields
  notes?: string;
  next_step?: string;
  follow_up?: string; // yyyy-mm-dd
  outreach?: string; // AI-drafted first-touch email, human-editable
  linkedin_note?: string; // AI-drafted LinkedIn connect note / short DM
  dossier?: string; // full pre-call brief from the dossier agent
  dossier_status?: "running" | "done" | "error";
  dossier_session?: string; // Managed Agents session id, for polling
  grade?: string; // platform grader verdict on the research: satisfied | max_iterations_reached | failed | interrupted
  grade_notes?: string; // grader's explanation of the verdict
  people?: Person[]; // key contacts extracted during research
  content_seeds?: ContentSeed[]; // reverse-flywheel: post-worthy observations from this account
  manual?: boolean; // added by hand vs sourced by the Radar
  discovered_at?: string;
  updated_at?: string;
}

// Fields writable via patchTarget (human edits + async research state). Never
// overwritten by an agent re-send (upsert only refreshes sourced fields).
export const EDITABLE = [
  "status", "notes", "next_step", "follow_up", "outreach", "linkedin_note",
  "dossier", "dossier_status", "dossier_session", "people", "grade", "grade_notes",
  "contact_name", "contact_title", "content_seeds",
] as const;

export function slugify(s: string): string {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "target"
  );
}

async function readOne(slug: string): Promise<Target | null> {
  try {
    const r = await get(KEY(slug), { access: "private" });
    if (!r || r.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text()) as Target;
  } catch {
    return null; // BlobNotFoundError → treat as absent
  }
}

async function write(t: Target): Promise<void> {
  await put(KEY(t.slug), JSON.stringify(t), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

export async function listTargets(): Promise<Target[]> {
  const { blobs } = await list({ prefix: "targets/" });
  const targets = await Promise.all(
    blobs.map(async (b) => {
      const r = await get(b.pathname, { access: "private" });
      return JSON.parse(await new Response(r!.stream).text()) as Target;
    }),
  );
  return targets.sort((a, b) =>
    (b.discovered_at ?? "").localeCompare(a.discovered_at ?? ""),
  );
}

// Upsert by slug. Preserves human-set fields (status) across re-sends from the agent.
export async function upsertTarget(input: Partial<Target> & { company: string }): Promise<Target> {
  const slug = input.slug || slugify(input.company);
  const existing = await readOne(slug);
  const now = new Date().toISOString();
  const merged: Target = {
    ...existing,
    ...input,
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
  await del(KEY(slug));
}

export async function readOneBySlug(slug: string): Promise<Target | null> {
  return readOne(slug);
}

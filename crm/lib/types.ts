// Shared shapes and constants for a BD target.
//
// Deliberately free of I/O: client components (app/Board.tsx) import from here, so
// anything that reaches for storage, the filesystem, or the network belongs in
// lib/store.ts or lib/storage.ts instead — importing those from a client component
// drags node builtins into the browser bundle.

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
// Stored raw + account-linked here; de-identify before anything leaves the CRM for a
// public channel. Never let a raw seed leave the CRM.
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

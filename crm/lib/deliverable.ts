// Parsing the agent's deliverable — the pure half of research.ts.
//
// Everything here turns untrusted model output into something the CRM can store:
// deciding when a graded session is actually finished, stripping research narration,
// pulling the machine-readable blocks, and recognising a company we already have
// under a different name. It does no I/O, so it can be tested directly — which
// matters, because these are the rules that were learned the hard way in production.

import type { Person } from "./store";

// A graded session idles TRANSIENTLY around evaluation cycles (the grader can still
// send it back to revise), so "idle" alone is not "done" — finalizing there yields a
// half-written deliverable. Done is: terminated, OR idle with nothing pending.
const TERMINAL_OUTCOME = new Set(["satisfied", "max_iterations_reached", "failed", "interrupted"]);

export interface GradableSession {
  status?: string;
  stop_reason?: { type?: string } | null;
  outcome_evaluations?: { result: string; completed_at?: string | null; explanation?: string | null }[] | null;
}

export function isSessionTerminal(session: GradableSession): boolean {
  if (session.status === "terminated") return true;
  if (session.status !== "idle") return false;
  if (session.stop_reason?.type === "requires_action") return false;
  return (session.outcome_evaluations ?? []).every((o) => TERMINAL_OUTCOME.has(o.result));
}

/** The grader's last completed verdict, or null if it never finished one. */
export function lastVerdict(session: GradableSession): { result: string; explanation?: string } | null {
  const graded = (session.outcome_evaluations ?? []).filter((o) => o.completed_at).pop();
  return graded ? { result: graded.result, explanation: graded.explanation ?? undefined } : null;
}

// Agents narrate while they work. The deliverable proper starts at its first H1
// ("# Pre-Engagement Dossier", "# Sponsor Profile"), so anything before that is
// preamble. No H1 at all → keep the text as-is rather than throw it away.
export function trimToDeliverable(brief: string): string {
  const h1 = brief.match(/^#\s+.+/m);
  return h1?.index ? brief.slice(h1.index).trim() : brief.trim();
}

/**
 * Pull one `<tag>[…]</tag>` machine block out of the brief.
 * Returns the parsed array (null when absent or malformed) and the brief with the
 * block removed — a malformed block is still stripped, so raw JSON never reaches
 * the reader.
 */
export function extractBlock(brief: string, tag: string): { items: unknown[] | null; rest: string } {
  const m = brief.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return { items: null, rest: brief };
  const rest = brief.replace(m[0], "").trim();
  try {
    const parsed = JSON.parse(m[1].replace(/```json|```/g, "").trim());
    return { items: Array.isArray(parsed) ? parsed : null, rest };
  } catch {
    return { items: null, rest };
  }
}

/** Keep only entries that at least carry a name; the rest is model noise. */
export function parsePeople(items: unknown[] | null): Person[] | undefined {
  if (!items) return undefined;
  return items.filter((p): p is Person => !!p && typeof (p as Person).name === "string");
}

// Duplicate detection has to survive name variants — an acronym form and the
// spelled-out company name slugify differently (observed in prod). Compare
// distinctive-token SETS: strip generic corporate words, then treat subset or
// equality as a match. Biased toward skipping — a false skip costs a mention, a
// false add costs research sessions and duplicate outreach. Extend this set with the
// filler words common in YOUR vertical's company names.
const GENERIC = new Set(
  ("systems services service solutions industries international national global partners " +
    "distribution group holdings holding company co inc llc lp corp corporation the and of").split(" "),
);

export function nameTokens(company: string): Set<string> {
  const all = (company.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 2);
  const distinctive = all.filter((w) => !GENERIC.has(w));
  return new Set(distinctive.length ? distinctive : all);
}

const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));

/** True when two company names are plausibly the same company. */
export const isNameVariant = (a: Set<string>, b: Set<string>) => isSubset(a, b) || isSubset(b, a);

// No silent caps: the profile itself records what the auto-add did, so a fund with
// 12 qualifying portcos never reads identically to one with 8.
export function portcoReceipt(added: number, capped: number, cap: number): string {
  return (
    `\n\n---\n*Auto-add receipt: ${added} portco${added === 1 ? "" : "s"} added to the pipeline` +
    (capped > 0
      ? `; ${capped} more qualified but hit the per-profile cap (${cap}) — add them manually from the Portfolio section if wanted.*`
      : `.*`)
  );
}

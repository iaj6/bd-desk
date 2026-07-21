import Anthropic from "@anthropic-ai/sdk";
import { readOneBySlug, patchTarget, upsertTarget, listTargets, slugify, type Target, type Person } from "./store";
import { defineOutcome, DELIVERABLE_FILENAME } from "./rubrics";

const FILES_BETAS = ["managed-agents-2026-04-01" as const];

// The deliverable lives in the session's output file (Files API, indexed under the
// session's scope with a short lag after idle). Null → caller falls back to
// rebuilding from the message log (sessions that predate the file contract).
async function fetchDeliverable(client: Anthropic, sessionId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    const files = await client.beta.files.list({ scope_id: sessionId, betas: FILES_BETAS });
    const f = files.data.find((x) => x.filename.endsWith(DELIVERABLE_FILENAME) && x.downloadable);
    if (f) return await (await client.beta.files.download(f.id, { betas: FILES_BETAS })).text();
  }
  return null;
}

const AGENT_ID = process.env.DOSSIER_AGENT_ID!;
const SPONSOR_AGENT_ID = process.env.SPONSOR_AGENT_ID;
const ENV_ID = process.env.ENVIRONMENT_ID!;

// Kick off a research session for a target and return immediately (it runs for minutes).
// A contact runs the sponsor-profile agent; a company runs the dossier agent.
// Returns { status: "running", session } on success, or null if the slug doesn't exist.
// Shared by the HTTP route and the MCP tool.
export async function startResearch(
  slug: string,
): Promise<{ status: "running"; session: string } | null> {
  const t = await readOneBySlug(slug);
  if (!t) return null;

  const isContact = t.kind === "contact";
  const agentId = isContact && SPONSOR_AGENT_ID ? SPONSOR_AGENT_ID : AGENT_ID;
  const prompt = isContact
    ? `Profile the PE sponsor "${t.company}" for the operating-partner outreach play. We want to reach ${t.contact_name}${t.contact_title ? `, ${t.contact_title}` : ""}. Map their full logistics/supply-chain portfolio (flag portcos worth adding as pipeline targets), recent deals, co-investors, and the key partners.`
    : `Build a BD dossier on: ${t.company}${t.sponsor ? ` (PE sponsor: ${t.sponsor})` : ""}${t.hq ? `, HQ ${t.hq}` : ""}.`;

  try {
    const client = new Anthropic();
    const session = await client.beta.sessions.create({
      agent: agentId, // latest version — no pin, so prompt updates auto-apply
      environment_id: ENV_ID,
      title: `${isContact ? "Sponsor profile" : "Dossier"}: ${t.company}`,
    });
    // Graded kickoff: the platform grader scores the deliverable against the
    // rubric and sends the agent back to revise if it falls short (see rubrics.ts).
    await client.beta.sessions.events.send(session.id, {
      events: [defineOutcome(isContact && SPONSOR_AGENT_ID ? "sponsor" : "dossier", prompt)],
    });
    await patchTarget(slug, { dossier_status: "running", dossier_session: session.id });
    return { status: "running", session: session.id };
  } catch (e) {
    await patchTarget(slug, { dossier_status: "error" });
    throw e;
  }
}

// If a target's dossier session has finished, pull the brief + people and attach it.
// Returns the updated target, or null if the session is still running / nothing to do.
// Used by both the poll endpoint and the on-load reconciler, so a finished run always
// lands in the CRM even if no browser was watching.
export async function finalizeResearch(target: Target): Promise<Target | null> {
  if (target.dossier_status !== "running" || !target.dossier_session) return null;

  const client = new Anthropic();
  const session = await client.beta.sessions.retrieve(target.dossier_session);
  // A graded session idles TRANSIENTLY around evaluation cycles (the grader can
  // still send it back to revise) — only finalize once every outcome evaluation
  // is in a terminal state, or the deliverable may be a half-done draft.
  const TERMINAL_OUTCOME = new Set(["satisfied", "max_iterations_reached", "failed", "interrupted"]);
  const terminal =
    session.status === "terminated" ||
    (session.status === "idle" &&
      (session as any).stop_reason?.type !== "requires_action" &&
      (session.outcome_evaluations ?? []).every((o) => TERMINAL_OUTCOME.has(o.result)));
  if (!terminal) return null;

  let brief = ((await fetchDeliverable(client, target.dossier_session)) ?? "").trim();
  if (!brief) {
    const events = await client.beta.sessions.events.list(target.dossier_session);
    brief = events.data
      .filter((e: any) => e.type === "agent.message")
      .flatMap((e: any) => (e.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text))
      .join("\n\n") // separate messages so the final H1 lands at a line start (not glued onto narration)
      .trim();
  }
  // Drop the agent's mid-research narration by keeping from the first H1 heading onward
  // (works for both "# Pre-Engagement Dossier" and "# Sponsor Profile").
  const h1 = brief.match(/^#\s+.+/m);
  if (h1?.index && h1.index > 0) brief = brief.slice(h1.index).trim();

  let people: Person[] | undefined;
  const pm = brief.match(/<people>([\s\S]*?)<\/people>/i);
  if (pm) {
    try {
      const arr = JSON.parse(pm[1].replace(/```json|```/g, "").trim());
      if (Array.isArray(arr)) people = arr.filter((p) => p && typeof p.name === "string") as Person[];
    } catch {
      /* leave people undefined */
    }
    brief = brief.replace(pm[0], "").trim();
  }

  // Auto-add ADD-flagged portcos from sponsor profiles (the self-feeding loop: one
  // sponsor profile → new targets the nightly pipeline researches on its own). New
  // slugs only — a portco mention is weaker signal than an existing record, so it
  // never overwrites anything already in the CRM.
  const pcm = brief.match(/<portcos>([\s\S]*?)<\/portcos>/i);
  if (pcm) {
    try {
      const arr = JSON.parse(pcm[1].replace(/```json|```/g, "").trim());
      if (Array.isArray(arr)) await addPortcos(arr);
    } catch {
      /* malformed block → skip auto-add, keep the brief */
    }
    brief = brief.replace(pcm[0], "").trim();
  }

  // Copy the platform grader's verdict onto the target (last completed evaluation).
  const graded = (session.outcome_evaluations ?? []).filter((o) => o.completed_at).pop();

  return patchTarget(target.slug, {
    dossier: brief,
    dossier_status: "done",
    ...(people ? { people } : {}),
    ...(graded ? { grade: graded.result, grade_notes: graded.explanation ?? undefined } : {}),
  });
}

const PORTCO_CAP = 8; // per sponsor profile — quality over count
const PORTCO_FITS = new Set(["Strong", "Worth a look"]);

// Duplicate detection has to survive name variants — an acronym form and the
// spelled-out company name slugify differently (observed in prod). Compare
// distinctive-token SETS: strip generic industry words, then treat subset/equality as a
// match. Biased toward skipping — a false skip costs a mention, a false add costs
// research sessions and duplicate outreach.
const GENERIC = new Set(
  ("logistics transportation transport warehousing warehouse freight systems services service solutions " +
    "distribution delivery group holdings company co inc llc lp corp corporation the and of").split(" "),
);
function nameTokens(company: string): Set<string> {
  const all = (company.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 2);
  const distinctive = all.filter((w) => !GENERIC.has(w));
  return new Set(distinctive.length ? distinctive : all);
}
const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));

async function addPortcos(arr: unknown[]): Promise<void> {
  const existing = (await listTargets()).map((t) => nameTokens(t.company));
  let budget = PORTCO_CAP;
  for (const raw of arr) {
    if (budget <= 0) break;
    const p = raw as Record<string, unknown>;
    if (!p || typeof p.company !== "string" || !p.company.trim()) continue;
    if (typeof p.fit !== "string" || !PORTCO_FITS.has(p.fit)) continue;
    const slug = slugify(p.company);
    if (await readOneBySlug(slug)) continue; // exact match → leave the curated record alone
    const tokens = nameTokens(p.company);
    if (existing.some((e) => isSubset(tokens, e) || isSubset(e, tokens))) continue; // name variant of an existing target
    existing.push(tokens); // dedupe within this batch too
    // Whitelist sourced fields; ignore anything else the agent emitted.
    await upsertTarget({
      company: p.company.trim(),
      slug,
      ...(typeof p.sponsor === "string" ? { sponsor: p.sponsor } : {}),
      ...(typeof p.hq === "string" ? { hq: p.hq } : {}),
      ...(typeof p.vertical === "string" ? { vertical: p.vertical } : {}),
      fit: p.fit as Target["fit"],
      ...(typeof p.why_now === "string" ? { why_now: p.why_now } : {}),
      ...(typeof p.entry_persona === "string" ? { entry_persona: p.entry_persona } : {}),
      ...(Array.isArray(p.green_signals) ? { green_signals: p.green_signals.filter((s) => typeof s === "string") } : {}),
      ...(Array.isArray(p.sources) ? { sources: p.sources.filter((s) => typeof s === "string") } : {}),
    });
    budget--;
  }
}

// Attach any stuck research whose session has since finished. Called on CRM page load.
export async function reconcileRunning(targets: Target[]): Promise<void> {
  await Promise.all(
    targets
      .filter((t) => t.dossier_status === "running" && t.dossier_session)
      .map((t) => finalizeResearch(t).catch(() => null)),
  );
}

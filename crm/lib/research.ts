import Anthropic from "@anthropic-ai/sdk";
import { readOneBySlug, patchTarget, upsertTarget, listTargets, slugify, type Target } from "./store";
import { defineOutcome, DELIVERABLE_FILENAME } from "./rubrics";
import {
  isSessionTerminal, lastVerdict, trimToDeliverable, extractBlock, parsePeople,
  nameTokens, isNameVariant, portcoReceipt,
} from "./deliverable";
import { isDemo } from "./storage";
import {
  demoSessionId, demoSessionFinished, isDemoSession, demoDossier, demoSponsorProfile,
  demoPeople, demoPortcos,
} from "./demo";

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

  // Demo mode fakes the session rather than the result: the record goes to
  // "running" with a demo session id and the UI polls it exactly as it would a real
  // multi-minute run. See lib/demo.ts.
  if (isDemo()) {
    const session = demoSessionId();
    await patchTarget(slug, { dossier_status: "running", dossier_session: session });
    return { status: "running", session };
  }

  const isContact = t.kind === "contact";
  const agentId = isContact && SPONSOR_AGENT_ID ? SPONSOR_AGENT_ID : AGENT_ID;
  const prompt = isContact
    ? `Profile the PE sponsor "${t.company}" for the operating-partner outreach play. We want to reach ${t.contact_name}${t.contact_title ? `, ${t.contact_title}` : ""}. Map their full portfolio in our ICP's space (flag portcos worth adding as pipeline targets), recent deals, co-investors, and the key partners.`
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

  if (isDemoSession(target.dossier_session)) return finalizeDemoResearch(target);

  const client = new Anthropic();
  const session = await client.beta.sessions.retrieve(target.dossier_session);
  if (!isSessionTerminal(session)) return null;

  let brief = ((await fetchDeliverable(client, target.dossier_session)) ?? "").trim();
  if (!brief) {
    const events = await client.beta.sessions.events.list(target.dossier_session);
    brief = events.data
      .filter((e: any) => e.type === "agent.message")
      .flatMap((e: any) => (e.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text))
      .join("\n\n") // separate messages so the final H1 lands at a line start (not glued onto narration)
      .trim();
  }
  brief = trimToDeliverable(brief);

  const peopleBlock = extractBlock(brief, "people");
  const people = parsePeople(peopleBlock.items);
  brief = peopleBlock.rest;

  // Auto-add ADD-flagged portcos from sponsor profiles (the self-feeding loop: one
  // sponsor profile → new targets the nightly pipeline researches on its own). New
  // slugs only — a portco mention is weaker signal than an existing record, so it
  // never overwrites anything already in the CRM.
  const portcoBlock = extractBlock(brief, "portcos");
  brief = portcoBlock.rest;
  if (portcoBlock.items) {
    const { added, capped } = await addPortcos(portcoBlock.items);
    brief += portcoReceipt(added, capped, PORTCO_CAP);
  }

  const graded = lastVerdict(session);

  return patchTarget(target.slug, {
    dossier: brief,
    dossier_status: "done",
    ...(people ? { people } : {}),
    ...(graded ? { grade: graded.result, grade_notes: graded.explanation } : {}),
  });
}

// Demo counterpart to finalizeResearch: same shape, same downstream effects (people
// attached, portcos auto-added, a receipt appended) — just canned text instead of a
// graded agent run.
async function finalizeDemoResearch(target: Target): Promise<Target | null> {
  if (!demoSessionFinished(target.dossier_session!)) return null;

  const isContact = target.kind === "contact";
  let brief = isContact ? demoSponsorProfile(target) : demoDossier(target);

  if (isContact) {
    const { added, capped } = await addPortcos(demoPortcos(target.sponsor ?? target.company));
    brief += portcoReceipt(added, capped, PORTCO_CAP);
  }

  return patchTarget(target.slug, {
    dossier: brief,
    dossier_status: "done",
    people: demoPeople(),
    grade: "satisfied",
    grade_notes: "Demo mode — no grader ran. The real pipeline scores this against agents/rubrics/.",
  });
}

const PORTCO_CAP = 8; // per sponsor profile — quality over count
const PORTCO_FITS = new Set(["Strong", "Worth a look"]);

// Returns the add/drop tally so the caller can receipt it — qualified portcos past
// the cap are counted, never silently discarded.
async function addPortcos(arr: unknown[]): Promise<{ added: number; capped: number }> {
  const existing = (await listTargets()).map((t) => nameTokens(t.company));
  let budget = PORTCO_CAP;
  let added = 0;
  let capped = 0;
  for (const raw of arr) {
    const p = raw as Record<string, unknown>;
    if (!p || typeof p.company !== "string" || !p.company.trim()) continue;
    if (typeof p.fit !== "string" || !PORTCO_FITS.has(p.fit)) continue;
    const slug = slugify(p.company);
    if (await readOneBySlug(slug)) continue; // exact match → leave the curated record alone
    const tokens = nameTokens(p.company);
    if (existing.some((e) => isNameVariant(tokens, e))) continue; // name variant of an existing target
    if (budget <= 0) {
      capped++; // would have been added — count it so the receipt can say so
      continue;
    }
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
    added++;
  }
  return { added, capped };
}

// Attach any stuck research whose session has since finished. Called on CRM page load.
export async function reconcileRunning(targets: Target[]): Promise<void> {
  await Promise.all(
    targets
      .filter((t) => t.dossier_status === "running" && t.dossier_session)
      .map((t) => finalizeResearch(t).catch(() => null)),
  );
}

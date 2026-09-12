import { listTargets, AUTO_FITS as AUTO_FIT_VALUES } from "./store";
import { startResearch, finalizeResearch } from "./research";
import { draftOutreach } from "./outreach";

// The nightly pipeline — the "work the pipeline while you sleep" state machine.
// Runs the steps a human would otherwise click through, bounded and idempotent, in
// THIS order (DRAFT before FINALIZE is deliberate — see the ORDER MATTERS note below):
//   1. DRAFT     — write outreach for targets researched on a PREVIOUS run (cap: LLM calls).
//   2. FINALIZE  — attach any finished research sessions (free; no LLM calls).
//   3. RESEARCH  — start dossiers on promising un-researched targets (cap: real $ per session).
//   4. FOLLOW-UPS — surface what's due, so the dates in the CRM have teeth.
// It NEVER sends anything and NEVER touches human triage state (status). The human
// gate stays where it belongs: judging fit and hitting send.
//
// Called by both cron routes (/api/cron/pipeline overnight, /api/cron/brief in the
// morning). Idempotent: re-running skips everything already done.

const RESEARCH_CAP = 3; // sessions per run — each is a multi-minute cloud agent run
const DRAFT_CAP = 4; // targets per run — 1-2 LLM calls each

const AUTO_FITS = new Set<string>(AUTO_FIT_VALUES);
const SKIP_STATUSES = new Set(["dead", "won"]);

export interface PipelineReport {
  finalized: string[]; // slugs whose dossier just attached
  started: string[]; // slugs where research kicked off
  drafted: { slug: string; channels: string[] }[];
  followupsDue: { slug: string; company: string; follow_up: string; status: string }[];
  newTargets: { slug: string; company: string; fit?: string }[]; // discovered in last 24h
  running: string[]; // research still in flight after this run
  readyForReview: { slug: string; company: string; fit?: string }[]; // dossier + draft, still untriaged
  errors: { slug: string; step: string; message: string }[];
}

// `startNewResearch` gates step 3 (starting new cloud sessions). The overnight run
// (/api/cron/pipeline) starts research; the morning run (/api/cron/brief) leaves it
// off, so the two crons together honor RESEARCH_CAP once per day, not twice.
export async function runPipeline(opts?: { startNewResearch?: boolean }): Promise<PipelineReport> {
  const startNewResearch = opts?.startNewResearch ?? true;
  const report: PipelineReport = {
    finalized: [], started: [], drafted: [], followupsDue: [],
    newTargets: [], running: [], readyForReview: [], errors: [],
  };
  const targets = await listTargets();
  const now = new Date();

  // ORDER MATTERS: DRAFT runs before FINALIZE. Blob is eventually consistent, so a
  // draft's read-modify-write seconds after a finalize can read the pre-finalize blob
  // and clobber the just-attached dossier (observed in prod). Drafting first means it
  // only ever touches state settled since the PREVIOUS run (hours old, converged);
  // targets finalized this run get drafted next run instead.

  // 1. DRAFT outreach where research finished on a previous run but no draft exists.
  //    Email always; LinkedIn note additionally for contact-kind targets.
  let draftBudget = DRAFT_CAP;
  for (const t of targets) {
    if (draftBudget <= 0) break;
    if (t.dossier_status !== "done" || SKIP_STATUSES.has(t.status)) continue;
    // Only draft what the grader judged worth pursuing. Without this a "Skip" dossier
    // still gets a full cold-email draft written overnight and surfaced in the brief —
    // paid work on a company the system itself said not to chase.
    if (!t.fit || !AUTO_FITS.has(t.fit)) continue;
    const channels: string[] = [];
    if (!t.outreach) channels.push("email");
    if (!t.linkedin_note && t.kind === "contact") channels.push("linkedin");
    if (!channels.length) continue;
    const done: string[] = [];
    for (const channel of channels) {
      try {
        // Pass the already-loaded list so the drafter's cluster lookup doesn't re-read
        // every target blob per draft.
        const r = await draftOutreach(t.slug, channel as "email" | "linkedin", targets);
        // Reflect the new draft on the in-memory record, so step 4's review queue lists
        // targets drafted THIS run (not just those drafted on a previous run).
        if (r && channel === "email") t.outreach = r.text;
        if (r && channel === "linkedin") t.linkedin_note = r.text;
        done.push(channel);
      } catch (e) {
        report.errors.push({ slug: t.slug, step: `draft:${channel}`, message: (e as Error).message });
      }
    }
    if (done.length) {
      report.drafted.push({ slug: t.slug, channels: done });
      draftBudget--;
    }
  }

  // 2. FINALIZE any running research whose session has since finished.
  for (const t of targets) {
    if (t.dossier_status !== "running" || !t.dossier_session) continue;
    try {
      const updated = await finalizeResearch(t);
      if (updated) {
        report.finalized.push(t.slug);
        Object.assign(t, updated); // so the report's review-queue sees it
      } else {
        report.running.push(t.slug);
      }
    } catch (e) {
      report.errors.push({ slug: t.slug, step: "finalize", message: (e as Error).message });
    }
  }

  // 3. RESEARCH promising targets that have none (skip anything the human killed/won).
  //    Only the overnight run does this, so the daily research cap isn't spent twice.
  if (startNewResearch) {
    let startBudget = RESEARCH_CAP;
    for (const t of targets) {
      if (startBudget <= 0) break;
      if (t.dossier || t.dossier_status) continue;
      if (SKIP_STATUSES.has(t.status)) continue;
      if (!t.fit || !AUTO_FITS.has(t.fit)) continue;
      try {
        const started = await startResearch(t.slug);
        if (started) {
          report.started.push(t.slug);
          report.running.push(t.slug);
          startBudget--;
        }
      } catch (e) {
        report.errors.push({ slug: t.slug, step: "research", message: (e as Error).message });
      }
    }
  }

  // 4. FOLLOW-UPS due (today or overdue) + review queue + last-24h arrivals.
  const today = now.toISOString().slice(0, 10);
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  for (const t of targets) {
    if (t.follow_up && t.follow_up <= today && !SKIP_STATUSES.has(t.status)) {
      report.followupsDue.push({ slug: t.slug, company: t.company, follow_up: t.follow_up, status: t.status });
    }
    if ((t.discovered_at ?? "") >= dayAgo) {
      report.newTargets.push({ slug: t.slug, company: t.company, fit: t.fit });
    }
    if (t.dossier_status === "done" && (t.outreach || t.linkedin_note) && t.status === "new") {
      report.readyForReview.push({ slug: t.slug, company: t.company, fit: t.fit });
    }
  }

  return report;
}

// Render the morning-brief email (plain HTML, no LLM — the report IS the content).
export function renderBrief(r: PipelineReport, crmUrl: string): { subject: string; html: string } {
  const date = new Date().toISOString().slice(0, 10);
  const n = (xs: unknown[]) => xs.length;
  const subject = `Pipeline overnight — ${n(r.drafted)} drafted, ${n(r.finalized)} researched, ${n(r.followupsDue)} follow-ups due`;

  // Company names, slugs, and error text originate from agent web research and
  // upstream APIs — hostile input as far as this email is concerned. Escape
  // everything interpolated into markup so nothing can inject HTML into the inbox.
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  const href = /^https?:\/\//i.test(crmUrl) ? esc(crmUrl) : "#";
  const li = (s: string) => `<li>${s}</li>`;
  const section = (title: string, items: string[], empty: string) =>
    `<h3 style="margin:16px 0 4px">${title}</h3>` +
    (items.length ? `<ul style="margin:4px 0">${items.join("")}</ul>` : `<p style="color:#777;margin:4px 0">${empty}</p>`);

  const html = [
    `<div style="font-family:sans-serif;max-width:640px">`,
    `<h2 style="margin:0 0 8px">Overnight report — ${date}</h2>`,
    `<p style="margin:0 0 12px"><a href="${href}">Open the CRM</a></p>`,
    section("✍️ Drafts ready for your review", r.drafted.map((d) =>
      li(`<a href="${href}">${esc(d.slug)}</a> — ${esc(d.channels.join(" + "))}`)), "No new drafts."),
    section("📄 Research completed", r.finalized.map((s) => li(esc(s))), "None finished overnight."),
    section("🔬 Research started (attaches next run)", r.started.map((s) => li(esc(s))), "Nothing new to research."),
    section("⏰ Follow-ups due", r.followupsDue.map((f) =>
      li(`<b>${esc(f.company)}</b> — due ${esc(f.follow_up)} (${esc(f.status)})`)), "Nothing due. Clear runway."),
    section("🆕 New targets (last 24h)", r.newTargets.map((t) =>
      li(`<b>${esc(t.company)}</b>${t.fit ? ` — ${esc(t.fit)}` : ""}`)), "Radar added nothing new."),
    section("👀 Researched + drafted, awaiting your triage", r.readyForReview.map((t) =>
      li(`<b>${esc(t.company)}</b>${t.fit ? ` — ${esc(t.fit)}` : ""}`)), "Queue is clear."),
    r.errors.length
      ? section("⚠️ Errors", r.errors.map((e) => li(`${esc(e.slug)} [${esc(e.step)}]: ${esc(e.message)}`)), "")
      : "",
    `<p style="color:#999;font-size:12px;margin-top:20px">Nightly pipeline: research + drafts only — nothing is ever sent without you.</p>`,
    `</div>`,
  ].join("\n");

  return { subject, html };
}

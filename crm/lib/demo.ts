// Demo mode — the CRM with no cloud account and no API key.
//
// `npm run demo` seeds a fictional pipeline into .demo-data/ and boots the app, so
// anyone can click through the board, open a target, "research" it, and read a
// drafted email without an Anthropic key, a Vercel project, or a Blob store.
//
// Everything here is CANNED. No model is called and nothing is sent. The research
// and outreach text below is written by hand and labelled as such wherever it
// surfaces, so a demo run can never be mistaken for real agent output. The companies,
// people, and sponsors are invented; they match the fictional ICP in
// brand/brand-pack.example.yaml (Ridgeline Data Co. — regulated food & beverage).

import type { Target, Person } from "./store";
import type { BrandPack } from "./brand";

export const DEMO_NOTICE = "_Demo mode: canned output. The real pipeline calls a graded research agent._";

// A demo research run "takes" a few seconds so the poll loop in the UI is exercised
// the same way it is against a real multi-minute session.
const DEMO_RESEARCH_MS = 4000;

export const demoSessionId = (now = Date.now()) => `demo:${now + DEMO_RESEARCH_MS}`;

export function demoSessionFinished(session: string, now = Date.now()): boolean {
  const at = Number(session.slice("demo:".length));
  return Number.isFinite(at) && now >= at;
}

export const isDemoSession = (session?: string) => Boolean(session?.startsWith("demo:"));

const PEOPLE: Person[] = [
  { name: "Dana Whitfield", title: "VP Operations", persona: "Ops / Plant leader", source: "https://example.com/team" },
  { name: "Marcus Iyer", title: "Director of Quality & Food Safety", persona: "Quality / Food Safety leader", source: "https://example.com/team" },
  { name: "Priya Raghunathan", title: "CFO", persona: "PE-backed exec", source: "https://example.com/leadership" },
];

/** A canned seven-section dossier in the shape the real agent produces. */
export function demoDossier(t: Target): string {
  const company = t.company;
  const sponsor = t.sponsor ?? "its sponsor";
  return `# Pre-Engagement Dossier — ${company}

${DEMO_NOTICE}

## Fit score

**Strong.** ${company} hits three GREEN signals: PE ownership under ${sponsor} with a
stated margin-improvement mandate, an SQF-certified plant with a renewal audit this
year, and two open analyst reqs (yield, cost) against zero data-engineering reqs.
That last one is the tell — they are hiring people to work around the missing data
layer rather than building it.

## The angle

Their quality team is rebuilding the audit binder by hand every cycle while the ops
team reconciles yield in a spreadsheet only one analyst understands. Both grinds are
in scope for a single engagement, and the audit date is a real deadline to build
against.

## Snapshot

- Mid-market manufacturer, roughly 300 employees across two plants (unverified — no
  filing confirms headcount).
- ERP in place; the analytical layer above it is Excel plus a shared drive.
- Sponsor: ${sponsor}.

## Recent signals

- Announced a second production line, per their newsroom — https://example.com/news/line-two
- Two analyst roles open, no data-engineering or ML reqs — https://example.com/careers
- SQF certification listed as current; renewal window this year — https://example.com/quality

## Where we fit

The yield reconciliation is the wedge: lot-level data out of the ERP, cleaned, and
queryable in plain English by the ops team rather than by one analyst. The audit
document assistant follows it, built against the renewal date. Both run inside their
own cloud account, which is the objection that kills most tools here.

Honest caveat: if their ERP rollout is still in flight, the data layer is not stable
enough yet and this is a six-month conversation, not a now conversation.

## Likely buyer

VP Operations owns the yield number and can greenlight a pilot at this size. Quality
leadership can bless or kill it on traceability grounds, so bring them in early.

## Conversation hooks

- What happens to the yield report when the analyst who owns it takes PTO?
- How much of the audit binder gets rebuilt by hand each cycle?
- Where did the last "we tried ChatGPT" pilot stall — legal, or accuracy?
`;
}

/** A canned sponsor profile, including the portco block that feeds the pipeline. */
export function demoSponsorProfile(t: Target): string {
  return `# Sponsor Profile — ${t.company}

${DEMO_NOTICE}

## Snapshot

Lower-middle-market sponsor with a consumer-manufacturing thesis. Buys founder-owned
specialty manufacturers and holds through an operational improvement plan.

## Vertical thesis

Explicitly targets regulated food, beverage, and ingredient manufacturers — the exact
profile in the ICP. Their stated value-creation plan leads with margin and data-driven
operations, which is the mandate that funds this work.

## Portfolio

- **Cascade Provisions Co.** — specialty co-packer. SQF certified, two plants. → ADD
- **Marlow Beverage Works** — craft beverage production. Recent capacity expansion. → ADD
- **Harrow & Vance Ingredients** — flavor and ingredient blending. → ADD
- Two non-food holdings, out of scope.

## Recent activity

- Closed its most recent fund, per the fund's own announcement — https://example.com/fund
- Added an operating partner focused on manufacturing ops — https://example.com/team

## Co-investors / lenders

Typically co-invests with two regional funds; senior debt from a mid-market lender
(unverified — no filing confirms the current facility).

## The play

One engagement at a portco becomes the reference for the rest of the book: the same
yield-and-audit pattern applies across every food manufacturer they own. Lead with the
portco where the audit date is closest, and pitch ${t.contact_name ?? "the partner"} on
the repeatable pattern rather than a single-company build.
`;
}

export function demoPeople(): Person[] {
  return PEOPLE.map((p) => ({ ...p }));
}

/**
 * Portcos a demo sponsor profile "discovers" — this exercises the real auto-add loop
 * (research.ts → addPortcos), not a fake one. Two are new and land in the pipeline;
 * one duplicates a seeded target and gets skipped, so the demo shows the dedup doing
 * its job as well as the add. One is deliberately a Skip: below the fit bar, so it is
 * never added at all.
 */
export function demoPortcos(sponsor: string) {
  return [
    {
      company: "Fairhaven Foods Group",
      sponsor,
      hq: "Rochester, NY",
      vertical: "Frozen prepared foods",
      fit: "Strong",
      why_now: "BRCGS audit in the spring and a single analyst owning all yield reporting.",
      entry_persona: "Ops / Plant leader",
      green_signals: ["PE-owned", "BRCGS certified", "hiring analysts, no data engineers"],
      sources: ["https://example.com/news/fairhaven"],
    },
    {
      company: "Sterling Creek Beverage",
      sponsor,
      hq: "Asheville, NC",
      vertical: "Beverage co-packing",
      fit: "Worth a look",
      why_now: "Second co-packing line brought two incompatible quality systems together.",
      entry_persona: "Quality / Food Safety leader",
      green_signals: ["PE-owned", "merging quality systems"],
      sources: ["https://example.com/news/sterling-creek"],
    },
    {
      // Already on the board — the name-variant dedup should skip this one.
      company: "Cascade Provisions",
      sponsor,
      hq: "Portland, OR",
      vertical: "Specialty co-packing",
      fit: "Strong",
      why_now: "Duplicate of a target already in the pipeline.",
      sources: ["https://example.com/news/line-two"],
    },
    {
      // Under the fit bar — addPortcos only takes Strong / Worth a look.
      company: "Bellweather Snack Co.",
      sponsor,
      hq: "Wichita, KS",
      vertical: "Snack manufacturing",
      fit: "Skip",
      why_now: "No regulatory exposure and no sponsor mandate.",
      sources: ["https://example.com/news/bellweather"],
    },
  ];
}

/** A canned first-touch draft. Deterministic, in the example brand pack's voice. */
export function demoOutreach(t: Target, channel: "email" | "linkedin"): string {
  // Prefer the named contact, then whoever research surfaced — the same precedence the
  // real drafter uses, so drafting after researching visibly improves the draft.
  const who = t.contact_name ?? t.people?.[0]?.name ?? "there";
  const first = who.split(" ")[0];
  const company = t.company;

  if (channel === "linkedin") {
    return `${first} — saw ${company} is running an SQF renewal this year while the yield reporting still lives in one analyst's spreadsheet. I build that data layer inside the client's own cloud for food & bev manufacturers. Worth comparing notes?`;
  }

  return `Subject: ${company}'s yield reporting before the audit

Hi ${first},

Two open analyst reqs and no data-engineering req usually means the same thing: the
numbers are being produced by hand, and one person owns the spreadsheet everyone
depends on. With an SQF renewal in the same year, that gets expensive twice.

I build the data layer that makes lot-level yield trustworthy, plus a document
assistant for the audit binder — inside your own cloud account, so recipes and costs
never leave. Human reviews every output. Last one shipped for a PE-owned co-packer
and survived an SQF cycle on a hard deadline.

Worth twenty minutes to see whether the timing lines up with your audit date?

Alex Rivera
Founder, Ridgeline Data Co.`;
}

// The canon the demo CRM drafts against — the compiled shape `npm run brand-pack`
// pushes, so the outreach path behaves the same as in production.
export const DEMO_BRAND_PACK: BrandPack = {
  version: 1,
  source: "brand/brand-pack.example.yaml (demo)",
  identity: { name: "Ridgeline Data Co.", abbr: "RDC", founder: "Alex Rivera" },
  blocks: {
    outreach:
      "**Ridgeline Data Co. (RDC)** — a solo AI + operational-data consultancy for " +
      "regulated food & beverage manufacturing.\n\nVoice: practitioner-first, direct, " +
      "anti-hype. NEVER use: leverage, transform, synergy, seamless, cutting-edge, " +
      "revolutionize, game-changing, end-to-end automation, unlock, empower.",
  },
};

// The seeded board. Varied fit, status, and research state so the UI has something
// to show in every column — including a Skip and a dead deal, because a demo where
// everything is Strong teaches the wrong thing about the fit scoring.
type Seed = Partial<Target> & { company: string };

export const DEMO_TARGETS: Seed[] = [
  {
    company: "Cascade Provisions Co.",
    sponsor: "Thornbury Capital",
    hq: "Portland, OR",
    vertical: "Specialty co-packing",
    fit: "Strong",
    status: "contacted",
    why_now: "SQF renewal audit this year and a second production line coming online.",
    entry_persona: "Ops / Plant leader",
    green_signals: ["PE-owned (Thornbury Capital)", "SQF certified, renewal this year", "Hiring analysts, no data engineers"],
    sources: ["https://example.com/news/line-two", "https://example.com/careers"],
    next_step: "Follow up on the audit timeline",
    follow_up: "2026-09-02",
    notes: "Dana replied — wants to loop in Quality before scoping.",
  },
  {
    company: "Marlow Beverage Works",
    sponsor: "Thornbury Capital",
    hq: "Nashville, TN",
    vertical: "Beverage production",
    fit: "Strong",
    status: "new",
    why_now: "Capacity expansion with no analytics bench to match it.",
    entry_persona: "Ops / Plant leader",
    green_signals: ["PE-owned (Thornbury Capital)", "Recent capacity expansion"],
    sources: ["https://example.com/news/expansion"],
  },
  {
    company: "Harrow & Vance Ingredients",
    sponsor: "Thornbury Capital",
    hq: "Cincinnati, OH",
    vertical: "Flavors & ingredients",
    fit: "Worth a look",
    status: "new",
    why_now: "Merging two quality systems after a bolt-on acquisition.",
    entry_persona: "Quality / Food Safety leader",
    green_signals: ["PE-owned (Thornbury Capital)", "Roll-up merging quality systems"],
    sources: ["https://example.com/news/bolt-on"],
  },
  {
    company: "Thornbury Capital",
    kind: "contact",
    contact_name: "Dana Whitfield",
    contact_title: "Operating Partner",
    sponsor: "Thornbury Capital",
    hq: "Chicago, IL",
    fit: "Strong",
    status: "new",
    why_now: "Owns the value-creation plan across three food & bev portcos.",
    entry_persona: "PE-backed exec / operating partner",
    green_signals: ["Food & beverage thesis", "Three portcos already in the pipeline"],
    sources: ["https://example.com/fund"],
  },
  {
    company: "Pinebrook Pet Nutrition",
    sponsor: "Keystone Ridge Partners",
    hq: "Boise, ID",
    vertical: "Pet food",
    fit: "Strong",
    status: "researching",
    why_now: "ERP migration underway; the reporting layer has not followed.",
    entry_persona: "Ops / Plant leader",
    green_signals: ["PE-owned (Keystone Ridge Partners)", "ERP/MES migration in flight"],
    sources: ["https://example.com/news/erp"],
  },
  {
    company: "Ledgerwood Organics",
    sponsor: "Keystone Ridge Partners",
    hq: "Burlington, VT",
    vertical: "Organic packaged foods",
    fit: "Worth a look",
    status: "new",
    why_now: "Organic + kosher certifications renewing on the same cycle.",
    entry_persona: "Quality / Food Safety leader",
    green_signals: ["PE-owned (Keystone Ridge Partners)", "Multiple certifications"],
    sources: ["https://example.com/quality"],
  },
  {
    company: "Sablefish Foods",
    hq: "Astoria, OR",
    vertical: "Seafood processing",
    fit: "Skip",
    status: "dead",
    why_now: "No PE sponsor and a nine-person team — under the size floor.",
    green_signals: [],
    notes: "Too small. Revisit if they take on a sponsor.",
    sources: ["https://example.com/about"],
  },
  {
    company: "Northgate Nutraceuticals",
    sponsor: "Alder & Finch",
    hq: "Salt Lake City, UT",
    vertical: "Nutraceutical manufacturing",
    fit: "Worth a look",
    status: "won",
    why_now: "Stalled internal AI pilot after a legal review.",
    entry_persona: "PE-backed exec / operating partner",
    green_signals: ["PE-owned (Alder & Finch)", "Stalled we-tried-ChatGPT pilot"],
    sources: ["https://example.com/news/pilot"],
    notes: "Signed a scoped pilot. Kickoff next month.",
  },
];

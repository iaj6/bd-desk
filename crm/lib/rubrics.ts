// Rubrics for platform-graded research sessions (user.define_outcome). The grader
// scores the deliverable when the agent finishes and sends it back to revise (up
// to MAX_ITERATIONS) if criteria aren't met; the verdict lands on
// session.outcome_evaluations, which finalizeResearch copies onto the target.
//
// KEEP IN SYNC with agents/rubrics/*.md at the repo root (source of truth). The CRM
// deploys from crm/ alone, so it can't read those files at runtime — this is the
// one deliberate duplication.

export const MAX_ITERATIONS = 2;

const DOSSIER_RUBRIC = `# Rubric — BD dossier

Grade the FINAL dossier the agent delivered (the deliverable, not the research
narration). The reader is a skeptical founder with five minutes before a sales call.

The dossier passes when ALL of the following hold:

1. **Complete** — the seven sections are present (Fit score, The angle, Snapshot,
   Recent signals, Where we fit, Likely buyer, Conversation hooks), or a missing
   section is explicitly justified as having nothing real to report. No padded or
   filler sections.
2. **Fit score leads and is argued** — the dossier opens with Strong / Worth a look /
   Skip plus reasoning tied to the ICP in the system prompt (its GREEN signals and
   RED flags, not generic attractiveness). A "Strong" with no concrete GREEN
   signals cited fails this.
3. **Grounded** — recent signals carry source URLs; claims about the company trace
   to something the agent actually found this session, not general knowledge;
   anything not verified is marked "unverified". Invented facts, invented people,
   or constructed/guessed LinkedIn URLs fail this outright.
4. **Skeptical, not salesy** — "Where we fit" names a specific, plausible grind the
   ICP actually has (drawn from the offer and pains in the system prompt). If the
   fit is weak, the dossier says so plainly instead of stretching.
5. **Machine block valid** — the output ends with a \`<people>[…]</people>\` JSON
   array (possibly empty), valid JSON, nothing after the closing tag; each person
   has a name and a source; \`linkedin\` appears only where a real profile URL was
   surfaced by search.
6. **Voice** — direct, practitioner-first, and free of the NEVER-use words listed
   in the system prompt.

Judge honestly against the full scale — an incomplete, padded, or ungrounded
dossier needs revision even if it reads well. Do NOT penalize gaps where public
information genuinely does not exist, as long as the dossier acknowledges them.
`;

const SPONSOR_RUBRIC = `# Rubric — PE sponsor profile

Grade the FINAL sponsor profile the agent delivered (the deliverable, not the
research narration). This is prep + lead-gen: the portfolio enumeration is the
payload.

The profile passes when ALL of the following hold:

1. **Complete** — the six sections are present (Snapshot, Vertical thesis,
   Portfolio, Recent activity, Co-investors / lenders, The play), or a missing
   section is explicitly justified. No filler.
2. **Portfolio is thorough and scored** — the portcos found in the ICP's space are
   enumerated (platforms AND add-ons), each with a one-liner and
   a fit note against the ICP in the system prompt, and the ones worth pursuing are
   flagged \`→ ADD\`. An obviously thin portfolio section (one or two well-known
   names for a fund with a stated thesis in the space) needs revision.
3. **Grounded** — recent activity carries source URLs and dates; portcos and deals
   trace to something the agent actually found this session; anything unverified is
   marked "unverified". Invented portcos, invented partners, or constructed
   LinkedIn URLs fail outright.
4. **The play is specific** — one line on how the offer templates across THIS
   fund's book in the ICP's space and the sharpest angle for the named partner.
   Generic filler fails.
5. **Machine blocks valid** — the output ends with a \`<people>[…]</people>\` JSON
   array followed by a \`<portcos>[…]</portcos>\` JSON array, both valid JSON with
   nothing after the closing tags. Every \`→ ADD\` portco from the Portfolio section
   appears in \`<portcos>\` with at least company, sponsor, and fit ("Strong" or
   "Worth a look"); fields the agent could not verify are omitted, not guessed.
   Portcos that do not genuinely clear the ICP bar do NOT appear.
6. **Voice** — direct, practitioner-first, free of the NEVER-use words in the
   system prompt.

Judge honestly against the full scale. Do NOT penalize gaps where public
information genuinely does not exist, as long as they are acknowledged.
`;

// Delivery contract: the deliverable goes to a deterministic output file that
// finalizeResearch fetches via the Files API (files.list scoped to the session),
// with message-parsing as fallback — no need to restream the whole document
// through the message channel.
export const DELIVERABLE_FILENAME = "deliverable.md";
const DELIVER_TO_FILE =
  `\n\nDelivery: write the COMPLETE deliverable (machine-readable blocks included) to ` +
  `/mnt/session/outputs/${DELIVERABLE_FILENAME} — exactly that path, one file. Your final ` +
  `message should be a short summary; the file is what gets ingested.`;

// The graded kickoff event. `description` IS the task — the agent begins work on
// receipt — so this replaces the plain user.message we used to send.
export function defineOutcome(agent: "dossier" | "sponsor", description: string) {
  return {
    type: "user.define_outcome" as const,
    description: description + DELIVER_TO_FILE,
    rubric: { type: "text" as const, content: agent === "sponsor" ? SPONSOR_RUBRIC : DOSSIER_RUBRIC },
    max_iterations: MAX_ITERATIONS,
  };
}

// Platform-graded outcomes (user.define_outcome). Each graded kickoff sends the
// task WITH its rubric; the Managed Agents grader scores the deliverable when the
// agent finishes and sends it back to revise (up to MAX_ITERATIONS) if criteria
// aren't met. Verdicts stream as span.outcome_evaluation_end events and persist on
// session.outcome_evaluations.
//
// The weekly digest is deliberately NOT graded: its deliverable is a sent email,
// and a needs_revision cycle could send it twice.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type GradedAgent = "dossier" | "sponsor" | "radar";

const FILES: Record<GradedAgent, string> = {
  dossier: "bd-dossier.rubric.md",
  sponsor: "sponsor-profile.rubric.md",
  radar: "opportunity-radar.rubric.md",
};

// Evaluate→revise cycles before the grader gives up (default 3, max 20).
// Kept low — every revision is another opus turn.
export const MAX_ITERATIONS = 2;

export function rubric(agent: GradedAgent): string {
  return readFileSync(resolve(__dirname, "../agents/rubrics", FILES[agent]), "utf8");
}

// Delivery contracts. Dossier/sponsor deliverables are INGESTED (CRM, eval
// checks), so they go to a deterministic output file consumers fetch via the
// Files API (files.list scoped to the session) — no need to restream the whole
// document through the message channel. The radar's deliverable is its sweep
// REPORT, which humans read from the transcript — that stays in-message.
export const DELIVERABLE_FILENAME = "deliverable.md";
const DELIVER_TO_FILE =
  `\n\nDelivery: write the COMPLETE deliverable (machine-readable blocks included) to ` +
  `/mnt/session/outputs/${DELIVERABLE_FILENAME} — exactly that path, one file. Your final ` +
  `message should be a short summary; the file is what gets ingested.`;
const DELIVER_IN_MESSAGE =
  "\n\nDelivery: output the COMPLETE report as your final message in the conversation — " +
  "not only as a file.";

// The graded kickoff event. `description` IS the task — the agent begins work on
// receipt — so this replaces the plain user.message we used to send.
export function defineOutcome(agent: GradedAgent, description: string) {
  return {
    type: "user.define_outcome" as const,
    description: description + (agent === "radar" ? DELIVER_IN_MESSAGE : DELIVER_TO_FILE),
    rubric: { type: "text" as const, content: rubric(agent) },
    max_iterations: MAX_ITERATIONS,
  };
}

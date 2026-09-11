// The graded-session lifecycle rules, in one place. A graded session idles
// TRANSIENTLY around evaluation cycles, so "idle" alone is never "done" — and it is
// also not done while it is waiting on the caller (requires_action). The runners used
// to hand-roll this four times, and the polling copies dropped the requires_action
// guard; this is the single source of truth for all of them.

import type Anthropic from "@anthropic-ai/sdk";
import { POLL_INTERVAL_MS, SESSION_DEADLINE_MS, sleep, sessionUrl } from "./constants.ts";

export const TERMINAL_VERDICTS = new Set([
  "satisfied",
  "max_iterations_reached",
  "failed",
  "interrupted",
]);

export interface SessionLike {
  status?: string;
  stop_reason?: { type?: string } | null;
  outcome_evaluations?: { result: string; completed_at?: string | null; explanation?: string | null }[] | null;
}

export function isSessionDone(s: SessionLike): boolean {
  if (s.status === "terminated") return true;
  if (s.status !== "idle") return false;
  if (s.stop_reason?.type === "requires_action") return false;
  return (s.outcome_evaluations ?? []).every((o) => TERMINAL_VERDICTS.has(o.result));
}

/** The grader's last completed verdict, or null if it never finished one. */
export function lastVerdict(s: SessionLike): { result: string; explanation: string } | null {
  const graded = (s.outcome_evaluations ?? []).filter((o) => o.completed_at).pop();
  return graded ? { result: graded.result, explanation: graded.explanation ?? "" } : null;
}

/** Poll a session to a terminal state, or throw once the wall-clock deadline passes. */
export async function pollToTerminal(
  client: Anthropic,
  sessionId: string,
  deadlineMs: number = SESSION_DEADLINE_MS,
): Promise<SessionLike> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const s = await client.beta.sessions.retrieve(sessionId);
    if (isSessionDone(s)) return s;
    if (Date.now() > deadline) {
      throw new Error(
        `session did not finish within ${Math.round(deadlineMs / 60_000)} min — still running at ${sessionUrl(sessionId)}`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// Exit code for a run: 0 only for a satisfied grader verdict with a non-empty body.
// A `failed`/`max_iterations_reached` verdict, or an empty deliverable, is a failure a
// script or CI must be able to see — the runners used to exit 0 and print "saved" for
// both.
export function exitForRun(verdict: string | undefined, body: string): 0 | 1 {
  if (!body.trim()) return 1;
  return verdict === "satisfied" ? 0 : 1;
}

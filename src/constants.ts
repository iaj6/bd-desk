// The one place the shared platform constants live, so changing the model (or the
// beta header, or the toolset) is a single edit rather than a hunt across a dozen
// scripts. The CRM keeps its own copy of the model id (it deploys from crm/ alone),
// the way it keeps its own rubrics — pinned together by a test.

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5";
export const AGENT_TOOLSET = { type: "agent_toolset_20260401" as const };
export const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01" as const;

// Poll interval while waiting on a session, and the default wall-clock deadline. A
// graded dossier runs 27–34 min end to end (README note 9), so the deadline sits well
// past that — a runner that hangs longer has genuinely stalled and should exit, not spin.
export const POLL_INTERVAL_MS = 15_000;
export const SESSION_DEADLINE_MS = 45 * 60_000;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const sessionUrl = (id: string) =>
  `https://platform.claude.com/workspaces/default/sessions/${id}`;

// Construct the SDK client, failing early with a clear message when no credential is
// set. The SDK reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN only — not an
// `ant auth login` profile — so a missing key otherwise surfaces as an opaque auth
// error on the first API call, long after the script started.
export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error(
      "No ANTHROPIC_API_KEY — put it in .env (see .env.example) or export it, then re-run.",
    );
    process.exit(1);
  }
  return new Anthropic();
}

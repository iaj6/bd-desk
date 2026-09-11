// Manually fires the weekly deployment NOW (works even between scheduled runs) and
// streams the resulting sweep. This is the deployment smoke test — and how you'd
// trigger an ad-hoc sweep.
//
//   npm run radar-fire

import "./env.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { anthropic, sessionUrl } from "./constants.ts";
import { requireIds } from "./ids.ts";
import { TERMINAL_VERDICTS, isSessionDone, lastVerdict, pollToTerminal } from "./session.ts";

const ids = requireIds(["deploymentId"], "run `npm run deploy-radar` first.");

const client = anthropic();

const run = await client.beta.deployments.run(ids.deploymentId);
const sessionId: string | undefined = (run as any).session_id;
if (!sessionId) {
  console.error("Run created but no session_id returned:", run);
  process.exit(1);
}
console.log(`run     → ${(run as any).id}`);
console.log(`session → ${sessionId}`);
console.log(`watch   → ${sessionUrl(sessionId)}\n`);

// The deployment already sent the kickoff, so we can't stream-first. Consolidate:
// list past events, then tail live, deduping by id.
const seen = new Set<string>();
let out = "";
let verdict = "";
let verdictResult = "";
const history = await client.beta.sessions.events.list(sessionId);
for (const ev of history.data) {
  seen.add(ev.id);
  render(ev);
}

// The deployment kickoff is a graded outcome, so idle can be transient (mid-grading) —
// only finish once a terminal verdict has landed.
let verdictTerminal = history.data.some(
  (ev: any) => ev.type === "span.outcome_evaluation_end" && TERMINAL_VERDICTS.has(ev.result),
);

// If the session already reached a terminal state while we were listing history, the
// live stream will never emit another status event — check before tailing. Only once
// at least one event has landed, though: a just-fired deployment can be momentarily
// idle with no events, which the done predicate would read as finished and write an
// empty shortlist.
if (history.data.length > 0) {
  const current = await client.beta.sessions.retrieve(sessionId);
  if (isSessionDone(current)) finish();
}

// The live stream can drop mid-run (HTTP/2 resets, session reschedules) while the
// session keeps going server-side — so treat it as progress-only. If it ends or
// errors before a terminal state, fall through to polling + replay.
try {
  const stream = await client.beta.sessions.events.stream(sessionId);
  for await (const event of stream) {
    const eid = "id" in event ? event.id : undefined; // some stream events (e.g. start) carry no id
    if (eid && !seen.has(eid)) {
      seen.add(eid);
      render(event);
    }
    if (event.type === "span.outcome_evaluation_end" && TERMINAL_VERDICTS.has(event.result)) verdictTerminal = true;
    if (event.type === "session.status_terminated") finish();
    if (
      event.type === "session.status_idle" &&
      (event as any).stop_reason?.type !== "requires_action" &&
      verdictTerminal
    )
      finish();
  }
} catch (e) {
  process.stderr.write(`\n(stream dropped: ${e instanceof Error ? e.message : e} — polling to completion)\n`);
}

// Poll the session to a terminal state (bounded by a deadline), then replay whatever
// the stream missed.
const s = await pollToTerminal(client, sessionId);
const v = lastVerdict(s);
if (v) {
  verdict = `${v.result} — ${v.explanation}`;
  verdictResult = v.result;
}
for await (const ev of client.beta.sessions.events.list(sessionId, { limit: 100 })) {
  if (!seen.has(ev.id)) {
    seen.add(ev.id);
    render(ev);
  }
}
finish();

function render(event: any) {
  if (event.type === "agent.message") {
    for (const block of event.content) {
      if (block.type === "text") {
        process.stdout.write(block.text);
        out += block.text;
      }
    }
  } else if (event.type === "agent.tool_use") {
    process.stdout.write(`\n  · ${event.name}…\n`);
  } else if (event.type === "agent.mcp_tool_use") {
    process.stdout.write(`\n  · mcp:${event.name}…\n`);
  } else if (event.type === "session.thread_created") {
    process.stdout.write(`\n  ⇢ thread ${event.session_thread_id.slice(-6)} (${event.agent_name})\n`);
  } else if (event.type === "agent.thread_message_sent") {
    process.stdout.write(`\n  ⇢ delegate → ${event.to_agent_name ?? event.to_session_thread_id.slice(-6)}\n`);
  } else if (event.type === "agent.thread_message_received") {
    process.stdout.write(`\n  ⇠ report ← ${event.from_agent_name ?? event.from_session_thread_id.slice(-6)}\n`);
  } else if (event.type === "span.outcome_evaluation_start") {
    process.stdout.write(`\n  ⚖ grading (cycle ${event.iteration + 1})…\n`);
  } else if (event.type === "span.outcome_evaluation_end") {
    verdict = `${event.result} — ${event.explanation}`;
    verdictResult = event.result;
    process.stdout.write(`\n  ⚖ ${event.result}: ${event.explanation}\n`);
  }
}

function finish(): never {
  if (!out.trim()) {
    console.error(`\n\nno report produced — session finished ${verdict ? `(${verdict})` : "without output"}.`);
    process.exit(1);
  }
  mkdirSync("radar-runs", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `radar-runs/${stamp}-deployment.md`;
  // Save the grader verdict the way `npm run radar` does, so the two runners' outputs match.
  writeFileSync(path, `${out}${verdict ? `\n\n---\n_grader: ${verdict}_\n` : ""}`);
  console.log(`\n\nshortlist → ${path}`);
  process.exit(verdictResult === "satisfied" ? 0 : 1);
}

// Manually fires the weekly deployment NOW (works even between scheduled runs) and
// streams the resulting sweep. This is the deployment smoke test — and how you'd
// trigger an ad-hoc sweep.
//
//   npm run radar-fire

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const IDS = ".managed-agents.json";
const ids = JSON.parse(readFileSync(IDS, "utf8"));
if (!ids.deploymentId) {
  console.error("No deployment — run `npm run deploy-radar` first.");
  process.exit(1);
}

const client = new Anthropic();

const run = await client.beta.deployments.run(ids.deploymentId);
const sessionId: string | undefined = (run as any).session_id;
if (!sessionId) {
  console.error("Run created but no session_id returned:", run);
  process.exit(1);
}
console.log(`run     → ${(run as any).id}`);
console.log(`session → ${sessionId}`);
console.log(`watch   → https://platform.claude.com/workspaces/default/sessions/${sessionId}\n`);

// The deployment already sent the kickoff, so we can't stream-first. Consolidate:
// list past events, then tail live, deduping by id.
const seen = new Set<string>();
let out = "";
const history = await client.beta.sessions.events.list(sessionId);
for (const ev of history.data) {
  seen.add(ev.id);
  render(ev);
}

// The deployment kickoff is a graded outcome, so idle can be transient
// (mid-grading) — only finish once a terminal verdict has landed.
const TERMINAL_VERDICTS = new Set(["satisfied", "max_iterations_reached", "failed", "interrupted"]);
let verdictTerminal = history.data.some(
  (ev: any) => ev.type === "span.outcome_evaluation_end" && TERMINAL_VERDICTS.has(ev.result),
);

// If the session already reached a terminal state while we were listing history,
// the live stream will never emit another status event — check before tailing.
const current = await client.beta.sessions.retrieve(sessionId);
if (
  current.status === "terminated" ||
  (current.status === "idle" &&
    (current.outcome_evaluations ?? []).every((o) => TERMINAL_VERDICTS.has(o.result)))
) {
  finish();
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

// Poll the session to a terminal state, then replay whatever the stream missed.
while (true) {
  const s = await client.beta.sessions.retrieve(sessionId);
  const done =
    s.status === "terminated" ||
    (s.status === "idle" && (s.outcome_evaluations ?? []).every((o) => TERMINAL_VERDICTS.has(o.result)));
  if (done) break;
  await new Promise((r) => setTimeout(r, 15_000));
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
    process.stdout.write(`\n  ⚖ ${event.result}: ${event.explanation}\n`);
  }
}

function finish(): never {
  mkdirSync("radar-runs", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `radar-runs/${stamp}-deployment.md`;
  writeFileSync(path, out);
  console.log(`\n\nshortlist → ${path}`);
  process.exit(0);
}

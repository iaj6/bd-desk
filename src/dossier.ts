// SESSION-EVERY-RUN — creates one session against the existing agent and streams
// a BD dossier on the target you pass.
//
//   npm run dossier -- "Acme Corp"
//   npm run dossier -- "Jane Smith, CTO at Acme"
//
// Note: it does NOT create an agent — it references the one setup.ts made.

import "./env.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { defineOutcome } from "./rubrics.ts";
import { fetchDeliverable } from "./outputs.ts";
import { anthropic, sessionUrl } from "./constants.ts";
import { requireIds } from "./ids.ts";
import { TERMINAL_VERDICTS, lastVerdict, pollToTerminal } from "./session.ts";

const { agentId, agentVersion, environmentId } = requireIds(
  ["agentId", "agentVersion", "environmentId"],
  "run `npm run setup` first.",
);

const target = process.argv.slice(2).join(" ").trim();
if (!target) {
  console.error('Usage: npm run dossier -- "Company or person"');
  process.exit(1);
}

const client = anthropic();

const session = await client.beta.sessions.create({
  agent: { type: "agent", id: agentId, version: agentVersion },
  environment_id: environmentId,
  title: `Dossier: ${target}`,
});
console.log(`session  → ${session.id}`);
// Watch it live in the Console instead of parsing the stream:
console.log(`watch    → ${sessionUrl(session.id)}\n`);

// Stream-first: open the stream BEFORE sending, or you miss early events.
// The kickoff is a GRADED outcome, not a plain message: the platform grader scores
// the dossier against agents/rubrics/bd-dossier.rubric.md and sends the agent back
// to revise if it falls short.
const stream = await client.beta.sessions.events.stream(session.id);

// Sending the kickoff BLOCKS while the session provisions its sandbox — about
// 100s on a cold environment, measured. Announce the wait: without a line here the
// runner prints a session URL and then goes silent long enough to look hung, and
// the reflex is to kill it (which orphans an empty session, since the task never
// registered).
process.stdout.write("starting → provisioning the session sandbox (~1-2 min)…");
const kickoffAt = Date.now();
await client.beta.sessions.events.send(session.id, {
  events: [defineOutcome("dossier", `Build a BD dossier on: ${target}`)],
});
process.stdout.write(` running after ${Math.round((Date.now() - kickoffAt) / 1000)}s\n\n`);

let dossier = "";
let verdict = "";
let verdictResult = "";
let verdictTerminal = false;

// The live stream can drop mid-run (HTTP/2 resets, session reschedules) while the
// session keeps going server-side — treat it as progress-only and fall back to
// polling + a full rebuild if it ends before a terminal state.
try {
  for await (const event of stream) {
    switch (event.type) {
      case "agent.message":
        for (const block of event.content) {
          if (block.type === "text") {
            process.stdout.write(block.text);
            dossier += block.text;
          }
        }
        break;
      case "agent.tool_use":
        process.stdout.write(`\n  · ${event.name}…\n`);
        break;
      case "span.outcome_evaluation_start":
        process.stdout.write(`\n  ⚖ grading (cycle ${event.iteration + 1})…\n`);
        break;
      case "span.outcome_evaluation_end":
        verdict = `${event.result} — ${event.explanation}`;
        verdictResult = event.result;
        verdictTerminal = TERMINAL_VERDICTS.has(event.result);
        process.stdout.write(`\n  ⚖ ${event.result}: ${event.explanation}\n`);
        break;
      case "session.status_idle":
        // Idle can be transient (waiting on us, or mid-grading). Only finish once
        // the grader has delivered a terminal verdict.
        if ((event as any).stop_reason?.type === "requires_action") break;
        if (!verdictTerminal) break;
        await finish();
        break;
      case "session.status_terminated":
        await finish();
        break;
    }
  }
} catch (e) {
  process.stderr.write(`\n(stream dropped: ${e instanceof Error ? e.message : e} — polling to completion)\n`);
}

// Poll the session to a terminal state (bounded by a deadline), then rebuild the
// dossier from the server-side event log (authoritative, replaces the partial stream).
const s = await pollToTerminal(client, session.id);
const v = lastVerdict(s);
if (v) {
  verdict = `${v.result} — ${v.explanation}`;
  verdictResult = v.result;
}
dossier = "";
for await (const ev of client.beta.sessions.events.list(session.id, { limit: 100 })) {
  if (ev.type === "agent.message")
    for (const block of ev.content) if (block.type === "text") dossier += block.text;
}
await finish();

// The real deliverable is the session's output file (Files API); the streamed
// message text is the fallback for anything that predates the file contract.
async function finish(): Promise<never> {
  const body = ((await fetchDeliverable(client, session.id)) ?? dossier).trim();
  if (!body) {
    console.error(`\n\nno deliverable produced — session finished ${verdict ? `(${verdict})` : "without output"}.`);
    process.exit(1);
  }
  mkdirSync("dossiers", { recursive: true });
  const slug = target.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const path = `dossiers/${slug || "target"}.md`;
  writeFileSync(path, verdict ? `${body}\n\n---\n_grader: ${verdict}_\n` : body);
  console.log(`\n\nsaved    → ${path}`);
  // Exit non-zero on a non-satisfied verdict so a `failed`/`max_iterations` run isn't
  // read as success by a script or a skimming reader.
  process.exit(verdictResult === "satisfied" ? 0 : 1);
}

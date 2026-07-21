// Runs the Opportunity Radar once, on-demand. Attaches the memory store so the
// radar reads what it already found and writes new finds back.
//
//   npm run radar                       # uses the default mission
//   npm run radar -- "your mission"     # custom mission for this run

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { defineOutcome } from "./rubrics.ts";

const IDS = ".managed-agents.json";
if (!existsSync(IDS)) {
  console.error("Run `npm run setup` then `npm run setup-radar` first.");
  process.exit(1);
}
const ids = JSON.parse(readFileSync(IDS, "utf8"));
if (!ids.radarAgentId || !ids.memoryStoreId) {
  console.error("Radar not provisioned — run `npm run setup-radar`.");
  process.exit(1);
}

const DEFAULT_MISSION =
  "Find 5 net-new qualified targets not already in your memory. Use several sourcing angles.";
const mission = process.argv.slice(2).join(" ").trim() || DEFAULT_MISSION;

const client = new Anthropic();

const session = await client.beta.sessions.create({
  agent: { type: "agent", id: ids.radarAgentId, version: ids.radarAgentVersion },
  environment_id: ids.environmentId,
  title: `Radar: ${mission.slice(0, 60)}`,
  vault_ids: ids.vaultId ? [ids.vaultId] : undefined, // CRM ingest token (egress injection)
  resources: [
    {
      type: "memory_store",
      memory_store_id: ids.memoryStoreId,
      access: "read_write",
      instructions:
        "Your running target list + BFS worklist (_frontier.md / _done.md) + distilled sourcing lessons (_learnings.md). Read before sourcing to avoid duplicates; write one file per new qualified target.",
    },
  ],
});
console.log(`session → ${session.id}`);
console.log(`watch   → https://platform.claude.com/workspaces/default/sessions/${session.id}\n`);
console.log(`mission → ${mission}\n`);

// Graded kickoff: the platform grader scores the sweep against
// agents/rubrics/opportunity-radar.rubric.md (protocol, cards, report, CRM pushes)
// and sends the agent back to revise if it falls short. Revision re-POSTs to the
// CRM are safe — it upserts by company.
const stream = await client.beta.sessions.events.stream(session.id);
await client.beta.sessions.events.send(session.id, {
  events: [defineOutcome("radar", mission)],
});

// Terminal grader verdicts — a graded session idles TRANSIENTLY around
// evaluation cycles, so idle only means "done" once one of these has landed.
const TERMINAL_VERDICTS = new Set(["satisfied", "max_iterations_reached", "failed", "interrupted"]);

let out = "";
let verdict = "";
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
            out += block.text;
          }
        }
        break;
      case "agent.tool_use":
        process.stdout.write(`\n  · ${event.name}…\n`);
        break;
      case "agent.mcp_tool_use":
        process.stdout.write(`\n  · mcp:${event.name}…\n`);
        break;
      case "span.outcome_evaluation_start":
        process.stdout.write(`\n  ⚖ grading (cycle ${event.iteration + 1})…\n`);
        break;
      case "span.outcome_evaluation_end":
        verdict = `${event.result} — ${event.explanation}`;
        verdictTerminal = TERMINAL_VERDICTS.has(event.result);
        process.stdout.write(`\n  ⚖ ${event.result}: ${event.explanation}\n`);
        break;
      case "session.status_idle":
        if ((event as any).stop_reason?.type === "requires_action") break;
        if (!verdictTerminal) break; // transient idle mid-grading
        finish();
        break;
      case "session.status_terminated":
        finish();
        break;
    }
  }
} catch (e) {
  process.stderr.write(`\n(stream dropped: ${e instanceof Error ? e.message : e} — polling to completion)\n`);
}

// Poll the session to a terminal state, then rebuild the report from the
// server-side event log (authoritative, replaces the partial stream text).
while (true) {
  const s = await client.beta.sessions.retrieve(session.id);
  const done =
    s.status === "terminated" ||
    (s.status === "idle" && (s.outcome_evaluations ?? []).every((o) => TERMINAL_VERDICTS.has(o.result)));
  if (done) {
    const graded = (s.outcome_evaluations ?? []).filter((o) => o.completed_at).pop();
    if (graded) verdict = `${graded.result} — ${graded.explanation ?? ""}`;
    break;
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
out = "";
for await (const ev of client.beta.sessions.events.list(session.id, { limit: 100 })) {
  if (ev.type === "agent.message")
    for (const block of ev.content) if (block.type === "text") out += block.text;
}
finish();

function finish(): never {
  mkdirSync("radar-runs", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `radar-runs/${stamp}.md`;
  writeFileSync(path, `# Mission: ${mission}\n\n${out}${verdict ? `\n\n---\n_grader: ${verdict}_\n` : ""}`);
  console.log(`\n\nshortlist → ${path}`);
  process.exit(0);
}

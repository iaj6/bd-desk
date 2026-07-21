// Manually fires the weekly Digest deployment now and streams what the agent does
// (read CRM → compose → send via Resend). The email-sending smoke test.
//
//   npm run digest-fire

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

const ids = JSON.parse(readFileSync(".managed-agents.json", "utf8"));
if (!ids.digestDeploymentId) {
  console.error("No digest deployment — run `npm run deploy-digest` first.");
  process.exit(1);
}

const client = new Anthropic();
const run = await client.beta.deployments.run(ids.digestDeploymentId);
const sessionId: string | undefined = (run as any).session_id;
console.log(`session → ${sessionId}`);
console.log(`watch   → https://platform.claude.com/workspaces/default/sessions/${sessionId}\n`);
if (!sessionId) process.exit(1);

const seen = new Set<string>();
const history = await client.beta.sessions.events.list(sessionId);
for (const ev of history.data) {
  seen.add(ev.id);
  render(ev);
}
const stream = await client.beta.sessions.events.stream(sessionId);
for await (const event of stream) {
  const eid = "id" in event ? event.id : undefined; // some stream events (e.g. start) carry no id
  if (eid && !seen.has(eid)) {
    seen.add(eid);
    render(event);
  }
  if (event.type === "session.status_terminated") break;
  if (event.type === "session.status_idle" && (event as any).stop_reason?.type !== "requires_action") break;
}

function render(event: any) {
  if (event.type === "agent.message") {
    for (const b of event.content ?? []) if (b.type === "text") process.stdout.write(b.text);
  } else if (event.type === "agent.tool_use") {
    // Show the command shape without leaking secrets.
    const inp = JSON.stringify(event.input ?? {}).replace(/Bearer [^"\\ ]+/g, "Bearer ***");
    process.stdout.write(`\n  · ${event.name}: ${inp.slice(0, 160)}\n`);
  }
}

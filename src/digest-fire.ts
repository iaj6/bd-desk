// Manually fires the weekly Digest deployment now and streams what the agent does
// (read CRM → compose → send via Resend). The email-sending smoke test.
//
//   npm run digest-fire

import "./env.ts";
import { anthropic, sessionUrl } from "./constants.ts";
import { requireIds } from "./ids.ts";
import { pollToTerminal } from "./session.ts";

const ids = requireIds(["digestDeploymentId"], "run `npm run deploy-digest` first.");

const client = anthropic();
const run = await client.beta.deployments.run(ids.digestDeploymentId);
const sessionId: string | undefined = (run as any).session_id;
console.log(`session → ${sessionId}`);
if (!sessionId) process.exit(1);
console.log(`watch   → ${sessionUrl(sessionId)}\n`);

const seen = new Set<string>();
const history = await client.beta.sessions.events.list(sessionId);
for (const ev of history.data) {
  seen.add(ev.id);
  render(ev);
}

// The live stream can drop mid-run (HTTP/2 resets, session reschedules) while the
// session keeps going server-side — treat it as progress-only and fall back to polling
// + replay, the same recovery the other runners use (README platform note 3).
try {
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
} catch (e) {
  process.stderr.write(`\n(stream dropped: ${e instanceof Error ? e.message : e} — polling to completion)\n`);
}

// Reach a terminal state and replay anything the stream missed. The digest is ungraded,
// so idle-with-no-evaluations is genuinely done.
await pollToTerminal(client, sessionId);
for await (const ev of client.beta.sessions.events.list(sessionId, { limit: 100 })) {
  if (!seen.has(ev.id)) {
    seen.add(ev.id);
    render(ev);
  }
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

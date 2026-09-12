// Stands up the weekly Digest deployment. The digest sends via the CRM's
// `crm_send_digest` tool (which uses the CRM's own Resend key and a fixed recipient), so
// NO Resend credential goes into the agent's vault: the key never enters the agent
// sandbox, and nothing web-sourced in a record can redirect the mail.
//
//   npm run deploy-digest

import "./env.ts";
import { anthropic } from "./constants.ts";
import { requireIds, writeIds } from "./ids.ts";

const ids = requireIds(
  ["digestAgentId", "vaultId", "environmentId"],
  "run `npm run setup-digest` then `npm run setup-vault` first.",
);

const client = anthropic();

// Human-readable form of a cron expression, derived from the schedule the deployment
// actually got — so the printed line can't drift from the real cron the way a
// hardcoded string did.
function humanCron(expr?: string, tz?: string): string {
  if (!expr) return "(schedule pending)";
  const [min, hour, , , dow] = expr.split(" ");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const when = dow === "*" ? "daily" : `${days[Number(dow)] ?? dow}s`;
  return `${when} ${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}${tz ? ` ${tz}` : ""}`;
}

if (ids.digestDeploymentId) {
  console.log(`Digest deployment already exists: ${ids.digestDeploymentId}.`);
  process.exit(0);
}

const deployment = await client.beta.deployments.create({
  name: "BD Desk Weekly Digest",
  agent: ids.digestAgentId, // latest version
  environment_id: ids.environmentId,
  initial_events: [
    { type: "user.message", content: [{ type: "text", text: "Send this week's pipeline digest." }] },
  ],
  schedule: { type: "cron", expression: "0 9 * * 1", timezone: "America/New_York" }, // Mondays 9am ET (after the Radar)
  vault_ids: [ids.vaultId],
});

ids.digestDeploymentId = deployment.id;
writeIds(ids);

console.log(`\ndeployment → ${deployment.id} (${deployment.status})`);
console.log(`schedule   → ${humanCron(deployment.schedule?.expression, deployment.schedule?.timezone)}`);
console.log(`next runs  → ${(deployment.schedule?.upcoming_runs_at ?? []).slice(0, 2).join("  ")}`);
console.log(`\nTest it now:  npm run digest-fire`);

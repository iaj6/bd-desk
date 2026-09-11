// Adds the Resend key to the vault and stands up the weekly Digest deployment.
//
//   RESEND_API_KEY=re_... npm run deploy-digest

import "./env.ts";
import { anthropic } from "./constants.ts";
import { requireIds, writeIds } from "./ids.ts";

const ids = requireIds(
  ["digestAgentId", "vaultId", "environmentId"],
  "run `npm run setup-digest` then `npm run setup-vault` first.",
);

const resendKey = process.env.RESEND_API_KEY;
if (!resendKey) {
  console.error("Set RESEND_API_KEY=re_... in .env (or the environment).");
  process.exit(1);
}

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

// Add the Resend key to the same vault as the CRM token (idempotent).
try {
  const cred = await client.beta.vaults.credentials.create(ids.vaultId, {
    display_name: "Resend API key",
    auth: {
      type: "environment_variable",
      secret_name: "RESEND_API_KEY",
      secret_value: resendKey,
      networking: { type: "limited", allowed_hosts: ["api.resend.com"] },
    },
  });
  console.log(`resend credential → ${cred.id}`);
} catch (e: any) {
  if (e?.status === 409) console.log("Resend credential already exists — left as-is.");
  else throw e;
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

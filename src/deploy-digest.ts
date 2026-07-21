// Adds the Resend key to the vault and stands up the weekly Digest deployment.
//
//   RESEND_API_KEY=re_... npm run deploy-digest

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";

const IDS = ".managed-agents.json";
const ids = JSON.parse(readFileSync(IDS, "utf8"));
if (!ids.digestAgentId) {
  console.error("Run `npm run setup-digest` first.");
  process.exit(1);
}
if (!ids.vaultId) {
  console.error("No vault (run setup-vault first — it holds the CRM token).");
  process.exit(1);
}

const resendKey = process.env.RESEND_API_KEY;
if (!resendKey) {
  console.error("Set RESEND_API_KEY=re_... in the environment.");
  process.exit(1);
}

const client = new Anthropic();

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
writeFileSync(IDS, JSON.stringify(ids, null, 2));

console.log(`\ndeployment → ${deployment.id} (${deployment.status})`);
console.log(`schedule   → Mondays 07:00 America/New_York`);
console.log(`next runs  → ${(deployment.schedule?.upcoming_runs_at ?? []).slice(0, 2).join("  ")}`);
console.log(`\nTest it now:  npm run digest-fire`);

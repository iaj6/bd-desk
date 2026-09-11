// Creates the VAULT — the container for credentials the platform injects at
// egress, so agents can use secrets they never see. The credentials themselves
// are added by later steps:
//   - deploy-digest → the Resend API key (environment_variable, host-limited)
//   - setup-mcp    → the CRM MCP bearer (static_bearer bound to the MCP URL)
//
//   CRM_URL=https://<your-crm>.vercel.app npm run setup-vault
//
// Also records the CRM url in .managed-agents.json — brand-pack and setup-mcp
// read it from there so it's typed once.

import "./env.ts";
import { anthropic } from "./constants.ts";
import { readIds, writeIds, IDS_FILE } from "./ids.ts";

const ids = readIds();

const crmUrl = process.env.CRM_URL;
if (!crmUrl) {
  console.error("Set CRM_URL=https://... (your deployed CRM) in .env or the environment.");
  process.exit(1);
}

const client = anthropic();

if (ids.vaultId) {
  console.log(`Vault already exists: ${ids.vaultId}. Delete the key to re-create.`);
  process.exit(0);
}

const vault = await client.beta.vaults.create({ display_name: "BD Desk credentials" });
console.log(`vault → ${vault.id}`);

ids.vaultId = vault.id;
ids.crmUrl = crmUrl;
writeIds(ids);
console.log(`Saved vaultId + crmUrl to ${IDS_FILE}.`);

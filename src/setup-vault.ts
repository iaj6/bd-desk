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

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const IDS = ".managed-agents.json";
const ids = JSON.parse(readFileSync(IDS, "utf8"));

const crmUrl = process.env.CRM_URL;
if (!crmUrl) {
  console.error("Set CRM_URL=https://... (your deployed CRM) in .env or the environment.");
  process.exit(1);
}

const client = new Anthropic();

if (ids.vaultId) {
  console.log(`Vault already exists: ${ids.vaultId}. Delete the key to re-create.`);
  process.exit(0);
}

const vault = await client.beta.vaults.create({ display_name: "BD Desk credentials" });
console.log(`vault → ${vault.id}`);

ids.vaultId = vault.id;
ids.crmUrl = crmUrl;
writeFileSync(IDS, JSON.stringify(ids, null, 2));
console.log(`Saved vaultId + crmUrl to ${IDS}.`);

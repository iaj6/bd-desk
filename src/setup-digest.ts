// Creates the weekly Digest agent (reads the CRM, composes, sends via Resend).
// No credentials needed here — the vault (CRM + Resend tokens) attaches at deploy time.
//
//   npm run setup-digest

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { renderVars } from "./canon.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const IDS = ".managed-agents.json";
const ids = JSON.parse(readFileSync(IDS, "utf8"));

if (ids.digestAgentId) {
  console.log(`Digest agent already exists: ${ids.digestAgentId}. Delete the key to re-create.`);
  process.exit(0);
}

const client = new Anthropic();
// The digest prompt carries {{FOUNDER}}/{{CRM_URL}}/{{DIGEST_TO}}/… placeholders —
// resolved here from the brand pack + .env.
const system = renderVars(readFileSync("agents/weekly-digest.system.md", "utf8"));

const agent = await client.beta.agents.create({
  name: "BD Desk Weekly Digest",
  model: "claude-opus-4-8",
  system,
  tools: [{ type: "agent_toolset_20260401" }],
});
console.log(`digest agent → ${agent.id} (v${agent.version})`);

ids.digestAgentId = agent.id;
ids.digestAgentVersion = agent.version;
writeFileSync(IDS, JSON.stringify(ids, null, 2));
console.log(`Saved. Next: add the Resend key + deploy (npm run deploy-digest).`);

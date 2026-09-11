// Creates the weekly Digest agent (reads the CRM, composes, sends via Resend).
// No credentials needed here — the vault (CRM + Resend tokens) attaches at deploy time.
//
//   npm run setup-digest

import "./env.ts";
import { readFileSync } from "node:fs";
import { renderVars } from "./canon.ts";
import { anthropic, MODEL, AGENT_TOOLSET } from "./constants.ts";
import { readIds, writeIds } from "./ids.ts";

const ids = readIds();

if (ids.digestAgentId) {
  console.log(`Digest agent already exists: ${ids.digestAgentId}. Delete the key to re-create.`);
  process.exit(0);
}

const client = anthropic();
// The digest prompt carries {{FOUNDER}}/{{CRM_URL}}/{{DIGEST_TO}}/… placeholders —
// resolved here from the brand pack + .env.
const system = renderVars(readFileSync("agents/weekly-digest.system.md", "utf8"));

const agent = await client.beta.agents.create({
  name: "BD Desk Weekly Digest",
  model: MODEL,
  system,
  tools: [AGENT_TOOLSET],
});
console.log(`digest agent → ${agent.id} (v${agent.version})`);

ids.digestAgentId = agent.id;
ids.digestAgentVersion = agent.version;
writeIds(ids);
console.log(`Saved. Next: add the Resend key + deploy (npm run deploy-digest).`);

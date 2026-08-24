// Creates the sponsor-profile agent (used for "deep research" on a contact/sponsor).
//
//   npm run setup-sponsor

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { withCanon } from "./canon.ts";

const IDS = ".managed-agents.json";
const ids = JSON.parse(readFileSync(IDS, "utf8"));

if (ids.sponsorAgentId) {
  console.log(`Sponsor agent already exists: ${ids.sponsorAgentId}. Delete the key to re-create.`);
  process.exit(0);
}

const client = new Anthropic();
const system = withCanon("sponsor", readFileSync("agents/sponsor-profile.system.md", "utf8"));

const agent = await client.beta.agents.create({
  name: "BD Desk Sponsor Profile",
  model: "claude-opus-5",
  system,
  tools: [{ type: "agent_toolset_20260401" }],
});
console.log(`sponsor agent → ${agent.id} (v${agent.version})`);

ids.sponsorAgentId = agent.id;
ids.sponsorAgentVersion = agent.version;
writeFileSync(IDS, JSON.stringify(ids, null, 2));
console.log(`Saved. Add SPONSOR_AGENT_ID to the CRM env next.`);

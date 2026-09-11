// Creates the sponsor-profile agent (used for "deep research" on a contact/sponsor).
//
//   npm run setup-sponsor

import "./env.ts";
import { readFileSync } from "node:fs";
import { withCanon } from "./canon.ts";
import { anthropic, MODEL, AGENT_TOOLSET } from "./constants.ts";
import { readIds, writeIds } from "./ids.ts";

const ids = readIds();

if (ids.sponsorAgentId) {
  console.log(`Sponsor agent already exists: ${ids.sponsorAgentId}. Delete the key to re-create.`);
  process.exit(0);
}

const client = anthropic();
const system = withCanon("sponsor", readFileSync("agents/sponsor-profile.system.md", "utf8"));

const agent = await client.beta.agents.create({
  name: "BD Desk Sponsor Profile",
  model: MODEL,
  system,
  tools: [AGENT_TOOLSET],
});
console.log(`sponsor agent → ${agent.id} (v${agent.version})`);

ids.sponsorAgentId = agent.id;
ids.sponsorAgentVersion = agent.version;
writeIds(ids);
console.log(`Saved. Add SPONSOR_AGENT_ID to the CRM env next.`);

// ONE-TIME SETUP for the Opportunity Radar.
// Creates (1) a MEMORY STORE the radar uses to remember every target it's surfaced
// (so it never repeats), and (2) the radar AGENT. Reuses the existing environment.
// Appends the new IDs to .managed-agents.json.
//
//   npm run setup-radar

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { withCanon } from "./canon.ts";

const IDS = ".managed-agents.json";
if (!existsSync(IDS)) {
  console.error("No .managed-agents.json — run `npm run setup` first (it creates the environment).");
  process.exit(1);
}
const ids = JSON.parse(readFileSync(IDS, "utf8"));

if (ids.radarAgentId && ids.memoryStoreId) {
  console.log("Radar already provisioned. Delete the radar* / memoryStore* keys in .managed-agents.json to re-create.");
  process.exit(0);
}

const client = new Anthropic();
const system = withCanon("radar", readFileSync("agents/opportunity-radar.system.md", "utf8"));

// Memory store = persistent target list, survives across runs. The description is
// shown to the agent, so write it for the model.
const store = await client.beta.memoryStores.create({
  name: "bd-targets",
  description:
    "Running list of qualified BD targets the Opportunity Radar has already surfaced. One file per target. Check before sourcing to avoid duplicates.",
});
console.log(`memory store → ${store.id}`);

const agent = await client.beta.agents.create({
  name: "BD Desk Opportunity Radar",
  model: "claude-opus-5",
  system,
  tools: [{ type: "agent_toolset_20260401" }],
});
console.log(`radar agent  → ${agent.id} (v${agent.version})`);

ids.radarAgentId = agent.id;
ids.radarAgentVersion = agent.version;
ids.memoryStoreId = store.id;
writeFileSync(IDS, JSON.stringify(ids, null, 2));
console.log(`\nWrote IDs. Now:  npm run radar -- "your first mission"`);

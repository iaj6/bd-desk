// ONE-TIME SETUP for the Opportunity Radar.
// Creates (1) a MEMORY STORE the radar uses to remember every target it's surfaced
// (so it never repeats), and (2) the radar AGENT. Reuses the existing environment.
// Appends the new IDs to .managed-agents.json.
//
//   npm run setup-radar

import "./env.ts";
import { readFileSync } from "node:fs";
import { withCanon } from "./canon.ts";
import { anthropic, MODEL, AGENT_TOOLSET } from "./constants.ts";
import { requireIds, writeIds } from "./ids.ts";

const ids = requireIds(["environmentId"], "run `npm run setup` first (it creates the environment).");

if (ids.radarAgentId && ids.memoryStoreId) {
  console.log("Radar already provisioned. Delete the radar* / memoryStore* keys in .managed-agents.json to re-create.");
  process.exit(0);
}

const client = anthropic();
const system = withCanon("radar", readFileSync("agents/opportunity-radar.system.md", "utf8"));

// Persist each id the moment it's created and create only what's missing, so a failure
// on the agent create can't orphan the memory store (the radar's whole cross-run state).
if (!ids.memoryStoreId) {
  // Adopt an existing "bd-targets" store if a prior run left one un-persisted.
  let store: { id: string } | undefined;
  try {
    for await (const s of client.beta.memoryStores.list()) {
      if ((s as { name?: string }).name === "bd-targets") { store = s; break; }
    }
  } catch {
    /* list unavailable → create below */
  }
  const adopted = !!store;
  store = store ?? (await client.beta.memoryStores.create({
    name: "bd-targets",
    description:
      "Running list of qualified BD targets the Opportunity Radar has already surfaced. One file per target. Check before sourcing to avoid duplicates.",
  }));
  ids.memoryStoreId = store.id;
  writeIds(ids); // persist before the next create
  console.log(`memory store → ${store.id}${adopted ? " (adopted existing)" : ""}`);
}

if (!ids.radarAgentId) {
  const agent = await client.beta.agents.create({
    name: "BD Desk Opportunity Radar",
    model: MODEL,
    system,
    tools: [AGENT_TOOLSET],
  });
  ids.radarAgentId = agent.id;
  ids.radarAgentVersion = agent.version;
  writeIds(ids);
  console.log(`radar agent  → ${agent.id} (v${agent.version})`);
}

console.log(`\nWrote IDs. Now:  npm run radar -- "your first mission"`);

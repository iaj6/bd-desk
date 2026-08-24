// ONE-TIME SETUP — run once, then reuse the IDs it writes.
// Creates the Environment (the sandbox) and the Agent (the versioned config),
// then saves their IDs to .managed-agents.json. The session runner reads those.
//
//   npm run setup
//
// This is the "Agent-once" half of the mandatory flow. dossier.ts is the
// "Session-every-run" half — it never creates an agent.

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { withCanon } from "./canon.ts";

const IDS = ".managed-agents.json";

if (existsSync(IDS)) {
  console.log(`${IDS} already exists — agent + environment are provisioned.`);
  console.log("Delete it if you want to re-create them from scratch.");
  process.exit(0);
}

const client = new Anthropic(); // reads ANTHROPIC_API_KEY or your `ant auth login` profile
const system = withCanon("dossier", readFileSync("agents/bd-dossier.system.md", "utf8"));

// Environment = the cloud sandbox the agent's tools run in.
// Unrestricted networking because the dossier needs web access (search + fetch).
const env = await client.beta.environments.create({
  name: "bd-research",
  config: { type: "cloud", networking: { type: "unrestricted" } },
});
console.log(`environment → ${env.id}`);

// Agent = the persisted, versioned config. model/system/tools live HERE,
// never on the session. agent_toolset_20260401 gives web_search, web_fetch,
// read, write, bash, glob, grep.
const agent = await client.beta.agents.create({
  name: "BD Desk Dossier",
  model: "claude-opus-5",
  system,
  tools: [{ type: "agent_toolset_20260401" }],
});
console.log(`agent → ${agent.id} (v${agent.version})`);

writeFileSync(
  IDS,
  JSON.stringify(
    { agentId: agent.id, agentVersion: agent.version, environmentId: env.id },
    null,
    2,
  ),
);
console.log(`\nWrote ${IDS}. Next:  npm run dossier -- "Some Target Company"`);

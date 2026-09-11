// ONE-TIME SETUP — run once, then reuse the IDs it writes.
// Creates the Environment (the sandbox) and the Agent (the versioned config),
// then saves their IDs to .managed-agents.json. The session runner reads those.
//
//   npm run setup
//
// This is the "Agent-once" half of the mandatory flow. dossier.ts is the
// "Session-every-run" half — it never creates an agent.

import "./env.ts";
import { readFileSync, existsSync } from "node:fs";
import { withCanon } from "./canon.ts";
import { anthropic, MODEL, AGENT_TOOLSET } from "./constants.ts";
import { readIds, writeIds, IDS_FILE } from "./ids.ts";

// Idempotent AND partial-failure safe: read whatever ids already exist, create only
// what's missing, and persist each id the moment it's created — so a failure on the
// second create (rate limit, missing beta access, a bad model string) can never orphan
// the first resource, and a re-run picks up where it left off.
const ids = existsSync(IDS_FILE) ? readIds() : {};
if (ids.agentId && ids.environmentId) {
  console.log(`${IDS_FILE} already has the dossier agent + environment.`);
  console.log("Delete those keys if you want to re-create them from scratch.");
  process.exit(0);
}

const client = anthropic();
const system = withCanon("dossier", readFileSync("agents/bd-dossier.system.md", "utf8"));

// Environment = the cloud sandbox the agent's tools run in.
// Unrestricted networking because the dossier needs web access (search + fetch).
if (!ids.environmentId) {
  // Adopt an existing "bd-research" env if a prior run created one but died before
  // persisting its id, so a re-run doesn't leave a second one orphaned.
  let env: { id: string } | undefined;
  try {
    for await (const e of client.beta.environments.list()) {
      if ((e as { name?: string }).name === "bd-research") { env = e; break; }
    }
  } catch {
    /* list unavailable → just create below */
  }
  const adopted = !!env;
  env = env ?? (await client.beta.environments.create({
    name: "bd-research",
    config: { type: "cloud", networking: { type: "unrestricted" } },
  }));
  ids.environmentId = env.id;
  writeIds(ids); // persist before the next create
  console.log(`environment → ${env.id}${adopted ? " (adopted existing)" : ""}`);
}

// Agent = the persisted, versioned config. model/system/tools live HERE,
// never on the session. agent_toolset_20260401 gives web_search, web_fetch,
// read, write, bash, glob, grep.
if (!ids.agentId) {
  const agent = await client.beta.agents.create({
    name: "BD Desk Dossier",
    model: MODEL,
    system,
    tools: [AGENT_TOOLSET],
  });
  ids.agentId = agent.id;
  ids.agentVersion = agent.version;
  writeIds(ids);
  console.log(`agent → ${agent.id} (v${agent.version})`);
}

console.log(`\nWrote ${IDS_FILE}. Next:  npm run dossier -- "Some Target Company"`);

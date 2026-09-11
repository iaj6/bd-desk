// Re-reads each agent's system .md and pushes it as a NEW agent version.
// Each update is immutable + versioned — running sessions keep their pinned version;
// new sessions get whatever version .managed-agents.json points to.
//
//   npm run update            # updates both agents
//   npm run update -- radar   # just the radar
//   npm run update -- dossier # just the dossier

import "./env.ts";
import { readFileSync } from "node:fs";
import { withCanon, renderVars, type Consumer } from "./canon.ts";
import { anthropic } from "./constants.ts";
import { readIds, writeIds } from "./ids.ts";

const ids = readIds();
const which = process.argv.slice(2).join(" ").trim().toLowerCase();
// Remember the versions the pinned references point at, so we know whether to repin.
const before = { radar: ids.radarAgentVersion, mapper: ids.mapperAgentVersion };

const client = anthropic();

// name → { idKey, versionKey, systemFile, consumer }
// `consumer` selects which brand-canon block gets prepended (null = no canon, e.g.
// the digest, which reports on the pipeline rather than selling).
const agents: Record<string, { idKey: string; verKey: string; file: string; consumer: Consumer | null }> = {
  dossier: { idKey: "agentId", verKey: "agentVersion", file: "agents/bd-dossier.system.md", consumer: "dossier" },
  radar: { idKey: "radarAgentId", verKey: "radarAgentVersion", file: "agents/opportunity-radar.system.md", consumer: "radar" },
  digest: { idKey: "digestAgentId", verKey: "digestAgentVersion", file: "agents/weekly-digest.system.md", consumer: null },
  sponsor: { idKey: "sponsorAgentId", verKey: "sponsorAgentVersion", file: "agents/sponsor-profile.system.md", consumer: "sponsor" },
  mapper: { idKey: "mapperAgentId", verKey: "mapperAgentVersion", file: "agents/sponsor-mapper.system.md", consumer: "radar" },
};

for (const [name, a] of Object.entries(agents)) {
  if (which && which !== name) continue;
  const id = ids[a.idKey];
  if (!id) continue; // not provisioned
  const systemMd = readFileSync(a.file, "utf8");
  // renderVars resolves {{…}} placeholders (digest only today; no-op elsewhere).
  const system = renderVars(a.consumer ? withCanon(a.consumer, systemMd) : systemMd);
  const updated = await client.beta.agents.update(id, { version: ids[a.verKey], system });
  console.log(`${name}: ${id}  v${ids[a.verKey]} → v${updated.version}`);
  ids[a.verKey] = updated.version;
}

// Pushing a new agent version does NOT reach references that pin an explicit version:
// the weekly radar cron and the Sponsor Mapper roster both do. Re-point them, or a
// prompt/canon edit never reaches Monday's scheduled sweep (it keeps running the old
// version, silently, while radar-runs shows healthy runs the whole time).
const mapperChanged = before.mapper !== ids.mapperAgentVersion;
const radarChanged = before.radar !== ids.radarAgentVersion;

if (mapperChanged && ids.radarAgentId && ids.mapperAgentId) {
  // Re-seat the new mapper version on the radar's coordinator roster; this mints a new
  // radar version too, which the cron repin below then picks up.
  const updated = await client.beta.agents.update(ids.radarAgentId, {
    version: ids.radarAgentVersion,
    multiagent: {
      type: "coordinator",
      agents: [{ type: "agent", id: ids.mapperAgentId, version: ids.mapperAgentVersion }],
    },
  });
  ids.radarAgentVersion = updated.version;
  console.log(`roster: re-seated Sponsor Mapper v${ids.mapperAgentVersion} → radar v${ids.radarAgentVersion}`);
}

if ((radarChanged || mapperChanged) && ids.deploymentId && ids.radarAgentId) {
  await client.beta.deployments.update(ids.deploymentId, {
    agent: { type: "agent", id: ids.radarAgentId, version: ids.radarAgentVersion },
  });
  console.log(`radar cron: repinned → v${ids.radarAgentVersion}`);
}

writeIds(ids);
console.log("Pinned .managed-agents.json to the new versions.");

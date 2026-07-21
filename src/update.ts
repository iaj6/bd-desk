// Re-reads each agent's system .md and pushes it as a NEW agent version.
// Each update is immutable + versioned — running sessions keep their pinned version;
// new sessions get whatever version .managed-agents.json points to.
//
//   npm run update            # updates both agents
//   npm run update -- radar   # just the radar
//   npm run update -- dossier # just the dossier

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { withCanon, renderVars, type Consumer } from "./canon.ts";

// Load managed_agents/.env if present so ANTHROPIC_API_KEY is picked up automatically.
try {
  if (existsSync(".env")) process.loadEnvFile(".env");
} catch {
  /* optional */
}

const IDS = ".managed-agents.json";
if (!existsSync(IDS)) {
  console.error("No .managed-agents.json — run `npm run setup` first.");
  process.exit(1);
}
const ids = JSON.parse(readFileSync(IDS, "utf8"));
const which = process.argv.slice(2).join(" ").trim().toLowerCase();

const client = new Anthropic();

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

writeFileSync(IDS, JSON.stringify(ids, null, 2));
console.log("Pinned .managed-agents.json to the new versions.");

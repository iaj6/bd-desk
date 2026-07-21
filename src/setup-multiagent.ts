// Makes the Radar a multi-agent COORDINATOR: creates the locked Sponsor Mapper
// sub-agent and puts it on the Radar's roster, so each popped sponsor's portfolio
// mapping runs as a parallel session thread inside the sweep.
//
//   npm run setup-multiagent
//
// Idempotent. Notes from the reference workshops that apply here:
//   - roster entries are versioned refs; depth limit 1 (the mapper itself must
//     never get a `multiagent` block)
//   - the sub-agent's system prompt is fixed server-side — a hostile page the
//     mapper reads lands in its user turn, it can't redefine the mapper's role
//   - `agents.update` can ADD a multiagent block but not remove one; the pinned
//     pre-roster radar version stays addressable if we ever need a solo radar
//
// The mapper deliberately gets NO memory store, NO MCP, and NO skills — research
// tools only. The coordinator owns memory, CRM pushes, and the report.

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { withCanon } from "./canon.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const IDS = ".managed-agents.json";
const ids = JSON.parse(readFileSync(IDS, "utf8"));
if (!ids.radarAgentId) {
  console.error("No radar agent — run `npm run setup-radar` first.");
  process.exit(1);
}

const client = new Anthropic();

// 1. The Sponsor Mapper sub-agent (canon's radar block = the ICP it scores against).
if (!ids.mapperAgentId) {
  const mapper = await client.beta.agents.create({
    name: "BD Desk Sponsor Mapper",
    model: "claude-opus-4-8",
    system: withCanon("radar", readFileSync("agents/sponsor-mapper.system.md", "utf8")),
    tools: [{ type: "agent_toolset_20260401" }],
  });
  ids.mapperAgentId = mapper.id;
  ids.mapperAgentVersion = mapper.version;
  writeFileSync(IDS, JSON.stringify(ids, null, 2));
  console.log(`mapper agent → ${mapper.id} (v${mapper.version})`);
} else {
  console.log(`mapper agent already exists: ${ids.mapperAgentId} (v${ids.mapperAgentVersion})`);
}

// 2. Put the mapper on the Radar's roster.
const updated = await client.beta.agents.update(ids.radarAgentId, {
  version: ids.radarAgentVersion,
  multiagent: {
    type: "coordinator",
    agents: [{ type: "agent", id: ids.mapperAgentId, version: ids.mapperAgentVersion }],
  },
});
console.log(`radar: v${ids.radarAgentVersion} → v${updated.version}  (coordinator over Sponsor Mapper)`);
ids.radarAgentVersion = updated.version;

// 3. Repin the weekly cron.
if (ids.deploymentId) {
  await client.beta.deployments.update(ids.deploymentId, {
    agent: { type: "agent", id: ids.radarAgentId, version: ids.radarAgentVersion },
  });
  console.log(`radar deployment repinned → v${ids.radarAgentVersion}`);
}

writeFileSync(IDS, JSON.stringify(ids, null, 2));
console.log("\nDone. Test a delegated sweep:  npm run radar-fire");

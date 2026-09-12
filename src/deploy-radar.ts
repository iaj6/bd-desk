// Stands up the weekly Radar cron. Two steps:
//  1. Seed the BFS worklist in memory (empty _done.md, an empty frontier with
//     bootstrap instructions). Host-side memory writes — replace the frontier seed
//     with real PE sponsors in your vertical if you already know some.
//  2. Create a DEPLOYMENT that fires a Radar sweep on a weekly cron.
//
//   npm run deploy-radar

import "./env.ts";
import { defineOutcome } from "./rubrics.ts";
import { anthropic } from "./constants.ts";
import { requireIds, writeIds } from "./ids.ts";

const ids = requireIds(
  ["radarAgentId", "memoryStoreId", "environmentId"],
  "run `npm run setup` then `npm run setup-radar` first.",
);

const client = anthropic();

// 1. Seed the worklist (idempotent — ignore "already exists" conflicts).
async function seed(path: string, content: string) {
  try {
    await client.beta.memoryStores.memories.create(ids.memoryStoreId, { path, content });
    console.log(`seeded ${path}`);
  } catch (e: any) {
    if (e?.status === 409) console.log(`${path} already exists — left as-is`);
    else throw e;
  }
}

await seed(
  "/_done.md",
  `# Sponsors already mapped — do NOT re-map\n(none yet)\n`,
);
await seed(
  "/_frontier.md",
  `# Frontier — sponsors discovered, not yet mapped (pop from top)\n(empty — bootstrap this sweep: discover 3–5 PE sponsors with an active thesis in the ICP's vertical via sector-focused PE firm lists, recent recap/M&A news, and industry certification directories; queue them here, then map the first one.)\n`,
);

const SWEEP =
  "Do your next sweep per your protocol: read _frontier.md and _done.md, refill the frontier if thin, " +
  "pop the next 2–3 sponsors, card their qualified portcos, extend the frontier with any newly-found " +
  "sponsors, and move mapped sponsors into _done.md. Report the net-new targets and the current frontier.";

// 2. Create the weekly deployment — or refresh the existing one's kickoff in
// place (update keeps the id, schedule, and run history), so scheduled sweeps
// always run the current graded kickoff + rubric.
if (ids.deploymentId) {
  const dep = await client.beta.deployments.update(ids.deploymentId, {
    // Repin the agent version too, so re-running deploy-radar after `npm run update`
    // is self-healing rather than leaving the weekly cron on a stale prompt.
    agent: { type: "agent", id: ids.radarAgentId, version: ids.radarAgentVersion },
    initial_events: [defineOutcome("radar", SWEEP)],
  });
  console.log(`\ndeployment → ${dep.id} kickoff + agent version refreshed — weekly sweeps run the current prompt, graded against the radar rubric.`);
  process.exit(0);
}

const deployment = await client.beta.deployments.create({
  name: "BD Desk Opportunity Radar — weekly",
  agent: { type: "agent", id: ids.radarAgentId, version: ids.radarAgentVersion },
  environment_id: ids.environmentId,
  // Graded kickoff: every scheduled sweep is scored against the radar rubric and
  // revised (once) if it falls short — the unattended runs are exactly the ones
  // nobody is watching for quality drift.
  initial_events: [defineOutcome("radar", SWEEP)],
  schedule: { type: "cron", expression: "0 8 * * 1", timezone: "America/New_York" }, // Mondays 8am ET
  vault_ids: ids.vaultId ? [ids.vaultId] : undefined, // holds the CRM MCP bearer, injected at egress
  resources: [
    {
      type: "memory_store",
      memory_store_id: ids.memoryStoreId,
      access: "read_write",
      instructions: "Your running target list + BFS worklist (_frontier.md / _done.md).",
    },
  ],
});

ids.deploymentId = deployment.id;
writeIds(ids);

console.log(`\ndeployment → ${deployment.id}  (status: ${deployment.status})`);
const upcoming = deployment.schedule?.upcoming_runs_at ?? [];
console.log(`schedule   → Mondays 08:00 America/New_York`);
console.log(`next runs  → ${upcoming.slice(0, 3).join("  ") || "(pending)"}`);
console.log(`\nFire a test sweep now:  npm run radar-fire`);

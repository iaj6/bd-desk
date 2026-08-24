// Runs a DREAM: consolidates the Radar's memory store + recent session
// transcripts into a NEW, cleaner store, then swaps the radar (manual runs +
// weekly cron) onto it.
//
//   npm run dream
//
// Dreaming is the batch memory primitive: inputs = the current bd-targets
// store + recent radar/sponsor transcripts; output = a brand-new memory store.
// The old store is left untouched as rollback (id kept under
// memoryStoreIdPrevious). The instructions pin the exact file layout the
// radar protocol depends on, and distill a /_learnings.md from the transcripts
// — so the radar "remembers" lessons from sessions it never ran (sponsor
// profiles included).

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const IDS = ".managed-agents.json";
const ids = JSON.parse(readFileSync(IDS, "utf8"));
if (!ids.memoryStoreId || !ids.radarAgentId) {
  console.error("Radar not provisioned — run `npm run setup-radar` first.");
  process.exit(1);
}

const client = new Anthropic();

// Recent transcripts: radar sweeps carry sourcing lessons; sponsor profiles
// carry portfolio knowledge the radar should not re-derive.
async function recentSessions(agentId: string, n: number): Promise<string[]> {
  const page = await client.beta.sessions.list({ agent_id: agentId, limit: n });
  return page.data.filter((s) => s.status === "idle" || s.status === "terminated").map((s) => s.id);
}
const sessionIds = [
  ...(await recentSessions(ids.radarAgentId, 8)),
  ...(ids.sponsorAgentId ? await recentSessions(ids.sponsorAgentId, 4) : []),
];
console.log(`inputs → store ${ids.memoryStoreId} + ${sessionIds.length} session transcripts`);

const INSTRUCTIONS = `
Consolidate this Opportunity Radar memory store into a cleaner next-generation store.
PRESERVE THE EXACT FILE LAYOUT the radar's protocol depends on:
- /_frontier.md — FIFO worklist of sponsors discovered but NOT yet mapped (top = next to pop)
- /_done.md — sponsors already mapped, each with the date it was mapped
- /<company-slug>.md — one qualifying card per target company
- /<sponsor-slug>.sponsor.md — one short cluster overview per mapped sponsor

Consolidation rules:
- Dedupe name-variant duplicates (e.g. an acronym vs the spelled-out company) — keep one
  card, the richer of the two.
- Tighten verbose cards to their decision-useful core: fit, GREEN signals, why-now,
  entry persona, sources. Keep every source URL.
- Keep every RED/skip record — they prevent re-surfacing — but at one line each.
- Reconcile the worklists against the cards and the transcripts: a sponsor whose map
  appears in a transcript belongs in /_done.md, not the frontier; drop frontier entries
  that were already mapped.
- From the session transcripts, distill DURABLE sourcing lessons into a new
  /_learnings.md file the radar reads before sweeping: which sponsor shapes were dead
  ends (e.g. large-cap T&L specialists), which sourcing angles produced Strong targets,
  which angles are still untapped, per-fund one-line verdicts. Lessons, not narration.
- Do NOT invent targets, sponsors, or facts absent from the inputs.
`.trim();

const dream = await client.beta.dreams.create({
  model: "claude-opus-5",
  inputs: [
    { type: "memory_store", memory_store_id: ids.memoryStoreId },
    ...(sessionIds.length ? [{ type: "sessions" as const, session_ids: sessionIds }] : []),
  ],
  instructions: INSTRUCTIONS,
  betas: ["managed-agents-2026-04-01"], // joined with the SDK's default dreaming beta
});
console.log(`dream  → ${dream.id} (${dream.status})`);

// Dreams run async — poll to a terminal status.
let d = dream;
while (d.status === "pending" || d.status === "running") {
  await new Promise((r) => setTimeout(r, 30_000));
  d = await client.beta.dreams.retrieve(dream.id);
  console.log(`         ${d.status}…`);
}
if (d.status !== "completed") {
  console.error(`Dream ${d.status}:`, d.error ?? "");
  process.exit(1);
}

const newStore = d.outputs.find((o) => o.type === "memory_store")?.memory_store_id;
if (!newStore) {
  console.error("Dream completed but produced no memory store:", d.outputs);
  process.exit(1);
}
console.log(`\nnew store → ${newStore}. Contents:`);
for await (const m of client.beta.memoryStores.memories.list(newStore, { limit: 100 })) {
  console.log(`  ${(m as any).path}`);
}

// Swap: manual runs read ids.memoryStoreId at session create; the cron needs its
// resources updated in place. Old store kept as rollback.
ids.memoryStoreIdPrevious = ids.memoryStoreId;
ids.memoryStoreId = newStore;
if (ids.deploymentId) {
  await client.beta.deployments.update(ids.deploymentId, {
    resources: [
      {
        type: "memory_store",
        memory_store_id: newStore,
        access: "read_write",
        instructions:
          "Your running target list + BFS worklist (_frontier.md / _done.md) + distilled sourcing lessons (_learnings.md).",
      },
    ],
  });
  console.log(`radar deployment now mounts ${newStore}`);
}
writeFileSync(IDS, JSON.stringify(ids, null, 2));
console.log(`\nSwapped. Previous store kept as rollback: ${ids.memoryStoreIdPrevious}`);
console.log("If the next sweeps look good, archive it in the Console (or via memoryStores.archive).");

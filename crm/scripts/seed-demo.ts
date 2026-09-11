// Seed the demo pipeline. Writes the fictional board from lib/demo.ts into the local
// demo data directory so `npm run demo` opens on a populated CRM with no cloud
// account and no API key.
//
//   npm run demo                   # seed (if empty) + start the dev server
//   npm run seed:demo              # seed only
//   npm run seed:demo -- --reset   # wipe and re-seed
//
// Safe by construction: it forces the filesystem driver at an explicit directory, so
// it can never write to a real Blob store even if cloud credentials are in the env.

import { rm } from "node:fs/promises";
import { setStore, fileStore } from "../lib/storage";
import { upsertTarget, patchTarget, listTargets, slugify } from "../lib/store";
import { putBrandPack } from "../lib/brand";
import { DEMO_TARGETS, DEMO_BRAND_PACK } from "../lib/demo";

const DIR = process.env.BD_DESK_DEMO_DIR ?? ".demo-data";

async function main() {
  const reset = process.argv.slice(2).includes("--reset");
  if (reset) {
    await rm(DIR, { recursive: true, force: true });
    console.log(`reset ${DIR}/`);
  }

  setStore(fileStore(DIR));

  const existing = await listTargets();
  if (existing.length && !reset) {
    console.log(`${DIR}/ already has ${existing.length} target(s) — nothing to do.`);
    console.log("Re-seed from scratch with:  npm run seed:demo -- --reset");
    return;
  }

  await putBrandPack(DEMO_BRAND_PACK);

  for (const seed of DEMO_TARGETS) {
    const { status, notes, next_step, follow_up, ...sourced } = seed;
    // Human-owned fields go through patchTarget, the same door the UI uses — upsert
    // deliberately refuses to set them, and the seed should not be a special case.
    // Contacts slug by person+org, the same rule the UI and MCP add paths use, so a
    // seeded board is indistinguishable from one built by hand.
    const slug =
      sourced.kind === "contact" && sourced.contact_name
        ? slugify(`${sourced.contact_name} ${sourced.company}`)
        : undefined;
    const t = await upsertTarget({ ...sourced, manual: false, ...(slug ? { slug } : {}) });
    const human = { status, notes, next_step, follow_up };
    if (Object.values(human).some((v) => v !== undefined)) await patchTarget(t.slug, human);
    console.log(`  + ${t.slug}`);
  }

  console.log(`\nSeeded ${DEMO_TARGETS.length} targets into ${DIR}/.`);
  console.log("Start the CRM with:  npm run demo      (port taken? PORT=3011 npm run demo)");
  console.log("The MCP server + crons run offline too: MCP_TOKEN=demo CRON_SECRET=demo npm run demo,");
  console.log("then use `Bearer demo` on /api/mcp and /api/cron/*.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

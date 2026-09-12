// Brand-pack compiler — the ONE place your canon (identity, positioning, voice,
// proof, ICP) flows from the source of truth into every consumer, so the outreach
// drafter and the research agents never drift from what's true.
//
// Source of truth:  brand/brand-pack.yaml  (copy brand-pack.example.yaml, edit, keep private)
// Consumers:
//   - the Managed Agents (dossier / radar / sponsor) — get canon compiled into their
//     system prompt at push time (`npm run update` reads agents/_canon.json).
//   - the CRM outreach drafter (on Vercel) — reads the pack from Blob at draft time;
//     this script POSTs it to the CRM's /api/brand-pack endpoint.
//
//   npm run brand-pack            # compile + write agents/_canon.json + push to CRM
//   npm run brand-pack -- --local # compile + write only; skip the CRM push
//
// Env:
//   BRAND_DIR          dir holding brand-pack.yaml (default: ./brand)
//   CRM_INGEST_TOKEN   bearer for the CRM push (the CRM's INGEST_TOKEN)
//   CRM_URL            CRM base url (or crmUrl in .managed-agents.json)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { validateSpine, buildPack, type Spine } from "./brand-canon.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

try {
  if (existsSync(resolve(REPO, ".env"))) process.loadEnvFile(resolve(REPO, ".env"));
} catch {
  /* optional */
}

const BRAND_DIR = process.env.BRAND_DIR || resolve(REPO, "brand");
const SPINE = resolve(BRAND_DIR, "brand-pack.yaml");
const CANON_OUT = resolve(REPO, "agents/_canon.json");

const localOnly = process.argv.slice(2).includes("--local");

// ---------- run ----------
if (!existsSync(SPINE)) {
  console.error(`No brand pack at ${SPINE}.`);
  console.error("Start from the example:  cp brand/brand-pack.example.yaml brand/brand-pack.yaml");
  process.exit(1);
}

const spine = parse(readFileSync(SPINE, "utf8")) as Spine;
const problems = validateSpine(spine);
if (problems.length) {
  console.error("brand-pack.yaml is missing or has empty fields:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nFill them in — see brand/brand-pack.example.yaml for the full shape.");
  process.exit(1);
}
const pack = buildPack(spine);

writeFileSync(CANON_OUT, JSON.stringify(pack, null, 2) + "\n");
console.log(`✓ wrote ${CANON_OUT}  (blocks: ${Object.keys(pack.blocks).join(", ")})`);

if (localOnly) {
  console.log("• --local: skipped CRM push.");
  process.exit(0);
}

// Push the pack to the CRM so the outreach drafter picks up the new canon (no redeploy).
const token = process.env.CRM_INGEST_TOKEN;
let crmUrl = process.env.CRM_URL;
if (!crmUrl && existsSync(resolve(REPO, ".managed-agents.json"))) {
  crmUrl = JSON.parse(readFileSync(resolve(REPO, ".managed-agents.json"), "utf8")).crmUrl;
}
if (!token || !crmUrl) {
  console.warn("• Skipping CRM push (need CRM_INGEST_TOKEN + CRM_URL / crmUrl in .managed-agents.json).");
  console.warn("  Agent canon is written; run `npm run update` to push it to the Managed Agents.");
  process.exit(0);
}

const endpoint = `${crmUrl.replace(/\/$/, "")}/api/brand-pack`;
const res = await fetch(endpoint, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(pack),
});
if (!res.ok) {
  console.error(`✗ CRM push failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`✓ pushed pack to ${endpoint}`);
console.log("Next: `npm run update` to push the refreshed canon into the Managed Agents.");

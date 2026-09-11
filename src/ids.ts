// Read/write the provisioned-resource ids file, with a single clear error when it's
// missing or a required id hasn't been provisioned yet. Replaces the copy-pasted
// `existsSync(IDS) … JSON.parse(readFileSync(IDS))` preamble (and its bare-ENOENT
// crash) that every script used to carry.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const IDS_FILE = ".managed-agents.json";

// Values are `any` because scripts read heterogeneous ids and nested objects
// (ids.skills is a map) and pass them straight to SDK calls — the same shape they got
// from JSON.parse before.
export type Ids = Record<string, any>;

export function readIds(): Ids {
  if (!existsSync(IDS_FILE)) {
    console.error(`No ${IDS_FILE} — run \`npm run setup\` first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(IDS_FILE, "utf8"));
}

export function writeIds(ids: Ids): void {
  writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2));
}

// Read the ids and assert every named key is present, naming the setup step that
// provisions them when one is missing.
export function requireIds(keys: string[], hint = "run the setup scripts first."): Ids {
  const ids = readIds();
  const missing = keys.filter((k) => !ids[k]);
  if (missing.length) {
    console.error(`Missing ${missing.join(", ")} in ${IDS_FILE} — ${hint}`);
    process.exit(1);
  }
  return ids;
}

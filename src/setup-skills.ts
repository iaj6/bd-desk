// Uploads the skills in skills/ and attaches them to the agents — the
// decomposition rep: prompts keep identity + canon, procedure loads on demand.
//
//   npm run setup-skills
//
// Idempotent: first run creates each skill (id saved to .managed-agents.json under
// "skills"); later runs push a new skill VERSION from the same folder. Agents
// reference version "latest", so a re-run updates their behavior without an agent
// version bump — but this script also re-pushes the (shortened) system prompts,
// which DOES bump agent versions and repins the radar cron.
//
// Skill layout rule: each skills/<name>/ folder must contain SKILL.md whose
// frontmatter `name` equals the folder name; every file uploads under that folder.

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { withCanon } from "./canon.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const IDS = ".managed-agents.json";
const ids = JSON.parse(readFileSync(IDS, "utf8"));
const client = new Anthropic();
const BETAS = ["skills-2025-10-02" as const];

// 1. Upload each skill folder (create once, then new versions).
function skillFiles(dir: string, name: string) {
  const out: { path: string; name: string }[] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    out.push({ path: full, name: `${name}/${relative(dir, full)}` });
  }
  return out;
}

ids.skills ??= {};
for (const name of readdirSync("skills")) {
  const files = await Promise.all(
    skillFiles(join("skills", name), name).map((f) =>
      toFile(readFileSync(f.path), f.name),
    ),
  );
  if (!ids.skills[name]) {
    // Adopt a skill that already exists under this display_title (e.g. from a
    // partial earlier run) instead of failing on the title-uniqueness check.
    for await (const s of client.beta.skills.list({ betas: BETAS })) {
      if ((s as any).display_title === name) {
        ids.skills[name] = (s as any).id;
        break;
      }
    }
  }
  if (ids.skills[name]) {
    const v = await client.beta.skills.versions.create(ids.skills[name], { files, betas: BETAS });
    console.log(`skill ${name} → ${ids.skills[name]} (new version ${(v as any).version ?? ""})`);
  } else {
    const skill = await client.beta.skills.create({ display_title: name, files, betas: BETAS });
    ids.skills[name] = (skill as any).id;
    console.log(`skill ${name} → ${ids.skills[name]} (created)`);
  }
  writeFileSync(IDS, JSON.stringify(ids, null, 2)); // persist as we go — a later failure must not orphan ids
}

const ref = (name: string) => ({ type: "custom" as const, skill_id: ids.skills[name], version: "latest" });

// 2. Attach skills + push the shortened prompts (one version bump per agent).
const plans = [
  {
    label: "dossier",
    idKey: "agentId",
    verKey: "agentVersion",
    system: withCanon("dossier", readFileSync("agents/bd-dossier.system.md", "utf8")),
    skills: [ref("bd-dossier-format"), ref("bd-machine-blocks")],
  },
  {
    label: "sponsor",
    idKey: "sponsorAgentId",
    verKey: "sponsorAgentVersion",
    system: withCanon("sponsor", readFileSync("agents/sponsor-profile.system.md", "utf8")),
    skills: [ref("bd-sponsor-format"), ref("bd-machine-blocks")],
  },
  {
    label: "radar",
    idKey: "radarAgentId",
    verKey: "radarAgentVersion",
    system: withCanon("radar", readFileSync("agents/opportunity-radar.system.md", "utf8")),
    skills: [ref("bd-radar-protocol")],
  },
];

for (const p of plans) {
  if (!ids[p.idKey]) continue; // not provisioned
  const updated = await client.beta.agents.update(ids[p.idKey], {
    version: ids[p.verKey],
    system: p.system,
    skills: p.skills,
  });
  console.log(`${p.label}: ${ids[p.idKey]}  v${ids[p.verKey]} → v${updated.version}  (skills attached)`);
  ids[p.verKey] = updated.version;
}

// 3. Repin the radar cron (it pins an explicit version).
if (ids.deploymentId) {
  await client.beta.deployments.update(ids.deploymentId, {
    agent: { type: "agent", id: ids.radarAgentId, version: ids.radarAgentVersion },
  });
  console.log(`radar deployment repinned → v${ids.radarAgentVersion}`);
}

writeFileSync(IDS, JSON.stringify(ids, null, 2));
console.log("\nPinned .managed-agents.json. Verify with:  npm run eval");

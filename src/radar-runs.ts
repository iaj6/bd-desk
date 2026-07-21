// Lists what the weekly deployment has produced — every fire (scheduled or manual),
// its session, and any error. Your monitoring window.
//
//   npm run radar-runs

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

const ids = JSON.parse(readFileSync(".managed-agents.json", "utf8"));
if (!ids.deploymentId) {
  console.error("No deployment — run `npm run deploy-radar` first.");
  process.exit(1);
}

const client = new Anthropic();
const runs = await client.beta.deploymentRuns.list({ deployment_id: ids.deploymentId });

console.log(`deployment ${ids.deploymentId}\n`);
for (const r of runs.data) {
  const trigger = (r as any).trigger_context?.type ?? "?";
  const when = (r as any).created_at ?? "";
  const sess = (r as any).session_id;
  const err = (r as any).error?.type;
  console.log(`${when}  [${trigger}]  ${err ? `ERROR ${err}` : sess ?? "(no session)"}`);
  if (sess) console.log(`   https://platform.claude.com/workspaces/default/sessions/${sess}`);
}

// Lists what the weekly deployment has produced — every fire (scheduled or manual),
// its session, and any error. Your monitoring window.
//
//   npm run radar-runs

import "./env.ts";
import { anthropic, sessionUrl } from "./constants.ts";
import { requireIds } from "./ids.ts";

const ids = requireIds(["deploymentId"], "run `npm run deploy-radar` first.");

const client = anthropic();
const runs = await client.beta.deploymentRuns.list({ deployment_id: ids.deploymentId });

console.log(`deployment ${ids.deploymentId}\n`);
for (const r of runs.data) {
  const trigger = (r as any).trigger_context?.type ?? "?";
  const when = (r as any).created_at ?? "";
  const sess = (r as any).session_id;
  const err = (r as any).error?.type;
  console.log(`${when}  [${trigger}]  ${err ? `ERROR ${err}` : sess ?? "(no session)"}`);
  if (sess) console.log(`   ${sessionUrl(sess)}`);
}

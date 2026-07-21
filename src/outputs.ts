// Fetch a session's deliverable file via the Files API. Sandbox files written to
// /mnt/session/outputs/ are indexed under the session's scope with a 1–3s lag
// after the session idles — hence the short retry. Returns null if the agent
// never wrote the file (callers fall back to message-parsing).

import type Anthropic from "@anthropic-ai/sdk";
import { DELIVERABLE_FILENAME } from "./rubrics.ts";

const BETAS = ["managed-agents-2026-04-01" as const];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchDeliverable(client: Anthropic, sessionId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(2000);
    const files = await client.beta.files.list({ scope_id: sessionId, betas: BETAS });
    const f = files.data.find((x) => x.filename.endsWith(DELIVERABLE_FILENAME) && x.downloadable);
    if (f) {
      const resp = await client.beta.files.download(f.id, { betas: BETAS });
      return await resp.text();
    }
  }
  return null;
}

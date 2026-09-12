// Points the Radar and Digest agents at the CRM's own MCP server instead of
// bash+curl: typed tool calls, per-tool allowlists, and clean agent.mcp_tool_use
// events. Auth is a static_bearer vault credential bound to the server URL — the
// platform attaches it at egress, the agent never sees the token.
//
// Idempotent — safe to re-run after prompt or allowlist changes. Steps:
//   1. vault: ensure a static_bearer credential for the CRM MCP endpoint
//   2. agents: push new versions with mcp_servers + allowlisted mcp_toolset
//      (+ the current system prompts, same as `npm run update`)
//   3. deployments: repin the radar cron to the new version (the digest cron
//      tracks latest, so it picks the new version up on its own)
//
//   MCP_TOKEN=... npm run setup-mcp     # or let it read crm/.env.local
//
// The environment needs no change: `allow_mcp_servers` only gates `limited`
// networking, and bd-research is `unrestricted`.

import "./env.ts";
import { readFileSync, existsSync } from "node:fs";
import { withCanon, renderVars } from "./canon.ts";
import { anthropic, AGENT_TOOLSET } from "./constants.ts";
import { requireIds, writeIds } from "./ids.ts";

const ids = requireIds(
  ["radarAgentId", "digestAgentId", "vaultId"],
  "run setup-radar / setup-digest / setup-vault first.",
);

// CRM base url: CRM_URL env, or the crmUrl setup-vault recorded.
const crmBase: string | undefined = process.env.CRM_URL || ids.crmUrl;
if (!crmBase) {
  console.error("No CRM url — set CRM_URL in .env (or run `npm run setup-vault` first).");
  process.exit(1);
}
const CRM_MCP_URL = `${crmBase.replace(/\/$/, "")}/api/mcp`;

// MCP_TOKEN: env var, or fall back to the CRM's local env file.
let mcpToken = process.env.MCP_TOKEN;
if (!mcpToken && existsSync("crm/.env.local")) {
  mcpToken = readFileSync("crm/.env.local", "utf8").match(/^MCP_TOKEN=(.+)$/m)?.[1]?.trim();
}
if (!mcpToken) {
  console.error("No MCP_TOKEN (env var or crm/.env.local).");
  process.exit(1);
}

const client = anthropic();

// 1. Vault: static_bearer for the CRM MCP endpoint (skip if one already exists).
const existing = await client.beta.vaults.credentials.list(ids.vaultId);
const has = existing.data.some(
  (c: any) => c.auth?.type === "static_bearer" && c.auth?.mcp_server_url === CRM_MCP_URL,
);
if (has) {
  console.log("vault: CRM MCP credential already present — left as-is");
} else {
  const cred = await client.beta.vaults.credentials.create(ids.vaultId, {
    display_name: "CRM MCP token",
    auth: { type: "static_bearer", token: mcpToken, mcp_server_url: CRM_MCP_URL },
  });
  console.log(`vault: CRM MCP credential → ${cred.id}`);
}

// 2. Agents: mcp_servers + allowlisted toolset. Tools are allowlist-style
// (default disabled, named tools enabled) so an agent can only touch the CRM
// surface its job needs; always_allow because both run unattended.
const MCP_SERVER = { type: "url" as const, name: "crm", url: CRM_MCP_URL };
const toolset = (toolNames: string[]) => ({
  type: "mcp_toolset" as const,
  mcp_server_name: "crm",
  default_config: { enabled: false },
  configs: toolNames.map((name) => ({
    name,
    enabled: true,
    permission_policy: { type: "always_allow" as const },
  })),
});

const plans = [
  {
    label: "radar",
    idKey: "radarAgentId",
    verKey: "radarAgentVersion",
    system: withCanon("radar", readFileSync("agents/opportunity-radar.system.md", "utf8")),
    tools: ["crm_add_target", "crm_list_targets"],
  },
  {
    label: "digest",
    idKey: "digestAgentId",
    verKey: "digestAgentVersion",
    system: renderVars(readFileSync("agents/weekly-digest.system.md", "utf8")), // no canon; resolve {{…}}
    // crm_send_digest sends to the server-side recipient, so the agent needs no Resend
    // key and can't be redirected by injected text in a record.
    tools: ["crm_list_targets", "crm_get_target", "crm_send_digest"],
  },
];

for (const p of plans) {
  const updated = await client.beta.agents.update(ids[p.idKey], {
    version: ids[p.verKey],
    system: p.system,
    mcp_servers: [MCP_SERVER],
    tools: [AGENT_TOOLSET, toolset(p.tools)],
  });
  console.log(`${p.label}: ${ids[p.idKey]}  v${ids[p.verKey]} → v${updated.version}  (mcp: ${p.tools.join(", ")})`);
  ids[p.verKey] = updated.version;
}

// 3. Repin the radar cron (it pins an explicit version; the digest cron tracks latest).
if (ids.deploymentId) {
  await client.beta.deployments.update(ids.deploymentId, {
    agent: { type: "agent", id: ids.radarAgentId, version: ids.radarAgentVersion },
  });
  console.log(`radar deployment repinned → v${ids.radarAgentVersion}`);
}

writeIds(ids);
console.log("\nPinned .managed-agents.json to the new versions.");
console.log("Deploy the CRM first if you haven't — the MCP tool schema changes live there.");

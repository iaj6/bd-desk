import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../crm/proxy.ts";

// proxy.ts is the CRM's only auth boundary: it guards the research budget, the
// pipeline, and the operator's whole book of business. The property that matters
// most is that every door FAILS CLOSED when its secret is unset — an unconfigured
// deploy must lock, never open.

const ENV_KEYS = ["CRON_SECRET", "MCP_TOKEN", "INGEST_TOKEN", "CRM_PASSWORD", "VERCEL", "NODE_ENV"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const req = (path: string, opts: { method?: string; auth?: string } = {}) =>
  new NextRequest(`https://crm.example${path}`, {
    method: opts.method ?? "GET",
    headers: opts.auth ? { authorization: opts.auth } : {},
  });

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

/** NextResponse.next() is the "allowed through" signal; anything else is a block. */
const allowed = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("cron door", () => {
  it("admits Vercel Cron presenting the configured secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect(allowed(await proxy(req("/api/cron/pipeline", { auth: "Bearer s3cret" })))).toBe(true);
    expect(allowed(await proxy(req("/api/cron/brief", { auth: "Bearer s3cret" })))).toBe(true);
  });

  it("rejects a wrong, absent, or near-miss secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    for (const auth of [undefined, "Bearer wrong", "Bearer s3cre", "Bearer s3crett", "s3cret", "Basic s3cret"]) {
      expect((await proxy(req("/api/cron/pipeline", { auth }))).status).toBe(401);
    }
  });

  it("fails closed when CRON_SECRET is unset — an unconfigured cron cannot fire", async () => {
    expect((await proxy(req("/api/cron/pipeline", { auth: "Bearer anything" }))).status).toBe(401);
    expect((await proxy(req("/api/cron/pipeline", { auth: "Bearer " }))).status).toBe(401);
  });

  it("does not fall through to Basic Auth", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.CRM_PASSWORD = "hunter2";
    expect((await proxy(req("/api/cron/pipeline", { auth: basic("me", "hunter2") }))).status).toBe(401);
  });
});

describe("MCP door", () => {
  it("admits the configured bearer on every MCP transport path", async () => {
    process.env.MCP_TOKEN = "mcp-tok";
    for (const p of ["/api/mcp", "/api/sse", "/api/message"]) {
      expect(allowed(await proxy(req(p, { auth: "Bearer mcp-tok" })))).toBe(true);
    }
  });

  it("rejects the wrong bearer and fails closed when MCP_TOKEN is unset", async () => {
    process.env.MCP_TOKEN = "mcp-tok";
    expect((await proxy(req("/api/mcp", { auth: "Bearer nope" }))).status).toBe(401);
    delete process.env.MCP_TOKEN;
    expect((await proxy(req("/api/mcp", { auth: "Bearer mcp-tok" }))).status).toBe(401);
  });

  it("does not accept the operator password — bearer only, by design", async () => {
    process.env.MCP_TOKEN = "mcp-tok";
    process.env.CRM_PASSWORD = "hunter2";
    expect((await proxy(req("/api/mcp", { auth: basic("me", "hunter2") }))).status).toBe(401);
  });
});

describe("ingest door (/api/targets, /api/brand-pack)", () => {
  it("admits the agents' vaulted bearer for POST", async () => {
    process.env.INGEST_TOKEN = "ingest";
    for (const p of ["/api/targets", "/api/brand-pack"]) {
      expect(allowed(await proxy(req(p, { method: "POST", auth: "Bearer ingest" })))).toBe(true);
    }
  });

  it("blocks POST without the bearer, even when the operator password is set", async () => {
    process.env.INGEST_TOKEN = "ingest";
    process.env.CRM_PASSWORD = "hunter2";
    for (const p of ["/api/targets", "/api/brand-pack"]) {
      expect((await proxy(req(p, { method: "POST", auth: basic("me", "hunter2") }))).status).toBe(401);
      expect((await proxy(req(p, { method: "POST" }))).status).toBe(401);
    }
  });

  it("fails closed on POST when INGEST_TOKEN is unset", async () => {
    process.env.CRM_PASSWORD = "hunter2";
    expect((await proxy(req("/api/targets", { method: "POST", auth: "Bearer anything" }))).status).toBe(401);
  });

  it("lets GET fall through to Basic Auth so a browser can read the pipeline", async () => {
    process.env.INGEST_TOKEN = "ingest";
    process.env.CRM_PASSWORD = "hunter2";
    expect(allowed(await proxy(req("/api/targets", { auth: basic("me", "hunter2") })))).toBe(true);
    expect(allowed(await proxy(req("/api/targets", { auth: "Bearer ingest" })))).toBe(true);
    expect((await proxy(req("/api/targets"))).status).toBe(401); // still needs one of the two
  });
});

describe("operator Basic Auth", () => {
  it("admits the configured password and rejects the wrong one", async () => {
    process.env.CRM_PASSWORD = "hunter2";
    expect(allowed(await proxy(req("/", { auth: basic("anyone", "hunter2") })))).toBe(true);
    expect((await proxy(req("/", { auth: basic("anyone", "nope") }))).status).toBe(401);
  });

  it("ignores the username and supports passwords containing a colon", async () => {
    process.env.CRM_PASSWORD = "pa:ss:word";
    expect(allowed(await proxy(req("/", { auth: basic("", "pa:ss:word") })))).toBe(true);
    expect(allowed(await proxy(req("/", { auth: basic("someone-else", "pa:ss:word") })))).toBe(true);
  });

  it("challenges with WWW-Authenticate so a browser prompts", async () => {
    process.env.CRM_PASSWORD = "hunter2";
    const res = await proxy(req("/"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Basic realm="BD Desk CRM"');
  });

  it("rejects malformed credentials without throwing", async () => {
    process.env.CRM_PASSWORD = "hunter2";
    for (const auth of ["Basic !!!not-base64!!!", "Basic ", `Basic ${Buffer.from("no-colon").toString("base64")}`]) {
      expect((await proxy(req("/", { auth }))).status).toBe(401);
    }
  });

  it("rejects an empty password even if CRM_PASSWORD were somehow empty", async () => {
    process.env.CRM_PASSWORD = "hunter2";
    expect((await proxy(req("/", { auth: basic("me", "") }))).status).toBe(401);
  });

  it("guards the export endpoint — the whole book of business in one download", async () => {
    process.env.CRM_PASSWORD = "hunter2";
    expect((await proxy(req("/api/export?format=xlsx"))).status).toBe(401);
    expect(allowed(await proxy(req("/api/export?format=xlsx", { auth: basic("me", "hunter2") })))).toBe(true);
  });
});

describe("unconfigured password", () => {
  it("stays open on a local dev server, where there is nothing to protect yet", async () => {
    expect(allowed(await proxy(req("/")))).toBe(true);
  });

  it("locks the CRM on any production host rather than silently publishing it", async () => {
    // The gate is NODE_ENV, not VERCEL — so a non-Vercel production host (Docker, Fly,
    // a VPS running `next start`) locks too, instead of failing open.
    process.env.NODE_ENV = "production";
    const res = await proxy(req("/"));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("CRM_PASSWORD");
  });

  it("locks a production host even when VERCEL is unset (the case the old check missed)", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL;
    expect((await proxy(req("/"))).status).toBe(503);
  });
});

describe("CSRF on the operator doors", () => {
  beforeEach(() => { process.env.CRM_PASSWORD = "hunter2"; });

  const withAuth = (path: string, method: string, headers: Record<string, string>) =>
    new NextRequest(`https://crm.example${path}`, {
      method,
      headers: { authorization: basic("me", "hunter2"), ...headers },
    });

  it("refuses a state-changing request from a cross-site Sec-Fetch-Site", async () => {
    const res = await proxy(withAuth("/api/targets/acme", "PATCH", { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
  });

  it("refuses a state-changing request from a foreign Origin", async () => {
    const res = await proxy(withAuth("/api/manual", "POST", { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("allows a same-origin state-changing request", async () => {
    expect(allowed(await proxy(withAuth("/api/manual", "POST", { "sec-fetch-site": "same-origin" })))).toBe(true);
    expect(allowed(await proxy(withAuth("/api/manual", "POST", { origin: "https://crm.example" })))).toBe(true);
  });

  it("allows a header-less request (curl / the operator's own tools) and never gates GET", async () => {
    expect(allowed(await proxy(withAuth("/api/manual", "POST", {})))).toBe(true);
    expect(allowed(await proxy(withAuth("/api/targets", "GET", { "sec-fetch-site": "cross-site" })))).toBe(true);
  });
});

describe("bearer confinement — a door's token opens only that door", () => {
  // All doors configured with DISTINCT secrets: the property under test is that a
  // valid token for one door is rejected at every other. A leaked ingest bearer must
  // not reach the MCP tools (paid research), the crons, the export, or the UI.
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    process.env.MCP_TOKEN = "mcp-token";
    process.env.INGEST_TOKEN = "ingest-token";
    process.env.CRM_PASSWORD = "hunter2";
  });

  it("confines the ingest bearer to /api/targets and /api/brand-pack", async () => {
    expect(allowed(await proxy(req("/api/targets", { method: "POST", auth: "Bearer ingest-token" })))).toBe(true);
    expect(allowed(await proxy(req("/api/brand-pack", { method: "POST", auth: "Bearer ingest-token" })))).toBe(true);
    // Opens nothing else — cron, MCP, export, or the UI root.
    expect((await proxy(req("/api/cron/pipeline", { auth: "Bearer ingest-token" }))).status).toBe(401);
    expect((await proxy(req("/api/mcp", { auth: "Bearer ingest-token" }))).status).toBe(401);
    expect((await proxy(req("/api/export?format=xlsx", { auth: "Bearer ingest-token" }))).status).toBe(401);
    expect((await proxy(req("/", { auth: "Bearer ingest-token" }))).status).toBe(401);
  });

  it("cannot fire paid research or a state-changing UI door with the ingest bearer", async () => {
    // /api/manual is a UI POST — CSRF + Basic only; a stray bearer is not Basic creds.
    expect((await proxy(req("/api/manual", { method: "POST", auth: "Bearer ingest-token" }))).status).toBe(401);
    expect((await proxy(req("/api/message", { method: "POST", auth: "Bearer ingest-token" }))).status).toBe(401);
  });

  it("confines the MCP bearer to the MCP transport paths", async () => {
    for (const p of ["/api/mcp", "/api/sse", "/api/message"]) {
      expect(allowed(await proxy(req(p, { auth: "Bearer mcp-token" })))).toBe(true);
    }
    expect((await proxy(req("/api/targets", { method: "POST", auth: "Bearer mcp-token" }))).status).toBe(401);
    expect((await proxy(req("/api/cron/pipeline", { auth: "Bearer mcp-token" }))).status).toBe(401);
    expect((await proxy(req("/", { auth: "Bearer mcp-token" }))).status).toBe(401);
  });

  it("confines the cron bearer to /api/cron/*", async () => {
    expect(allowed(await proxy(req("/api/cron/pipeline", { auth: "Bearer cron-secret" })))).toBe(true);
    expect((await proxy(req("/api/mcp", { auth: "Bearer cron-secret" }))).status).toBe(401);
    expect((await proxy(req("/api/targets", { method: "POST", auth: "Bearer cron-secret" }))).status).toBe(401);
    expect((await proxy(req("/", { auth: "Bearer cron-secret" }))).status).toBe(401);
  });
});

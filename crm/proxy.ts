import { NextRequest, NextResponse } from "next/server";

// Compare secrets by SHA-256 digest so the `===` timing reveals nothing about the
// expected value (edge runtime has no timingSafeEqual; hashing first is the
// standard workaround — equal-length digests, and a partial-match timing signal
// on a digest doesn't help an attacker reconstruct the secret).
async function secretMatches(presented: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(presented)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

async function bearerOk(auth: string, expected: string | undefined): Promise<boolean> {
  if (!expected || !auth.startsWith("Bearer ")) return false;
  return secretMatches(auth.slice(7), expected);
}

// Auth doors:
//  - /api/cron/*: Vercel Cron presenting `Bearer ${CRON_SECRET}`.
//  - /api/mcp|sse|message: MCP clients presenting `Bearer ${MCP_TOKEN}`.
//  - POST /api/targets, /api/brand-pack: the agents' vaulted bearer (INGEST_TOKEN).
//  - everything else (the UI + status PATCH): YOU, via HTTP Basic Auth (CRM_PASSWORD).
// Every door fails closed when its env var is unset; Basic Auth is only open
// without a password on a local dev server (never on Vercel).
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const auth = req.headers.get("authorization") ?? "";

  // Nightly pipeline crons: Vercel Cron presents `Bearer ${CRON_SECRET}` automatically.
  if (pathname.startsWith("/api/cron/")) {
    if (await bearerOk(auth, process.env.CRON_SECRET)) return NextResponse.next();
    return new NextResponse("unauthorized", { status: 401 });
  }

  // MCP endpoint for local/agent tools: bearer-only, no Basic Auth fallback.
  if (pathname === "/api/mcp" || pathname === "/api/sse" || pathname === "/api/message") {
    if (await bearerOk(auth, process.env.MCP_TOKEN)) return NextResponse.next();
    return new NextResponse("unauthorized", { status: 401 });
  }

  // Agent access to /api/targets via the vaulted bearer: POST (ingest) and GET (digest reads).
  if (pathname === "/api/targets") {
    if (await bearerOk(auth, process.env.INGEST_TOKEN)) return NextResponse.next();
    if (req.method === "POST") return new NextResponse("unauthorized", { status: 401 });
    // GET without the bearer falls through to Basic Auth (browser/curl).
  }

  // Brand-pack push from the repo's brand-pack compiler: POST via the same vaulted bearer.
  if (pathname === "/api/brand-pack") {
    if (await bearerOk(auth, process.env.INGEST_TOKEN)) return NextResponse.next();
    if (req.method === "POST") return new NextResponse("unauthorized", { status: 401 });
    // GET without the bearer falls through to Basic Auth (browser/curl).
  }

  // CSRF: a browser replays cached Basic-Auth creds on cross-site requests (SameSite
  // does not cover HTTP auth), so a page the operator visits could fire paid research or
  // overwrite drafts. Reject a state-changing request that carries a cross-site signal.
  // Absent headers (curl, the operator's own tools) are allowed; a forced cross-site
  // browser request always sends Origin or Sec-Fetch-Site. The bearer doors above are
  // exempt — they are not browser-driven.
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    const site = req.headers.get("sec-fetch-site");
    const origin = req.headers.get("origin");
    let crossSite = site !== null && site !== "same-origin" && site !== "none";
    if (origin) {
      try {
        crossSite ||= new URL(origin).origin !== req.nextUrl.origin;
      } catch {
        crossSite = true;
      }
    }
    if (crossSite) return new NextResponse("cross-site request refused", { status: 403 });
  }

  const pass = process.env.CRM_PASSWORD;
  if (!pass) {
    // No password configured: open ONLY on a dev server (`next dev` sets
    // NODE_ENV=development). Any production host — Vercel, but also Docker / Fly /
    // Railway / a VPS running `next start` — locks instead of silently publishing the
    // CRM and its research budget. (Keying on VERCEL alone missed every non-Vercel host.)
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("CRM_PASSWORD is not configured — set it in the project's env vars", {
      status: 503,
    });
  }
  if (auth.startsWith("Basic ")) {
    let pw = "";
    try {
      const decoded = atob(auth.slice(6));
      const sep = decoded.indexOf(":");
      if (sep >= 0) pw = decoded.slice(sep + 1); // username ignored; password may contain ':'
    } catch {
      // malformed base64 → fall through to 401
    }
    if (pw && (await secretMatches(pw, pass))) return NextResponse.next();
  }
  return new NextResponse("auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="BD Desk CRM"' },
  });
}

// _next/image is deliberately NOT excluded: nothing in the app imports next/image, and
// next.config.mjs sets images.unoptimized, so the optimizer endpoint is off. Routing any
// stray /_next/image request through auth costs nothing and closes the one path the
// Next image-optimization advisories touch.
export const config = { matcher: ["/((?!_next/static|favicon.ico).*)"] };

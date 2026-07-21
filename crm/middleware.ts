import { NextRequest, NextResponse } from "next/server";

// Two auth doors:
//  - POST /api/targets: the AGENT, presenting the vaulted bearer token (INGEST_TOKEN).
//  - everything else (the UI + status PATCH): YOU, via HTTP Basic Auth (CRM_PASSWORD).
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const auth = req.headers.get("authorization") ?? "";

  // Nightly pipeline crons: Vercel Cron presents `Bearer ${CRON_SECRET}` automatically.
  if (pathname.startsWith("/api/cron/")) {
    const secret = process.env.CRON_SECRET;
    if (secret && auth === `Bearer ${secret}`) return NextResponse.next();
    return new NextResponse("unauthorized", { status: 401 });
  }

  // MCP endpoint for local/agent tools: bearer-only, no Basic Auth fallback.
  if (pathname === "/api/mcp" || pathname === "/api/sse" || pathname === "/api/message") {
    const token = process.env.MCP_TOKEN;
    if (token && auth === `Bearer ${token}`) return NextResponse.next();
    return new NextResponse("unauthorized", { status: 401 });
  }

  // Agent access to /api/targets via the vaulted bearer: POST (ingest) and GET (digest reads).
  if (pathname === "/api/targets") {
    const token = process.env.INGEST_TOKEN;
    if (token && auth === `Bearer ${token}`) return NextResponse.next();
    if (req.method === "POST") return new NextResponse("unauthorized", { status: 401 });
    // GET without the bearer falls through to Basic Auth (browser/curl).
  }

  // Brand-pack push from the managed_agents compiler: POST via the same vaulted bearer.
  if (pathname === "/api/brand-pack") {
    const token = process.env.INGEST_TOKEN;
    if (token && auth === `Bearer ${token}`) return NextResponse.next();
    if (req.method === "POST") return new NextResponse("unauthorized", { status: 401 });
    // GET without the bearer falls through to Basic Auth (browser/curl).
  }

  const pass = process.env.CRM_PASSWORD;
  if (!pass) return NextResponse.next(); // unconfigured (local dev) → open
  if (auth.startsWith("Basic ")) {
    const [, pw] = atob(auth.slice(6)).split(":");
    if (pw === pass) return NextResponse.next();
  }
  return new NextResponse("auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="BD Desk CRM"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

// One failure convention for the REST routes. A tagged BadRequest becomes a 400 with
// its message; anything else (a storage outage, a bug) becomes a generic 500 that does
// not leak the internal message. Replaces three different per-route conventions.

import { NextResponse } from "next/server";

export class BadRequest extends Error {}

/** Throw a 400. */
export function badRequest(message: string): never {
  throw new BadRequest(message);
}

/** Wrap a route body so every failure maps the same way. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof BadRequest) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("route error:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

/** Parse a JSON body, mapping malformed input to a 400. */
export async function jsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    badRequest("invalid JSON");
  }
}

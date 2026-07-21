import { put, get } from "@vercel/blob";

// The brand canon, pushed here by the brand-pack compiler in the agents repo
// (`npm run brand-pack`, sourced from brand/brand-pack.yaml). The outreach drafter
// reads it so its voice/proof/positioning never drift from canon.
// Stored as a single private blob; refreshing it needs no redeploy.
const KEY = "brand/pack.json";
const TTL_MS = 5 * 60 * 1000;

export interface BrandPack {
  version: number;
  source: string;
  identity?: { name: string; abbr: string; founder: string };
  blocks: Record<string, string>; // outreach | dossier | radar | sponsor
}

let cache: { pack: BrandPack; at: number } | null = null;

// Read the current pack (5-min in-process cache). Returns the last-known pack if a
// transient read fails, or null if we've never successfully read one.
export async function getBrandPack(): Promise<BrandPack | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.pack;
  try {
    const r = await get(KEY, { access: "private" });
    if (!r || r.statusCode !== 200) return cache?.pack ?? null;
    const pack = JSON.parse(await new Response(r.stream).text()) as BrandPack;
    cache = { pack, at: Date.now() };
    return pack;
  } catch {
    return cache?.pack ?? null; // BlobNotFound / transient → fall back to cache
  }
}

export async function putBrandPack(pack: BrandPack): Promise<void> {
  await put(KEY, JSON.stringify(pack), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
  });
  cache = { pack, at: Date.now() }; // refresh cache immediately on write
}

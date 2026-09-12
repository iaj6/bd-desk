// The pure half of the brand-pack compiler: the spine types, validation, the markdown
// slice renderers, and pack assembly. Extracted from brand-pack.ts — which reads YAML,
// writes agents/_canon.json, POSTs to the CRM and calls process.exit at import — so this
// logic (the part worth getting right) can be unit tested and reused without side effects.

// ---------- types (mirror brand-pack.yaml) ----------
export interface Differentiator { name: string; claim: string }
export interface ProofStory { id: string; headline: string; detail: string; proves?: string[] }
export interface Persona { name: string; role?: string; owns?: string; authority?: string; lead_with?: string }
export interface Spine {
  version: number;
  identity: {
    name: string; abbr: string; founder: string;
    one_liner_public: string; one_liner_vertical: string;
    what_we_are: string; offer: string;
  };
  positioning: { differentiators: Differentiator[]; sponsor_play: string };
  voice: { summary: string; words_we_use: string[]; never_use: string[] };
  proof_stories: ProofStory[];
  icp: {
    summary: string; green_signals: string[]; red_flags: string[];
    personas: Persona[]; targeting_strategy: string;
  };
}

export interface BrandPack {
  version: number;
  source: string;
  identity: { name: string; abbr: string; founder: string };
  never_use: string;
  blocks: { outreach: string; dossier: string; radar: string; sponsor: string };
}

// ---------- slice renderers (markdown) ----------
const bullets = (items: string[]) => items.map((s) => `- ${s.trim()}`).join("\n");

function rIdentity(s: Spine, full: boolean): string {
  const id = s.identity;
  const lines = [`**${id.name} (${id.abbr})** — ${id.what_we_are.trim()}`, "", id.offer.trim()];
  if (full) lines.push("", `One-liner (vertical): ${id.one_liner_vertical.trim()}`);
  return lines.join("\n");
}

function rDifferentiators(s: Spine): string {
  return [
    "## Differentiators (all true — use them, don't invent new ones)",
    s.positioning.differentiators.map((d) => `- **${d.name}** — ${d.claim.trim()}`).join("\n"),
  ].join("\n");
}

function rSponsorPlay(s: Spine): string {
  return `## Sponsor play (writing to a PE operating partner, not a single portco)\n${s.positioning.sponsor_play.trim()}`;
}

function rProof(s: Spine, full: boolean): string {
  const p = s.proof_stories[0];
  if (!full) return `## Proof\n${p.headline.trim()} ${p.detail.trim()}`;
  return [
    "## Proof (real, delivered — lead with it)",
    s.proof_stories
      .map((st) => `- **${st.headline.trim()}** ${st.detail.trim()}`)
      .join("\n"),
  ].join("\n");
}

function rVoice(s: Spine, full: boolean): string {
  const v = s.voice;
  const out = ["## Voice", v.summary.trim(), "", `**NEVER use:** ${v.never_use.join("; ")}.`];
  if (full) out.push("", `**Words we reach for:** ${v.words_we_use.join("; ")}.`);
  return out.join("\n");
}

function rICP(s: Spine, opts: { targeting?: boolean } = {}): string {
  const icp = s.icp;
  const out = [
    "## Ideal client profile — score fit against THIS",
    icp.summary.trim(),
    "",
    "**GREEN signals (raise fit):**",
    bullets(icp.green_signals),
    "",
    "**RED flags (lower fit / lean skip):**",
    bullets(icp.red_flags),
  ];
  if (opts.targeting) out.push("", "**Targeting strategy:**", icp.targeting_strategy.trim());
  return out.join("\n");
}

function rPersonas(s: Spine): string {
  const rows = s.icp.personas.map((p) => {
    const parts = [`- **${p.name}**`];
    if (p.role) parts.push(p.role.trim());
    if (p.owns) parts.push(`Owns: ${p.owns.trim()}`);
    if (p.authority) parts.push(`Authority: ${p.authority.trim()}`);
    if (p.lead_with) parts.push(`Lead with: ${p.lead_with.trim()}`);
    return parts.join(" ");
  });
  return ["## The buyers (identify the entry point)", rows.join("\n")].join("\n");
}

const wrap = (s: Spine, body: string) =>
  [
    "<!-- BEGIN BRAND CANON — generated from brand/brand-pack.yaml; do not edit here. -->",
    `# ${s.identity.name} — brand canon (authoritative)`,
    "",
    body,
    "<!-- END BRAND CANON -->",
  ].join("\n");

// ---------- per-consumer composition ----------
// Each consumer gets only the slices it needs — keeps prompts tight and on-message.
export function compose(s: Spine): BrandPack["blocks"] {
  const outreach = wrap(
    s,
    [rIdentity(s, true), rDifferentiators(s), rSponsorPlay(s), rProof(s, true), rPersonas(s), rVoice(s, true)].join("\n\n"),
  );
  const dossier = wrap(
    s,
    [rIdentity(s, true), rDifferentiators(s), rProof(s, true), rICP(s), rPersonas(s), rVoice(s, true)].join("\n\n"),
  );
  const radar = wrap(
    s,
    [rIdentity(s, false), rICP(s, { targeting: true }), rProof(s, false), rVoice(s, false)].join("\n\n"),
  );
  const sponsor = wrap(
    s,
    [rIdentity(s, false), rICP(s), rProof(s, false), rVoice(s, false)].join("\n\n"),
  );
  return { outreach, dossier, radar, sponsor };
}

// ---------- validation ----------
// The `as Spine` cast buys nothing at runtime, and the renderers dereference deeply
// (proof_stories[0], icp.personas.map, …). Without this, trimming a section you don't
// have yet crashes with an unnamed TypeError pointing into a renderer — at the first
// setup step after the demo. Report EVERY missing/empty field at once instead.
export function validateSpine(s: unknown): string[] {
  if (!s || typeof s !== "object") return ["(the file is empty or not valid YAML)"];
  const spine = s as Record<string, any>;
  const errs: string[] = [];
  const str = (path: string, v: unknown) => { if (typeof v !== "string" || !v.trim()) errs.push(path); };
  const arr = (path: string, v: unknown) => { if (!Array.isArray(v) || v.length === 0) errs.push(path); };

  const id = spine.identity ?? {};
  str("identity.name", id.name);
  str("identity.abbr", id.abbr);
  str("identity.founder", id.founder);
  str("identity.what_we_are", id.what_we_are);
  str("identity.offer", id.offer);
  str("identity.one_liner_vertical", id.one_liner_vertical);

  arr("positioning.differentiators", spine.positioning?.differentiators);
  str("positioning.sponsor_play", spine.positioning?.sponsor_play);

  const v = spine.voice ?? {};
  str("voice.summary", v.summary);
  arr("voice.never_use", v.never_use);
  arr("voice.words_we_use", v.words_we_use);

  arr("proof_stories", spine.proof_stories);

  const icp = spine.icp ?? {};
  str("icp.summary", icp.summary);
  arr("icp.green_signals", icp.green_signals);
  arr("icp.red_flags", icp.red_flags);
  arr("icp.personas", icp.personas);
  str("icp.targeting_strategy", icp.targeting_strategy);

  return errs;
}

// ---------- pack assembly ----------
// The compiled artifact both consumers read: agents/_canon.json (via `npm run update`)
// and the CRM /api/brand-pack push. Assumes a spine that already passed validateSpine.
export function buildPack(s: Spine): BrandPack {
  return {
    version: s.version,
    source: "brand/brand-pack.yaml",
    // Identity travels with the pack so the CRM can sign outreach and address email
    // without a second config surface.
    identity: {
      name: s.identity.name,
      abbr: s.identity.abbr,
      founder: s.identity.founder,
    },
    // The NEVER-use word list travels with the pack so the digest prompt (which gets no
    // canon block) can render it via {{NEVER_USE}} instead of hardcoding the words.
    never_use: s.voice.never_use.map((w) => w.trim()).join("; "),
    blocks: compose(s),
  };
}

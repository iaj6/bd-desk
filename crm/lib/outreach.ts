import Anthropic from "@anthropic-ai/sdk";
import { readOneBySlug, patchTarget, listTargets, type Target } from "./store";
import { primarySponsor } from "./deliverable";
import { getBrandPack } from "./brand";
import { isDemo } from "./storage";
import { demoOutreach } from "./demo";

export type Channel = "email" | "linkedin";

// Minimal safety net if the brand pack has never been pushed to Blob. The real canon
// (identity, differentiators, proof, voice, personas) is authored in
// brand/brand-pack.yaml and delivered via `npm run brand-pack`.
const FALLBACK_CANON = `A boutique consultancy (brand canon has not been pushed yet — run \`npm run brand-pack\` in the agents repo before trusting any draft).
Voice: practitioner-first, direct, anti-hype. NEVER use: "leverage", "transform"/"transformative", "synergy"/"seamless", "cutting-edge"/"revolutionize"/"game-changing", "end-to-end automation".`;

const sponsorKey = (s?: string) => primarySponsor(s).toLowerCase();

function systemFor(
  channel: string,
  sponsorContact: boolean,
  canon: string,
  identity: { name: string; founder: string },
) {
  const audience = sponsorContact
    ? `The recipient is a PARTNER at the PE sponsor that owns the portfolio listed below — NOT a portco buyer.
Do not pitch a single-company solution. Follow the SPONSOR PLAY in the canon above: pitch the repeatable
pattern across their portfolio, and cite 1–2 of THEIR OWN portcos by name (from the portfolio list) as proof
you know the book. Lead with the pattern and the proof account.`
    : `Ground the message in the specific researched trigger; lead with a real fact, not flattery.`;

  if (channel === "linkedin") {
    return `${canon}\n\nWrite a LinkedIn first-touch to the named contact — treat it as a connection-request note to someone not yet connected. ${audience}
- HARD LIMIT ~300 characters (LinkedIn connection notes cap there). Short, human, specific — one concrete hook, a soft ask ("worth comparing notes?" / "open to a quick chat?").
- Address them by first name. No subject line, no email sign-off block, no links.
- Follow the brand voice and the NEVER-use word list in the canon above.
- Output ONLY the note text, nothing else.`;
  }
  return `${canon}\n\nWrite a single cold outreach email from ${identity.founder} to the named contact. ${audience}
- ~90–130 words, plain text. Follow the brand voice and the NEVER-use word list in the canon above.
- End with this exact sign-off, each on its own line: ${identity.founder} / Founder, ${identity.name}.
- Output a "Subject: …" line, a blank line, then the body ending in the sign-off. Nothing else.`;
}

// Draft a first-touch email or LinkedIn note for a target, persist it, and return the text.
// Returns null if the slug doesn't exist. Shared by the HTTP route and the MCP tool.
export async function draftOutreach(
  slug: string,
  channel: Channel,
  all?: Target[], // the pipeline passes the list it already loaded, to avoid re-reading every blob per draft
): Promise<{ channel: Channel; text: string } | null> {
  const t = await readOneBySlug(slug);
  if (!t) return null;

  // Demo mode: canned draft, no model call. See lib/demo.ts.
  if (isDemo()) {
    const text = demoOutreach(t, channel);
    await patchTarget(slug, channel === "linkedin" ? { linkedin_note: text } : { outreach: text });
    return { channel, text };
  }

  const isContact = t.kind === "contact";

  // If this contact's org has portcos in our CRM, treat it as a sponsor/operating-partner
  // play and cite the portfolio. Otherwise it's a normal named-contact note.
  let cluster: Target[] = [];
  if (isContact && t.sponsor) {
    const list = all ?? (await listTargets());
    cluster = list.filter(
      (x) => x.slug !== t.slug && x.kind !== "contact" && sponsorKey(x.sponsor) === sponsorKey(t.sponsor),
    );
  }
  const sponsorContact = cluster.length > 0;

  const card = [
    isContact ? `Contact: ${t.contact_name}${t.contact_title ? `, ${t.contact_title}` : ""}` : `Company: ${t.company}`,
    isContact ? `Organization: ${t.company}` : null,
    t.sponsor && `PE sponsor: ${t.sponsor}`,
    t.hq && `HQ: ${t.hq}`,
    t.vertical && `Vertical: ${t.vertical}`,
    t.fit && `Fit: ${t.fit}`,
    t.why_now && `Why now: ${t.why_now}`,
    !isContact && t.entry_persona && `Likely buyer: ${t.entry_persona}`,
    t.notes && `Notes: ${t.notes}`,
  ]
    .filter(Boolean)
    .join("\n");

  let context = `Target card:\n${card}`;
  if (cluster.length) {
    context += `\n\n--- ${t.sponsor}'s portfolio in our CRM (cite 1–2 by name as proof) ---\n${cluster
      .map((c) => `${c.company}${c.fit ? ` (${c.fit})` : ""}${c.hq ? ` — ${c.hq}` : ""}`)
      .join("\n")}`;
  }
  if (t.people?.length && !isContact) {
    context += `\n\n--- Key contacts ---\n${t.people
      .map((p) => `${p.name}${p.title ? ` — ${p.title}` : ""}${p.persona ? ` (${p.persona})` : ""}`)
      .join("\n")}`;
  }
  if (t.dossier) context += `\n\n--- Researched dossier ---\n${t.dossier}`;

  const pack = await getBrandPack();
  const canon = pack?.blocks?.outreach ?? FALLBACK_CANON;
  const identity = pack?.identity ?? { name: "the consultancy", founder: "the founder" };

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 900,
    system: systemFor(channel, sponsorContact, canon, identity),
    messages: [{ role: "user", content: `${context}\n\nWrite the ${channel === "linkedin" ? "LinkedIn note" : "email"}.` }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  await patchTarget(slug, channel === "linkedin" ? { linkedin_note: text } : { outreach: text });
  return { channel, text };
}

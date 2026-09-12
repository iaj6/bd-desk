import { describe, it, expect } from "vitest";
import { validateSpine, buildPack, compose, type Spine } from "../src/brand-canon.ts";

// The brand-pack compiler is the one place the canon flows into every consumer, so two
// properties matter: it reports EVERY missing spine field at once (so setup isn't a
// game of fix-one-crash-find-the-next), and each consumer block carries exactly the
// slices it should — the sponsor play reaches outreach and nowhere else.

const spine: Spine = {
  version: 3,
  identity: {
    name: "Ridgeline Data Co.", abbr: "RDC", founder: "Alex Rivera",
    one_liner_public: "AI + data for regulated manufacturers",
    one_liner_vertical: "the data layer for food & bev",
    what_we_are: "a solo AI + operational-data consultancy",
    offer: "we build the data layer inside your own cloud",
  },
  positioning: {
    differentiators: [{ name: "Own cloud", claim: "runs inside your account" }],
    sponsor_play: "Pitch the repeatable pattern across the portfolio, not one portco.",
  },
  voice: {
    summary: "practitioner-first, direct, anti-hype",
    words_we_use: ["lot-level", "audit binder"],
    never_use: ["leverage", "synergy"],
  },
  proof_stories: [{ id: "p1", headline: "Survived an SQF cycle", detail: "shipped for a PE-owned co-packer." }],
  icp: {
    summary: "regulated food & beverage manufacturers",
    green_signals: ["PE-owned", "SQF certified"],
    red_flags: ["ERP rollout still in flight"],
    personas: [{ name: "VP Operations", role: "plant leader", owns: "the yield number" }],
    targeting_strategy: "start at the portco whose audit date is closest",
  },
};

describe("validateSpine", () => {
  it("passes a complete spine", () => {
    expect(validateSpine(spine)).toEqual([]);
  });

  it("returns a single sentinel for empty / non-object input", () => {
    expect(validateSpine(null)).toEqual(["(the file is empty or not valid YAML)"]);
    expect(validateSpine("nope")).toEqual(["(the file is empty or not valid YAML)"]);
  });

  it("reports every missing or empty field at once, not just the first", () => {
    const broken = {
      ...spine,
      positioning: { differentiators: [], sponsor_play: "  " },
      voice: { ...spine.voice, never_use: [] },
      icp: { ...spine.icp, green_signals: [] },
    };
    const errs = validateSpine(broken);
    expect(errs).toContain("positioning.differentiators");
    expect(errs).toContain("positioning.sponsor_play");
    expect(errs).toContain("voice.never_use");
    expect(errs).toContain("icp.green_signals");
    expect(errs.length).toBeGreaterThanOrEqual(4);
  });

  it("names the newly-required sponsor_play field when it is missing", () => {
    const noPlay = { ...spine, positioning: { differentiators: spine.positioning.differentiators, sponsor_play: "" } };
    expect(validateSpine(noPlay)).toEqual(["positioning.sponsor_play"]);
  });
});

describe("buildPack", () => {
  it("assembles the compiled artifact both consumers read", () => {
    const pack = buildPack(spine);
    expect(pack.version).toBe(3);
    expect(pack.source).toBe("brand/brand-pack.yaml");
    expect(pack.identity).toEqual({ name: "Ridgeline Data Co.", abbr: "RDC", founder: "Alex Rivera" });
    expect(pack.never_use).toBe("leverage; synergy");
    expect(Object.keys(pack.blocks)).toEqual(["outreach", "dossier", "radar", "sponsor"]);
  });

  it("trims each never-use word when flattening it for {{NEVER_USE}}", () => {
    const spaced = { ...spine, voice: { ...spine.voice, never_use: ["  leverage ", "synergy  "] } };
    expect(buildPack(spaced).never_use).toBe("leverage; synergy");
  });
});

describe("compose — per-consumer slices", () => {
  const b = compose(spine);

  it("wraps every block in the canon markers and titles it by identity", () => {
    for (const block of Object.values(b)) {
      expect(block).toContain("<!-- BEGIN BRAND CANON");
      expect(block).toContain("<!-- END BRAND CANON -->");
      expect(block).toContain("Ridgeline Data Co. — brand canon (authoritative)");
    }
  });

  it("puts the sponsor play in outreach and nowhere else", () => {
    expect(b.outreach).toContain("Pitch the repeatable pattern across the portfolio");
    expect(b.dossier).not.toContain("Pitch the repeatable pattern");
    expect(b.radar).not.toContain("Pitch the repeatable pattern");
    expect(b.sponsor).not.toContain("Pitch the repeatable pattern");
  });

  it("renders the NEVER-use list into the voiced blocks", () => {
    expect(b.outreach).toContain("**NEVER use:** leverage; synergy.");
  });

  it("includes the targeting strategy only in the radar block", () => {
    expect(b.radar).toContain("Targeting strategy");
    expect(b.dossier).not.toContain("Targeting strategy");
    expect(b.sponsor).not.toContain("Targeting strategy");
  });

  it("scores fit against the ICP green signals in the dossier", () => {
    expect(b.dossier).toContain("PE-owned");
    expect(b.dossier).toContain("SQF certified");
  });
});

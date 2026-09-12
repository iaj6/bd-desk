import { describe, it, expect } from "vitest";
import { NEVER_WORDS, parseTagged, runChecks, scoreTask, type EvalTask } from "../src/eval-score.ts";

// The deterministic half of the eval suite grades a deliverable with no model call, and
// its score is what `--baseline` pins and every prompt change is measured against. If a
// check silently flips, a regression reads as an improvement — so these are pinned here.

describe("NEVER_WORDS", () => {
  it("flags the unambiguous marketing tells", () => {
    for (const w of ["synergy", "seamlessly", "cutting-edge", "game-changing", "revolutionize",
      "transformative", "best-in-class", "world-class", "enterprise-grade", "AI-powered"]) {
      expect(NEVER_WORDS.test(`the ${w} solution`)).toBe(true);
    }
  });

  it("deliberately ignores words that false-positive on legitimate use", () => {
    // These are on the canon's list but excluded from the substring check — the LLM
    // grader judges them in context instead.
    for (const w of ["leverage", "unlock", "journey", "empower"]) {
      expect(NEVER_WORDS.test(`we ${w} the data`)).toBe(false);
    }
  });
});

describe("parseTagged", () => {
  it("extracts a JSON array from a machine block", () => {
    expect(parseTagged('lead\n<people>[{"name":"Dana"}]</people>\ntail', "people")).toEqual([{ name: "Dana" }]);
  });

  it("strips a ```json fence inside the block", () => {
    expect(parseTagged('<portcos>```json\n[{"company":"X"}]\n```</portcos>', "portcos")).toEqual([{ company: "X" }]);
  });

  it("returns null when the block is absent, malformed, or not an array", () => {
    expect(parseTagged("no block here", "people")).toBeNull();
    expect(parseTagged("<people>not json</people>", "people")).toBeNull();
    expect(parseTagged('<people>{"name":"A"}</people>', "people")).toBeNull(); // object, not array
  });
});

const DOSSIER: EvalTask = { id: "t", agent: "dossier", prompt: "x", expect: { fit: "Strong" } };
const goodDossier =
  "# Pre-Engagement Dossier — Acme\n\n**Strong.** Clear angle.\n" +
  '<people>[{"name":"Dana","linkedin":"https://www.linkedin.com/in/dana"}]</people>\n' +
  "sources: https://a.example https://b.example https://c.example";

describe("runChecks — dossier", () => {
  it("passes every deterministic check on a well-formed dossier", () => {
    expect(runChecks(DOSSIER, goodDossier)).toEqual({
      has_headings: true,
      people_parses: true,
      linkedin_real: true,
      sources_cited: true,
      never_words_absent: true,
      fit_is_strong: true,
    });
  });

  it("fails the right checks on a malformed one", () => {
    const bad =
      "No heading. A synergy-first pitch.\none link https://only.example\n" +
      '<people>[{"name":"Dana","linkedin":"http://twitter.example/dana"}]</people>';
    const c = runChecks({ id: "t", agent: "dossier", prompt: "x" }, bad); // no expect.fit
    expect(c.has_headings).toBe(false);
    expect(c.never_words_absent).toBe(false); // "synergy"
    expect(c.linkedin_real).toBe(false); // not a linkedin.com/in/ url
    expect(c.sources_cited).toBe(false); // fewer than 3 distinct urls
    expect(c.people_parses).toBe(true);
    expect("fit_is_strong" in c).toBe(false); // no fit check without expect.fit
  });
});

describe("runChecks — sponsor", () => {
  const base = "# Sponsor Profile — Fund\n\n" + goodDossier.slice(goodDossier.indexOf("<people>"));
  it("accepts portcos rated Strong / Worth a look", () => {
    const text = base + '\n<portcos>[{"company":"X","fit":"Strong"},{"company":"Y","fit":"Worth a look"}]</portcos>';
    expect(runChecks({ id: "s", agent: "sponsor", prompt: "x" }, text).portcos_parses).toBe(true);
  });

  it("rejects a portco block that carries a Skip or a nameless entry", () => {
    const skip = base + '\n<portcos>[{"company":"X","fit":"Skip"}]</portcos>';
    const nameless = base + '\n<portcos>[{"fit":"Strong"}]</portcos>';
    expect(runChecks({ id: "s", agent: "sponsor", prompt: "x" }, skip).portcos_parses).toBe(false);
    expect(runChecks({ id: "s", agent: "sponsor", prompt: "x" }, nameless).portcos_parses).toBe(false);
  });
});

describe("scoreTask", () => {
  it("averages the verdict score with the deterministic pass ratio", () => {
    expect(scoreTask("satisfied", { a: true, b: true })).toBe(1); // (1 + 1) / 2
    expect(scoreTask("satisfied", { a: true, b: false })).toBe(0.75); // (1 + 0.5) / 2
    expect(scoreTask("max_iterations_reached", { a: true, b: true })).toBe(0.75); // (0.5 + 1) / 2
    expect(scoreTask("failed", { a: false, b: false })).toBe(0);
    expect(scoreTask("timeout", {})).toBe(0);
    expect(scoreTask("satisfied", {})).toBe(0.5); // no checks → verdict alone
  });
});

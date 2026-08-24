import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderVars } from "../src/canon.ts";

// renderVars substitutes {{VARS}} into a system prompt at push time. The behaviour
// that matters is the failure mode: an unresolved variable must stop the push, not
// ship a prompt with a literal "{{CRM_URL}}" in it to a live agent.

const KEYS = ["CRM_URL", "DIGEST_TO", "EMAIL_FROM"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    process.env[k] = `value-of-${k}`;
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("renderVars", () => {
  it("leaves a prompt with no variables untouched", () => {
    const md = "# Agent\n\nYou research companies.\n";
    expect(renderVars(md)).toBe(md);
  });

  it("substitutes delivery config from the environment", () => {
    expect(renderVars("Post to {{CRM_URL}} and email {{DIGEST_TO}} from {{EMAIL_FROM}}.")).toBe(
      "Post to value-of-CRM_URL and email value-of-DIGEST_TO from value-of-EMAIL_FROM.",
    );
  });

  it("substitutes every occurrence, not just the first", () => {
    expect(renderVars("{{CRM_URL}}/api/mcp and {{CRM_URL}}/api/targets")).toBe(
      "value-of-CRM_URL/api/mcp and value-of-CRM_URL/api/targets",
    );
  });

  it("refuses to push a prompt containing an unknown variable", () => {
    expect(() => renderVars("Ping {{NOT_A_REAL_VAR}} now")).toThrow("Unresolved {{NOT_A_REAL_VAR}}");
  });

  it("refuses when a known variable is unset, rather than emitting an empty string", () => {
    // A silently-empty CRM_URL would deploy an agent that posts nowhere.
    delete process.env.CRM_URL;
    expect(() => renderVars("Post to {{CRM_URL}}")).toThrow("Unresolved {{CRM_URL}}");
  });

  it("ignores single braces and malformed markers", () => {
    const md = "Use {CRM_URL} or {{ CRM_URL }} verbatim.";
    expect(renderVars(md)).toBe(md);
  });
});

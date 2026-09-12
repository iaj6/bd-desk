// The deterministic half of the eval suite: the machine-readable checks and the scoring
// formula that grade a research deliverable without a model call. Extracted from eval.ts
// — which runs live graded sessions and calls process.exit at import — so this logic can
// be unit tested directly. These are the rules a prompt change is measured against.

export interface EvalTask {
  id: string;
  agent: "dossier" | "sponsor";
  prompt: string;
  expect?: { fit?: string };
}

// Conservative subset of the canon's NEVER-use list — only words that are unambiguous
// as substrings (skips "leverage"/"unlock"/"journey" etc., which false-positive on
// legitimate uses; the LLM grader judges voice holistically).
export const NEVER_WORDS =
  /\b(synerg\w*|seamless\w*|cutting-edge|game-chang\w*|revolutioni\w*|transformative|best-in-class|world-class|enterprise-grade|ai-powered)\b/i;

export function parseTagged(text: string, tag: string): unknown[] | null {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return null;
  try {
    const arr = JSON.parse(m[1].replace(/```json|```/g, "").trim());
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

export function runChecks(task: EvalTask, text: string): Record<string, boolean> {
  const people = parseTagged(text, "people");
  const checks: Record<string, boolean> = {
    has_headings: /^#\s/m.test(text),
    people_parses: !!people && people.every((p: any) => p && typeof p.name === "string"),
    linkedin_real: !(people ?? []).some(
      (p: any) => p?.linkedin && !/^https:\/\/(www\.)?linkedin\.com\/in\//.test(p.linkedin),
    ),
    sources_cited: new Set(text.match(/https?:\/\/[^\s)"'\]>]+/g) ?? []).size >= 3,
    never_words_absent: !NEVER_WORDS.test(text),
  };
  if (task.agent === "sponsor") {
    const portcos = parseTagged(text, "portcos");
    checks.portcos_parses =
      !!portcos &&
      portcos.every(
        (p: any) =>
          p && typeof p.company === "string" && ["Strong", "Worth a look"].includes(p.fit),
      );
  }
  if (task.expect?.fit) {
    // The fit score leads the dossier — look for the expected value near the top.
    checks[`fit_is_${task.expect.fit.toLowerCase().replace(/\s+/g, "_")}`] = text
      .slice(0, 800)
      .includes(task.expect.fit);
  }
  return checks;
}

// Combine the grader verdict and the deterministic checks into a [0,1] score — the same
// number the scorecard prints and `--baseline` pins. A "satisfied" verdict is worth 1,
// "max_iterations_reached" a partial 0.5, anything else 0; averaged with the pass ratio.
export function scoreTask(verdict: string, checks: Record<string, boolean>): number {
  const names = Object.keys(checks);
  const checkRatio = names.length ? names.filter((k) => checks[k]).length / names.length : 0;
  const verdictScore = verdict === "satisfied" ? 1 : verdict === "max_iterations_reached" ? 0.5 : 0;
  return (verdictScore + checkRatio) / 2;
}

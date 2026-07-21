// Offline eval suite — runs the side-effect-free agents (dossier, sponsor) over
// evals/tasks.json and grades each run two ways:
//   1. the platform grader — the same user.define_outcome rubric production uses
//   2. deterministic checks — machine blocks parse, sources cited, NEVER-words
//      absent, expected fit score
//
//   npm run eval                        # run all tasks, compare vs pinned baseline
//   npm run eval -- --baseline          # pin this run as the baseline
//   npm run eval -- dossier-known-red   # run only the named task ids
//
// Deltas always compare against the PINNED baseline (evals/baseline.json), never
// the previous run — after a prompt change you see movement vs your starting
// point, not run-to-run noise. Each task is a full opus research session
// (several minutes, real tokens): run this after prompt/canon changes, not in a
// loop.

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { defineOutcome } from "./rubrics.ts";
import { fetchDeliverable } from "./outputs.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

interface Task {
  id: string;
  agent: "dossier" | "sponsor";
  prompt: string;
  expect?: { fit?: string };
}

interface TaskResult {
  id: string;
  verdict: string; // satisfied | max_iterations_reached | failed | interrupted | terminated | timeout
  explanation: string;
  checks: Record<string, boolean>;
  score: number; // (verdict score + deterministic pass ratio) / 2, in [0,1]
}

const IDS = ".managed-agents.json";
if (!existsSync(IDS)) {
  console.error("No .managed-agents.json — run `npm run setup` first.");
  process.exit(1);
}
const ids = JSON.parse(readFileSync(IDS, "utf8"));

const args = process.argv.slice(2);
const pinBaseline = args.includes("--baseline");
const onlyIds = args.filter((a: string) => !a.startsWith("--"));

const { tasks } = JSON.parse(readFileSync("evals/tasks.json", "utf8")) as { tasks: Task[] };
const placeholders = tasks.filter((t) => /<[a-z][^>]*>/i.test(t.prompt));
if (placeholders.length) {
  console.error(
    `evals/tasks.json still has <placeholder> prompts (${placeholders.map((t) => t.id).join(", ")}) — ` +
      "fill them with real companies from YOUR ICP first.",
  );
  process.exit(1);
}
const selected = onlyIds.length ? tasks.filter((t) => onlyIds.includes(t.id)) : tasks;
if (!selected.length) {
  console.error(`No tasks matched ${onlyIds.join(", ")} — see evals/tasks.json.`);
  process.exit(1);
}

const AGENT_ID: Record<Task["agent"], string | undefined> = {
  dossier: ids.agentId,
  sponsor: ids.sponsorAgentId,
};

const client = new Anthropic();
const TASK_TIMEOUT_MS = 25 * 60_000; // checked on event arrival — sessions emit spans steadily

// ── deterministic checks ──────────────────────────────────────────────────
// Conservative subset of the canon's NEVER-use list — only words that are
// unambiguous as substrings (skips "leverage"/"unlock"/"journey" etc., which
// false-positive on legitimate uses; the LLM grader judges voice holistically).
const NEVER_WORDS =
  /\b(synerg\w*|seamless\w*|cutting-edge|game-chang\w*|revolutioni\w*|transformative|best-in-class|world-class|enterprise-grade|ai-powered)\b/i;

function parseTagged(text: string, tag: string): unknown[] | null {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return null;
  try {
    const arr = JSON.parse(m[1].replace(/```json|```/g, "").trim());
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function runChecks(task: Task, text: string): Record<string, boolean> {
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

// ── one graded session per task ───────────────────────────────────────────
// The live stream is progress only — it DROPS whenever the session is
// rescheduled (e.g. model-overload retries), so the server is the authority:
// after the stream ends we poll the session to a terminal state, then rebuild
// the deliverable from events.list and the verdict from outcome_evaluations.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runTask(task: Task): Promise<TaskResult> {
  const agentId = AGENT_ID[task.agent];
  if (!agentId) {
    console.log(`  ${task.id}: ${task.agent} agent not provisioned — skipped`);
    return { id: task.id, verdict: "skipped", explanation: "agent not provisioned", checks: {}, score: 0 };
  }

  const session = await client.beta.sessions.create({
    agent: agentId, // latest version — evals grade what production would run
    environment_id: ids.environmentId,
    title: `EVAL ${task.id}`,
  });
  console.log(`  ${task.id} → ${session.id}`);

  const stream = await client.beta.sessions.events.stream(session.id);
  await client.beta.sessions.events.send(session.id, {
    events: [defineOutcome(task.agent, task.prompt)],
  });

  // A graded session idles TRANSIENTLY around evaluation cycles — "done" is
  // terminated, or idle with every outcome evaluation in a terminal state.
  const TERMINAL_OUTCOME = new Set(["satisfied", "max_iterations_reached", "failed", "interrupted"]);
  const isDone = (s: { status: string; outcome_evaluations?: Array<{ result: string }> }) =>
    s.status === "terminated" ||
    (s.status === "idle" && (s.outcome_evaluations ?? []).every((o) => TERMINAL_OUTCOME.has(o.result)));

  const deadline = Date.now() + TASK_TIMEOUT_MS;
  let sawTerminalVerdict = false;
  try {
    for await (const event of stream) {
      if (Date.now() > deadline) break;
      if (event.type === "span.outcome_evaluation_end" && TERMINAL_OUTCOME.has(event.result)) sawTerminalVerdict = true;
      if (event.type === "session.status_terminated") break;
      if (
        event.type === "session.status_idle" &&
        (event as any).stop_reason?.type !== "requires_action" &&
        sawTerminalVerdict
      )
        break;
    }
  } catch {
    /* stream dropped mid-run — the poll below picks up */
  }

  let final = await client.beta.sessions.retrieve(session.id);
  while (!isDone(final) && Date.now() < deadline) {
    await sleep(15_000);
    final = await client.beta.sessions.retrieve(session.id);
  }

  // The deliverable lives in the session's output file (Files API); fall back to
  // rebuilding from the message log for runs that predate the file contract.
  let text = (await fetchDeliverable(client, session.id)) ?? "";
  if (!text) {
    for await (const event of client.beta.sessions.events.list(session.id, { limit: 100 })) {
      if (event.type === "agent.message") {
        for (const block of event.content) if (block.type === "text") text += block.text;
      }
    }
  }

  const graded = (final.outcome_evaluations ?? []).filter((o) => o.completed_at).pop();
  const verdict = graded?.result ?? (final.status === "idle" || final.status === "terminated" ? "ungraded" : "timeout");
  const explanation = graded?.explanation ?? `session ended ${final.status} without an evaluation verdict`;

  const checks = runChecks(task, text);
  const names = Object.keys(checks);
  const checkRatio = names.length ? names.filter((k) => checks[k]).length / names.length : 0;
  const verdictScore = verdict === "satisfied" ? 1 : verdict === "max_iterations_reached" ? 0.5 : 0;
  return { id: task.id, verdict, explanation, checks, score: (verdictScore + checkRatio) / 2 };
}

// ── run (small worker pool — each task is a full research session) ────────
console.log(`Running ${selected.length} eval task(s), 2 at a time…\n`);
const queue = [...selected];
const results: TaskResult[] = [];
await Promise.all(
  Array.from({ length: Math.min(2, queue.length) }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      try {
        results.push(await runTask(t));
      } catch (e) {
        console.error(`  ${t.id} errored:`, e instanceof Error ? e.message : e);
        results.push({ id: t.id, verdict: "error", explanation: String(e), checks: {}, score: 0 });
      }
    }
  }),
);
results.sort((a, b) => selected.findIndex((t) => t.id === a.id) - selected.findIndex((t) => t.id === b.id));

// ── scorecard vs pinned baseline ──────────────────────────────────────────
const BASELINE = "evals/baseline.json";
const baseline: Record<string, TaskResult> | null = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, "utf8"))
  : null;

console.log("\n── scorecard ─────────────────────────────────────────────");
for (const r of results) {
  const failed = Object.entries(r.checks).filter(([, ok]) => !ok).map(([k]) => k);
  const base = baseline?.[r.id];
  const delta = base ? r.score - base.score : null;
  const deltaStr = delta === null ? "" : `  (${delta >= 0 ? "+" : ""}${delta.toFixed(2)} vs baseline)`;
  console.log(`${r.id.padEnd(24)} ${r.verdict.padEnd(22)} score ${r.score.toFixed(2)}${deltaStr}`);
  if (failed.length) console.log(`${" ".repeat(24)} failed checks: ${failed.join(", ")}`);
  console.log(`${" ".repeat(24)} grader: ${r.explanation.slice(0, 200)}`);
}
const total = results.reduce((s, r) => s + r.score, 0) / (results.length || 1);
const baseTotal = baseline
  ? results.reduce((s, r) => s + (baseline[r.id]?.score ?? 0), 0) / (results.length || 1)
  : null;
console.log(
  `\noverall ${total.toFixed(2)}${baseTotal !== null ? ` (baseline ${baseTotal.toFixed(2)}, Δ ${(total - baseTotal >= 0 ? "+" : "") + (total - baseTotal).toFixed(2)})` : ""}`,
);

mkdirSync("evals/runs", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const byId = Object.fromEntries(results.map((r) => [r.id, r]));
writeFileSync(`evals/runs/${stamp}.json`, JSON.stringify(byId, null, 2));
console.log(`saved → evals/runs/${stamp}.json`);

if (pinBaseline) {
  writeFileSync(BASELINE, JSON.stringify(byId, null, 2));
  console.log(`pinned → ${BASELINE}`);
} else if (!baseline) {
  console.log(`no baseline yet — pin one with:  npm run eval -- --baseline`);
}

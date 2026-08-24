import { listTargets } from "@/lib/store";
import { reconcileRunning } from "@/lib/research";
import { isDemo } from "@/lib/storage";
import { Board } from "./Board";

export const dynamic = "force-dynamic";

export default async function Page() {
  let targets = await listTargets();
  // Self-heal: attach any deep-research that finished while no browser was polling.
  if (targets.some((t) => t.dossier_status === "running")) {
    await reconcileRunning(targets);
    targets = await listTargets();
  }
  return (
    <main>
      {/* Demo runs must never read as real output — say so above the fold. */}
      {isDemo() && (
        <div className="demo-banner">
          <b>Demo mode</b> — fictional companies, canned research and drafts. No model is
          called and nothing is stored outside <code>.demo-data/</code>. See the README to
          run it for real.
        </div>
      )}
      <header>
        <h1>BD Desk — Pipeline</h1>
        <p>
          {targets.length} target{targets.length === 1 ? "" : "s"} ·{" "}
          {isDemo() ? "seeded demo pipeline" : "sourced by the Opportunity Radar"}
        </p>
      </header>
      <Board initial={targets} />
    </main>
  );
}

import { listTargets } from "@/lib/store";
import { reconcileRunning } from "@/lib/research";
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
      <header>
        <h1>BD Desk — Pipeline</h1>
        <p>
          {targets.length} target{targets.length === 1 ? "" : "s"} · sourced by the Opportunity Radar
        </p>
      </header>
      <Board initial={targets} />
    </main>
  );
}

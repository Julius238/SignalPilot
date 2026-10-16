import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EVOLUTION_GATES_V4, EVOLUTION_ROOTS, type IndependentFamilyStructure, type PortfolioMemberSpec } from "@signalpilot/evolution";

import type { EvolutionJob } from "../src/backtest/execute.js";
import { InProcessBacktestRunner, type BacktestRunner } from "../src/backtest/pool.js";
import { screenIndependentCandidate, type PortfolioRunContext } from "../src/cycle/portfolioAssessment.js";
import { SYNTHETIC_SPLIT, syntheticMarket } from "./support.js";

// Synthetic candles: the test proves the wiring of the gates-v4 portfolio path, not any strategy.
describe("gates v4 portfolio path in the worker", { timeout: 900_000 }, () => {
  const { market, fingerprint } = syntheticMarket();
  const challenger = EVOLUTION_ROOTS.find((root) => root.role === "CHALLENGER")!;
  const existing: PortfolioMemberSpec[] = EVOLUTION_ROOTS.map((root) => ({ key: root.key, subject: { kind: "ROOT", rootKey: root.key } }));
  const structure: IndependentFamilyStructure = { declaredIndependent: true, entryParametersOnly: true, exitsFrozen: true, ownEntryEvaluator: true, preregistrationHash: "test" };

  it("runs comparison A once per window, B per candidate, and never counts a copy of the challenger as an edge", async () => {
    const comparisons: string[] = [];
    const inner = new InProcessBacktestRunner(market, fingerprint);
    const runner: BacktestRunner = {
      run: (job: EvolutionJob) => {
        comparisons.push(job.kind === "PORTFOLIO" ? job.spec.comparison : job.kind);
        return inner.run(job);
      },
      close: () => inner.close()
    };
    let counter = 0;
    const context: PortfolioRunContext = {
      runner,
      existing,
      codeVersion: "test",
      split: SYNTHETIC_SPLIT,
      baselineCache: new Map(),
      jobId: (label) => `${label}-${(counter += 1)}`
    };
    const copy = (key: string): PortfolioMemberSpec => ({ key, subject: { kind: "GENOME", genome: challenger.genome }, researchIdentity: "RESEARCH:COPY_TEST" });
    const screen = (key: string) =>
      screenIndependentCandidate(context, { family: "TEST_INDEPENDENT", candidate: copy(key), structure, gates: EVOLUTION_GATES_V4, trials: 52, screeningsThisMonth: 1 });

    const first = await screen("EVO-COPY-0001");
    const second = await screen("EVO-COPY-0002");
    assert.deepEqual(comparisons, ["BASELINE", "WITH_CANDIDATE", "WITH_CANDIDATE"]);

    // The fixed-slot frame: same total capital, the candidate last on the reserve slot.
    assert.equal(first.baseline.group.totalCapital, first.withCandidate.group.totalCapital);
    assert.equal(first.baseline.reserveCash, 20_000);
    assert.deepEqual(first.withCandidate.members.map((member) => member.key), [...existing.map((member) => member.key), "EVO-COPY-0001"]);
    assert.equal(first.withCandidate.members.at(-1)!.researchIdentity, "RESEARCH:COPY_TEST");

    // A copy trades exactly like the challenger and adds no own return.
    const challengerInB = first.withCandidate.members.find((member) => member.key === challenger.key)!;
    assert.deepEqual(first.withCandidate.members.at(-1)!.trades, challengerInB.trades);
    assert.ok(first.assessment.existing.every((relation) => relation.identicalInBothComparisons));
    assert.equal(first.decision.passed, false);
    assert.equal(first.gates.find((gate) => gate.gate === "OWN_ALPHA")!.passed, false);
    assert.equal(second.decision.passed, false);
    assert.equal(first.dataFingerprint, fingerprint);
  });
});

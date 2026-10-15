import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AI_MODEL_PRICING,
  EVOLUTION_DATA_SPLIT_V1 as SPLIT,
  EVOLUTION_DATA_SPLIT_V1_HASH,
  EVOLUTION_ROOTS,
  HYPOTHESIS_RESPONSE_SCHEMA,
  MockResearchProvider,
  STRATEGY_MODULE_SANDBOX_CONTRACT_V0,
  analyzeMarketConditions,
  applyChanges,
  assertContextLeakFree,
  assertStrategyCodeGenerationDisabled,
  budgetMonth,
  buildResearchContext,
  candidateKeyFor,
  checkBudget,
  classifyDays,
  costOfModelUsage,
  costOfUsage,
  extractResearchContext,
  lineageChain,
  parseCandidateKey,
  parseHypothesisResponse,
  renderHypothesisPrompt,
  rootByKey,
  startOfNextMonthUtc,
  validateDataSplit,
  windowMetrics,
  windowOfAnchor,
  worstCaseCallCost,
  type DailyBar,
  type HistoryEntry
} from "../src/index.js";
import { backtest, trade } from "./support.js";

const D = SPLIT.windows.DISCOVERY;

function bars(from: string, to: string, drift: number): DailyBar[] {
  const result: DailyBar[] = [];
  let close = 10000;
  let index = 0;
  for (let at = Date.parse(from); at <= Date.parse(to); at += 86_400_000) {
    close *= 1 + drift + 0.02 * Math.sin(index / 7);
    result.push({ day: new Date(at).toISOString().slice(0, 10), high: close * 1.01, low: close * 0.99, close });
    index += 1;
  }
  return result;
}

describe("data split", () => {
  it("is structurally sound and pre-registered", () => {
    assert.deepEqual(validateDataSplit(SPLIT), []);
    assert.equal(EVOLUTION_DATA_SPLIT_V1_HASH.length, 64);
    assert.equal(SPLIT.windows.HOLDOUT.integrity, "PREVIOUSLY_ANALYZED");
    assert.equal(SPLIT.windows.HOLDOUT.aiVisibility, "NEVER");
    assert.equal(SPLIT.windows.VALIDATION.aiVisibility, "VERDICT_ONLY");
    assert.ok(Date.parse(SPLIT.windows.HOLDOUT.to) < Date.parse(SPLIT.forwardFrom));
    assert.equal(SPLIT.forwardFrom, "2026-10-15T00:00:00.000Z");
  });

  it("assigns anchors to windows and nothing to the forward period", () => {
    assert.equal(windowOfAnchor(SPLIT, "2019-05-01T10:00:00.000Z"), "DISCOVERY");
    assert.equal(windowOfAnchor(SPLIT, "2023-05-01T10:00:00.000Z"), "VALIDATION");
    assert.equal(windowOfAnchor(SPLIT, "2025-05-01T10:00:00.000Z"), "HOLDOUT");
    assert.equal(windowOfAnchor(SPLIT, "2026-10-15T10:00:00.000Z"), null);
    assert.equal(windowOfAnchor(SPLIT, "2018-01-01T10:00:00.000Z"), null);
  });

  it("detects a broken split", () => {
    const broken = { ...SPLIT, windows: { ...SPLIT.windows, VALIDATION: { ...SPLIT.windows.VALIDATION, from: "2022-01-01T00:00:00.000Z" } } };
    assert.ok(validateDataSplit(broken).some((problem) => problem.includes("overlaps")));
    const visible = { ...SPLIT, windows: { ...SPLIT.windows, HOLDOUT: { ...SPLIT.windows.HOLDOUT, aiVisibility: "METRICS" as const } } };
    assert.ok(validateDataSplit(visible).some((problem) => problem.includes("never be visible")));
  });
});

describe("market-condition analysis", () => {
  it("classifies each day from past bars only", () => {
    const all = bars("2017-08-17T00:00:00.000Z", D.to, 0.001);
    const full = classifyDays(all, D);
    const truncated = classifyDays(all.slice(0, 900), D);
    for (const day of truncated) assert.deepEqual(day, { ...full.find((entry) => entry.day === day.day)!, volatility: day.volatility });
  });

  it("refuses data after the discovery window", () => {
    assert.throws(
      () => analyzeMarketConditions({ split: SPLIT, referenceSymbol: "BTCUSDT", bars: { BTCUSDT: bars("2018-01-01T00:00:00.000Z", "2023-01-01T00:00:00.000Z", 0.001) }, subjects: [] }),
      /after the discovery window/
    );
    assert.throws(
      () =>
        analyzeMarketConditions({
          split: SPLIT,
          referenceSymbol: "BTCUSDT",
          bars: { BTCUSDT: bars("2018-01-01T00:00:00.000Z", D.to, 0.001) },
          subjects: [{ key: "X", trades: [trade({ anchorAt: "2023-03-01T00:00:00.000Z", netPnl: 1 })] }]
        }),
      /outside the discovery window/
    );
  });

  it("names conditions that favour or hurt a strategy", () => {
    const btc = [...bars("2017-08-17T00:00:00.000Z", "2019-12-31T00:00:00.000Z", 0.004), ...bars("2020-01-01T00:00:00.000Z", D.to, -0.003)];
    const trades = [
      ...Array.from({ length: 8 }, (_, index) => trade({ anchorAt: `2019-0${(index % 8) + 1}-15T00:00:00.000Z`, netPnl: 50 })),
      ...Array.from({ length: 8 }, (_, index) => trade({ anchorAt: `2021-0${(index % 8) + 1}-15T00:00:00.000Z`, netPnl: -25 }))
    ];
    const analysis = analyzeMarketConditions({ split: SPLIT, referenceSymbol: "BTCUSDT", bars: { BTCUSDT: btc }, subjects: [{ key: "ROOT:CRYPTO_TREND_CORE_LONG_V1", trades }] });
    assert.ok(analysis.segments.length >= 5);
    assert.ok(analysis.findings.length > 0);
    assert.ok(analysis.findings.some((finding) => finding.sentence.includes("begünstigt") && finding.sentence.includes("benachteiligt")));
  });
});

function history(): HistoryEntry[] {
  const root = EVOLUTION_ROOTS[0]!;
  const { genome } = applyChanges(root.genome, [{ parameter: "breakoutLookback", value: "30" }]);
  return [
    {
      candidateKey: "EVO-BRK-0001",
      family: "BREAKOUT_LONG",
      parentKey: root.key,
      generation: 1,
      hypothesis: "Längeres Ausbruchsfenster",
      changes: [{ parameter: "breakoutLookback", from: 20, to: 30 }],
      parameters: genome.parameters,
      verdict: "PASSED_SCREENING",
      failedGates: [],
      discovery: { trades: 40, averageR: 0.3, profitFactor: 1.5, winRatePct: 40, netReturnPct: 3, sharpe: 0.8, maxDrawdownPct: 2, stressedAverageR: 0.2, exposurePct: 10, tradesPerSymbol: { BTCUSDT: 25, ETHUSDT: 15 } }
    }
  ];
}

function context() {
  const backtests = [backtest("BTCUSDT", [trade({ anchorAt: "2019-03-01T00:00:00.000Z", netPnl: 20 })], D.from, D.to)];
  const discovery = windowMetrics({ label: "D", from: D.from, to: D.to, backtests, periodKey: "discovery" });
  const analysis = analyzeMarketConditions({ split: SPLIT, referenceSymbol: "BTCUSDT", bars: { BTCUSDT: bars("2017-08-17T00:00:00.000Z", D.to, 0.001) }, subjects: [] });
  return buildResearchContext({
    split: SPLIT,
    benchmarks: EVOLUTION_ROOTS.map((root) => ({ key: root.key, label: root.label, discovery })),
    analysis,
    history: history(),
    hypotheses: 4
  });
}

describe("research context and prompt", () => {
  it("contains discovery data only and passes the leak check", () => {
    const built = context();
    assertContextLeakFree(built, SPLIT);
    assert.deepEqual(built.allowedParents, [...EVOLUTION_ROOTS.map((root) => root.key), "EVO-BRK-0001"]);
    const text = JSON.stringify(built);
    assert.ok(!/holdout/i.test(text));
    assert.ok(!text.includes("2023-"));
  });

  it("the leak check catches holdout keys and later dates", () => {
    assert.throws(() => assertContextLeakFree({ history: [{ holdout: { averageR: 1 } }] }, SPLIT), /forbidden key holdout/);
    assert.throws(() => assertContextLeakFree({ note: "Validierung bis 2023-12-31" }, SPLIT), /after discovery/);
    assert.throws(() => assertContextLeakFree({ at: "2026-10-16T08:00:00.000Z" }, SPLIT), /after discovery/);
    assertContextLeakFree({ note: "Entdeckung bis 2022-06-30" }, SPLIT);
  });

  it("round-trips the context through the prompt", () => {
    const built = context();
    const prompt = renderHypothesisPrompt(built);
    assert.deepEqual(extractResearchContext(prompt), built);
    assert.equal(extractResearchContext("no context"), null);
    assert.ok(HYPOTHESIS_RESPONSE_SCHEMA.required.includes("hypotheses"));
  });

  it("parses hypotheses strictly and refuses malformed entries", () => {
    const valid = {
      title: "Regime strenger",
      marketObservation: "Verluste unter dem 200-Tage-Schnitt.",
      rationale: "Falsche Ausbrüche in schwachen Regimen.",
      family: "BREAKOUT_LONG",
      parentKey: "ROOT:CRYPTO_TREND_CORE_LONG_V1",
      changes: [{ parameter: "regimeMinimumConfidence", value: "70" }],
      expectedEffect: "Weniger, bessere Trades.",
      falsificationCriterion: "Ø R steigt nicht."
    };
    const parsed = parseHypothesisResponse(
      {
        summary: "ok",
        hypotheses: [valid, { ...valid, family: "LEVERAGED_SHORT" }, { ...valid, changes: [] }, { ...valid, title: "" }, valid, valid]
      },
      3
    );
    assert.equal(parsed.hypotheses.length, 3);
    assert.equal(parsed.refused.length, 3);
    assert.deepEqual(parsed.hypotheses[0]!.changes, [{ parameter: "regimeMinimumConfidence", value: "70" }]);
    assert.throws(() => parseHypothesisResponse("text", 3), /not a JSON object/);
    assert.throws(() => parseHypothesisResponse({ summary: "x" }, 3), /no hypotheses array/);
  });
});

describe("mock provider", () => {
  it("derives deterministic, compilable hypotheses from the context and is never billable", async () => {
    const provider = new MockResearchProvider();
    assert.equal(provider.billable, false);
    const built = context();
    const request = {
      task: "HYPOTHESIS_GENERATION" as const,
      tier: "ADVANCED" as const,
      model: "claude-opus-5-5",
      system: "s",
      prompt: renderHypothesisPrompt(built),
      jsonSchema: HYPOTHESIS_RESPONSE_SCHEMA,
      maxOutputTokens: 8000,
      effort: "medium" as const
    };
    const first = await provider.complete(request);
    const second = await provider.complete(request);
    assert.deepEqual(first.json, second.json);
    assert.ok(first.usage.inputTokens > 0 && first.usage.outputTokens > 0);
    const parsed = parseHypothesisResponse(first.json, 4);
    assert.equal(parsed.hypotheses.length, 4);
    assert.ok(parsed.hypotheses.some((hypothesis) => hypothesis.family === "REGIME_LONG"));
    for (const hypothesis of parsed.hypotheses) {
      const parent =
        rootByKey(hypothesis.parentKey)?.genome ??
        (built.history.find((entry) => entry.candidateKey === hypothesis.parentKey) && {
          family: hypothesis.family,
          parameters: built.history.find((entry) => entry.candidateKey === hypothesis.parentKey)!.parameters
        });
      assert.ok(parent, hypothesis.parentKey);
      const { issues } = applyChanges(parent!, hypothesis.changes);
      assert.deepEqual(issues, [], hypothesis.title);
    }
  });
});

describe("pricing and budget", () => {
  it("prices actual usage per model and refuses unknown models", () => {
    const usage = { inputTokens: 10_000, outputTokens: 5_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    assert.equal(costOfUsage("claude-opus-5-5", usage), 0.14);
    assert.equal(costOfUsage("claude-haiku-5-5", usage), 0.0035);
    assert.equal(costOfUsage("claude-opus-5-5", { ...usage, cacheReadInputTokens: 100_000 }), 0.16);
    // Haiku above 100k prompt tokens uses the long-context price.
    assert.equal(costOfUsage("claude-haiku-5-5", { ...usage, inputTokens: 200_000 }), 0.1125);
    assert.throws(() => costOfUsage("gpt-x", usage), /No price/);
    // A served model without a price is charged like the most expensive known one.
    assert.equal(costOfModelUsage([{ model: "unknown-model", usage }]), costOfUsage("claude-opus-5", usage));
    assert.ok(worstCaseCallCost("claude-opus-5-5", 8_000, 16_000) > 0.3);
    assert.ok(Object.keys(AI_MODEL_PRICING).includes("claude-sonnet-5-5"));
  });

  it("allows a call only if its worst case fits the month and the run, without top-up", () => {
    const policy = { monthlyBudgetUsd: 20, perRunBudgetUsd: 1 };
    assert.equal(checkBudget({ policy, billable: true, spentThisMonthUsd: 5, spentThisRunUsd: 0, worstCaseUsd: 0.4 }).reason, "WITHIN_BUDGET");
    assert.equal(checkBudget({ policy, billable: true, spentThisMonthUsd: 19.8, spentThisRunUsd: 0, worstCaseUsd: 0.4 }).reason, "MONTHLY_BUDGET_EXHAUSTED");
    assert.equal(checkBudget({ policy, billable: true, spentThisMonthUsd: 5, spentThisRunUsd: 0.7, worstCaseUsd: 0.4 }).reason, "RUN_BUDGET_EXHAUSTED");
    assert.equal(checkBudget({ policy, billable: false, spentThisMonthUsd: 50, spentThisRunUsd: 5, worstCaseUsd: 0.4 }).allowed, true);
    assert.equal(budgetMonth(new Date("2026-10-31T23:59:59.999Z")), "2026-10");
    assert.equal(startOfNextMonthUtc(new Date("2026-12-15T00:00:00.000Z")).toISOString(), "2027-01-01T00:00:00.000Z");
  });
});

describe("lineage and the prepared code-generation extension", () => {
  it("formats keys and reads lineages back to the frozen root", () => {
    assert.equal(candidateKeyFor("BREAKOUT_LONG", 7), "EVO-BRK-0007");
    assert.deepEqual(parseCandidateKey("EVO-REG-0012"), { family: "REGIME_LONG", sequence: 12 });
    assert.equal(parseCandidateKey("CRYPTO_TREND_CORE_LONG_V1"), null);
    const parents: Record<string, string> = { "EVO-BRK-0007": "EVO-BRK-0002", "EVO-BRK-0002": "ROOT:CRYPTO_TREND_CORE_LONG_V1" };
    assert.deepEqual(lineageChain("EVO-BRK-0007", (key) => (parents[key] ? { key, parentKey: parents[key]! } : null)), [
      "ROOT:CRYPTO_TREND_CORE_LONG_V1",
      "EVO-BRK-0002",
      "EVO-BRK-0007"
    ]);
    // A cycle never loops forever.
    assert.deepEqual(lineageChain("A", (key) => ({ key, parentKey: key === "A" ? "B" : "A" })), ["B", "A"]);
  });

  it("refuses AI-generated strategy code in V1", () => {
    assert.equal(STRATEGY_MODULE_SANDBOX_CONTRACT_V0.status, "NOT_IMPLEMENTED");
    assert.throws(() => assertStrategyCodeGenerationDisabled(true), /disabled/);
    assertStrategyCodeGenerationDisabled(false);
  });
});

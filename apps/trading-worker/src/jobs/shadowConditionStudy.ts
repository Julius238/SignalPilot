/**
 * Condition study over the historical replay (research, read-only):
 *
 *   STUDY_SNAPSHOT_DIR=./data/market-snapshots/real STUDY_SYMBOL=BTCUSDT \
 *     tsx src/jobs/shadowConditionStudy.ts
 *
 * Replays the strategy hour by hour (training period only unless
 * STUDY_PHASE=FULL) and, for every entry and price-plan condition, compares
 * the forward return of hours in which it passed with hours in which it
 * failed. A condition whose passing hours do not outperform its failing ones
 * filters without edge; one with a clear spread carries information. Forward
 * returns run from the next hour's open (no costs), like the near-miss study.
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CRYPTO_MTF_BREAKOUT_LONG_V1_KEY } from "@signalpilot/strategy-engine";
import { runShadowReplay, type RegimePolicy } from "@signalpilot/shadow-replay";

import { BOOTSTRAP_EXECUTION_PROFILES } from "./shadowBootstrap.js";
import { REPLAY_COST_PROFILES, loadSnapshotMarket } from "./shadowReplay.js";
import { RESEARCH_SPLIT_AT } from "./shadowReplayResearch.js";

const HORIZONS = [24, 72] as const;

interface ConditionTally {
  passed: number[][];
  failed: number[][];
}

const mean = (values: readonly number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);
const pct = (value: number | null, digits = 3) => (value === null ? "–" : (value * 100).toFixed(digits));
const positive = (values: readonly number[]) => (values.length === 0 ? null : values.filter((v) => v > 0).length / values.length);

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const snapshotDir = resolve(process.env.STUDY_SNAPSHOT_DIR ?? "candle-snapshot");
  const symbol = process.env.STUDY_SYMBOL ?? "BTCUSDT";
  const regimePolicy = (process.env.STUDY_REGIME_POLICY ?? "CRYPTO_NATIVE_V1") as RegimePolicy;
  const full = process.env.STUDY_PHASE === "FULL";
  const market = await loadSnapshotMarket(snapshotDir, symbol);
  const hourly = market.series.find((series) => series.symbol === symbol)!.candles["1h"]!;
  const indexByClose = new Map(hourly.map((candle, index) => [candle.closeTime, index] as const));
  const untilMs = full ? Number.POSITIVE_INFINITY : Date.parse(RESEARCH_SPLIT_AT);

  const tallies = new Map<string, ConditionTally>();
  const forward = (index: number): number[] | null => {
    const entry = Number(hourly[index + 1]?.open);
    if (!Number.isFinite(entry) || entry <= 0) return null;
    const result: number[] = [];
    for (const horizon of HORIZONS) {
      const target = hourly[index + horizon];
      if (target === undefined || target.closeTime >= untilMs) return null;
      result.push(Number(target.close) / entry - 1);
    }
    return result;
  };

  runShadowReplay(
    market,
    {
      symbol,
      strategyKey: CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
      mode: "SIGNAL_EDGE",
      regimePolicy,
      startingCash: "10000",
      executionProfile: { ...BOOTSTRAP_EXECUTION_PROFILES[symbol]!, ...REPLAY_COST_PROFILES.REALISTIC, maxParticipationRate: "0.010000000000" },
      to: full ? undefined : new Date(untilMs - 1).toISOString(),
      codeVersion: "condition-study",
      // Baseline rules: every condition, including the signal-engine ones, is evaluated.
      variant: "BASELINE"
    },
    {
      onEvaluation: (anchorCloseTime, evaluation) => {
        if (evaluation.outcome === "INVALID_INPUT") return;
        const index = indexByClose.get(Date.parse(anchorCloseTime));
        if (index === undefined) return;
        const returns = forward(index);
        if (returns === null) return;
        for (const check of evaluation.checks) {
          if (check.stage !== "ENTRY" && check.stage !== "PRICE_PLAN") continue;
          const tally = tallies.get(check.checkId) ?? { passed: [], failed: [] };
          (check.passed ? tally.passed : tally.failed).push(returns);
          tallies.set(check.checkId, tally);
        }
      }
    }
  );

  const column = (rows: number[][], horizon: number) => rows.map((row) => row[horizon]);
  const lines = [
    `# Bedingungs-Studie ${symbol} (Regime ${regimePolicy}, ${full ? "Gesamtzeitraum" : `nur vor ${RESEARCH_SPLIT_AT}`})`,
    "",
    "Forward-Rendite ab Eröffnung der Folgestunde, ohne Kosten. Spread = Ø Rendite (erfüllt) − Ø Rendite (verfehlt).",
    "",
    "| Bedingung | erfüllt Std. | Anteil erfüllt % | Ø 24h erfüllt % | Ø 24h verfehlt % | Spread 24h | Ø 72h erfüllt % | Ø 72h verfehlt % | Spread 72h | positiv 72h erfüllt % |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  ];
  for (const [checkId, tally] of [...tallies.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const total = tally.passed.length + tally.failed.length;
    const p24 = mean(column(tally.passed, 0));
    const f24 = mean(column(tally.failed, 0));
    const p72 = mean(column(tally.passed, 1));
    const f72 = mean(column(tally.failed, 1));
    lines.push(
      `| ${checkId} | ${tally.passed.length} | ${((tally.passed.length / total) * 100).toFixed(1)} | ${pct(p24)} | ${pct(f24)} | ${p24 === null || f24 === null ? "–" : pct(p24 - f24)} | ${pct(p72)} | ${pct(f72)} | ${p72 === null || f72 === null ? "–" : pct(p72 - f72)} | ${pct(positive(column(tally.passed, 1)), 1)} |`
    );
  }
  const report = `${lines.join("\n")}\n`;
  if (process.env.STUDY_OUT) await writeFile(resolve(process.env.STUDY_OUT), report);
  console.log(report);
}

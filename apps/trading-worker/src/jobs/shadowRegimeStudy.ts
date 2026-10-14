/**
 * Regime study over gzip-CSV snapshots (research, read-only):
 *
 *   STUDY_SNAPSHOT_DIR=./data/market-snapshots/real tsx src/jobs/shadowRegimeStudy.ts
 *
 * Evaluates each regime policy as a pure filter, independent of any entry
 * rule: once per UTC day (after the daily close) it derives the regime the
 * live job would have written and checks the long entry gate of
 * CRYPTO_MTF_BREAKOUT_LONG_V1 (crypto RISK_ON, allowed risk mode, confidence
 * ≥ 60). It then compares forward returns of gated and blocked days and a
 * "hold only while the gate is open" curve with buy-and-hold.
 *
 * Only days before `RESEARCH_SPLIT_AT` are used by default: the study informs
 * design decisions and must never see the test period. STUDY_PHASE=TEST
 * evaluates only the days from the split (the one-time out-of-sample check),
 * STUDY_PHASE=FULL all days.
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CRYPTO_MTF_BREAKOUT_V1_PARAMETERS } from "@signalpilot/strategy-engine";
import { deriveRegime, lastClosedIndex, type RegimePolicy, type ReplayMarketData } from "@signalpilot/shadow-replay";

import { RESEARCH_SPLIT_AT } from "./shadowReplayResearch.js";
import { loadSnapshotMarket } from "./shadowReplay.js";

const HORIZONS = [1, 3, 7, 14, 30] as const;
const POLICIES: readonly RegimePolicy[] = ["AS_SPECIFIED", "CRYPTO_ONLY", "CRYPTO_NATIVE_V1"];

interface DayObservation {
  readonly at: number;
  readonly gate: Record<RegimePolicy, boolean>;
  readonly productionCryptoRiskOn: boolean;
  readonly forward: Record<string, Partial<Record<(typeof HORIZONS)[number], number>>>;
  readonly nextDay: Record<string, number | null>;
}

export function entryGateOpen(report: { cryptoRegime: string; riskMode: string; confidence: number }): boolean {
  const params = CRYPTO_MTF_BREAKOUT_V1_PARAMETERS;
  return (
    report.cryptoRegime === params.regimeRequiredCryptoRegime &&
    !params.regimeForbiddenRiskModes.includes(report.riskMode as never) &&
    report.confidence >= params.regimeMinimumConfidence
  );
}

export function observeDays(market: ReplayMarketData, untilMs: number, fromMs = Number.NEGATIVE_INFINITY): DayObservation[] {
  const daily = (symbol: string) => market.series.find((series) => series.symbol === symbol)?.candles["1d"] ?? [];
  const btc = daily("BTCUSDT");
  const symbols = ["BTCUSDT", "ETHUSDT"];
  const observations: DayObservation[] = [];
  for (let index = 220; index < btc.length; index += 1) {
    const closeMs = btc[index].closeTime;
    if (closeMs >= untilMs) break;
    if (closeMs < fromMs) continue;
    const at = closeMs + 5 * 60 * 1000;
    const reports = Object.fromEntries(POLICIES.map((policy) => [policy, deriveRegime(market.series, at, policy)])) as Record<
      RegimePolicy,
      ReturnType<typeof deriveRegime>
    >;
    const forward: DayObservation["forward"] = {};
    const nextDay: DayObservation["nextDay"] = {};
    for (const symbol of symbols) {
      const candles = daily(symbol);
      const last = lastClosedIndex(candles, at);
      const base = Number(candles[last]?.close);
      forward[symbol] = {};
      for (const horizon of HORIZONS) {
        const target = candles[last + horizon];
        // A forward window must also end before the cut-off, or it would peek past it.
        if (target !== undefined && target.closeTime < untilMs) forward[symbol][horizon] = Number(target.close) / base - 1;
      }
      const next = candles[last + 1];
      nextDay[symbol] = next !== undefined && next.closeTime < untilMs ? Number(next.close) / base - 1 : null;
    }
    observations.push({
      at,
      gate: Object.fromEntries(POLICIES.map((policy) => [policy, entryGateOpen(reports[policy])])) as Record<RegimePolicy, boolean>,
      productionCryptoRiskOn: reports.AS_SPECIFIED.cryptoRegime === "RISK_ON",
      forward,
      nextDay
    });
  }
  return observations;
}

const pct = (value: number | null, digits = 2) => (value === null || !Number.isFinite(value) ? "–" : (value * 100).toFixed(digits));
const mean = (values: readonly number[]) => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);
const share = (values: readonly number[]) => (values.length === 0 ? null : values.filter((value) => value > 0).length / values.length);

/** Holding the asset on the day after every open-gate day (no costs): CAGR, max drawdown, Sharpe (365). */
function filterCurve(observations: readonly DayObservation[], symbol: string, open: (day: DayObservation) => boolean) {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  const returns: number[] = [];
  for (const day of observations) {
    const next = day.nextDay[symbol];
    if (next === null) continue;
    const daily = open(day) ? next : 0;
    returns.push(daily);
    equity *= 1 + daily;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, 1 - equity / peak);
  }
  const years = returns.length / 365;
  const average = mean(returns) ?? 0;
  const deviation = Math.sqrt(returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, returns.length - 1));
  return {
    totalReturn: equity - 1,
    cagr: years > 0 ? equity ** (1 / years) - 1 : null,
    maxDrawdown,
    sharpe: deviation > 0 ? (average / deviation) * Math.sqrt(365) : null,
    exposure: returns.length === 0 ? null : observations.filter((day) => day.nextDay[symbol] !== null && open(day)).length / returns.length
  };
}

export function renderRegimeStudy(observations: readonly DayObservation[], scope: string): string {
  const first = observations[0] === undefined ? "–" : new Date(observations[0].at).toISOString().slice(0, 10);
  const last = observations.at(-1) === undefined ? "–" : new Date(observations.at(-1)!.at).toISOString().slice(0, 10);
  const lines = [
    `# Regime-Studie (${first} → ${last}, ${scope})`,
    "",
    `${observations.length} Tage. Gate = Einstiegsbedingung von LONG_V1: cryptoRegime RISK_ON, Risk Mode nicht DEFENSIVE/HIGH_RISK/UNKNOWN, Konfidenz ≥ 60. AS_SPECIFIED nutzt S&P 500 und Nasdaq-100 (FRED) als SPY/QQQ-Proxy; IWM fehlt.`,
    ""
  ];

  for (const symbol of ["BTCUSDT", "ETHUSDT"]) {
    lines.push(`## ${symbol}`, "", "| Filter | Tage offen | Ø 7d % | Ø 14d % | Ø 30d % | positiv 14d % | Gesamtrendite % | CAGR % | Max. DD % | Sharpe | Zeit im Markt % |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    const rows: Array<[string, (day: DayObservation) => boolean]> = [
      ["Buy & Hold (immer offen)", () => true],
      ...POLICIES.map((policy) => [`Gate ${policy}`, (day: DayObservation) => day.gate[policy]] as [string, (day: DayObservation) => boolean]),
      ["AS_SPECIFIED gesperrt trotz Krypto RISK_ON (Aktien-Veto)", (day) => day.productionCryptoRiskOn && !day.gate.AS_SPECIFIED],
      ["Krypto RISK_ON (Produktionsregel, ohne Aktien)", (day) => day.productionCryptoRiskOn]
    ];
    for (const [label, open] of rows) {
      const days = observations.filter(open);
      const fwd = (horizon: (typeof HORIZONS)[number]) =>
        days.map((day) => day.forward[symbol][horizon]).filter((value): value is number => value !== undefined);
      const curve = filterCurve(observations, symbol, open);
      lines.push(
        `| ${label} | ${days.length} | ${pct(mean(fwd(7)))} | ${pct(mean(fwd(14)))} | ${pct(mean(fwd(30)))} | ${pct(share(fwd(14)), 1)} | ${pct(curve.totalReturn, 1)} | ${pct(curve.cagr, 1)} | ${pct(curve.maxDrawdown, 1)} | ${curve.sharpe === null ? "–" : curve.sharpe.toFixed(2)} | ${pct(curve.exposure, 1)} |`
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const snapshotDir = resolve(process.env.STUDY_SNAPSHOT_DIR ?? "candle-snapshot");
  const phase = process.env.STUDY_PHASE ?? "TRAINING";
  const splitMs = Date.parse(RESEARCH_SPLIT_AT);
  const market = await loadSnapshotMarket(snapshotDir, "BTCUSDT");
  const observations =
    phase === "TEST"
      ? observeDays(market, Number.POSITIVE_INFINITY, splitMs)
      : observeDays(market, phase === "FULL" ? Number.POSITIVE_INFINITY : splitMs);
  const scope = phase === "TEST" ? `nur Testzeitraum ab ${RESEARCH_SPLIT_AT}` : phase === "FULL" ? "Gesamtzeitraum" : `nur vor ${RESEARCH_SPLIT_AT}`;
  const report = renderRegimeStudy(observations, scope);
  if (process.env.STUDY_OUT) await writeFile(resolve(process.env.STUDY_OUT), report);
  console.log(report);
}

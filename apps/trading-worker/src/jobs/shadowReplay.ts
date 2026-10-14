/**
 * Historical shadow replay over stored candles (research, read-only for
 * trading): `pnpm trading-worker:shadow-replay`
 *
 * Loads closed candles from the `Candle` table (or from gzip-CSV snapshots
 * with `REPLAY_SNAPSHOT_DIR`), replays the unchanged strategy, risk,
 * simulation and portfolio engines hour by hour (`@signalpilot/shadow-replay`)
 * and stores each run in `ShadowReplayRun`. It never writes a trading table,
 * never needs a trading flag and cannot place, approve or activate anything.
 *
 * Environment (all optional):
 *   REPLAY_SYMBOL=BTCUSDT
 *   REPLAY_STRATEGY=CRYPTO_MTF_BREAKOUT_LONG_V1   # the identity the live pipeline runs
 *   REPLAY_MODES=SPEC,SIGNAL_EDGE
 *   REPLAY_COST_PROFILES=BOOTSTRAP,REALISTIC          # also PESSIMISTIC
 *   REPLAY_VARIANTS=BASELINE                          # research variants, see STRATEGY_VARIANTS
 *   REPLAY_REGIME_POLICY=AUTO          # AUTO | AS_SPECIFIED | CRYPTO_ONLY
 *   REPLAY_FROM / REPLAY_TO            # ISO, anchor close window
 *   REPLAY_SPLIT_AT                    # ISO; default: 70 % of the window
 *   REPLAY_SNAPSHOT_DIR                # read <SYMBOL>-<tf>.csv.gz instead of the DB
 *   REPLAY_PERSIST=true
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma, type PrismaClient } from "@signalpilot/database";
import { CRYPTO_MTF_BREAKOUT_LONG_V1_KEY } from "@signalpilot/strategy-engine";
import {
  candleSnapshotFileName,
  readCandleSnapshot
} from "@signalpilot/market-data";
import {
  STRATEGY_VARIANTS,
  runShadowReplay,
  type RegimePolicy,
  type ReplayConfig,
  type ReplayExecutionProfile,
  type ReplayMarketData,
  type ReplayMode,
  type ReplayResult,
  type ReplaySeries,
  type ReplayTimeframe
} from "@signalpilot/shadow-replay";
import { config } from "dotenv";
import pino from "pino";

import { BOOTSTRAP_EXECUTION_PROFILES } from "./shadowBootstrap.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowReplay";

/**
 * - `BOOTSTRAP`: the profile the live shadow system is set up with (10/10/10 bp).
 * - `REALISTIC`: Binance spot taker fee (10 bp), BTC/ETH top-of-book spread
 *   (~2 bp full) and small-order slippage (3 bp).
 */
export const REPLAY_COST_PROFILES: Readonly<
  Record<string, { feeBps: number; fullSpreadBps: number; slippageBps: number }>
> = Object.freeze({
  BOOTSTRAP: { feeBps: 10, fullSpreadBps: 10, slippageBps: 10 },
  REALISTIC: { feeBps: 10, fullSpreadBps: 2, slippageBps: 3 },
  /** Double spread and more slippage than REALISTIC: a stress test for the cost assumption. */
  PESSIMISTIC: { feeBps: 10, fullSpreadBps: 4, slippageBps: 5 }
});

const CRYPTO_SERIES = ["BTCUSDT", "ETHUSDT"];
const EQUITY_BENCHMARKS = ["SPY", "QQQ", "IWM"];
const TIMEFRAMES: readonly ReplayTimeframe[] = ["1h", "4h", "1d"];

export interface ShadowReplayJobOptions {
  readonly symbol?: string;
  readonly strategyKey?: string;
  readonly variants?: readonly string[];
  readonly modes?: readonly ReplayMode[];
  readonly costProfiles?: readonly string[];
  readonly regimePolicy?: RegimePolicy | "AUTO";
  readonly from?: string;
  readonly to?: string;
  readonly splitAt?: string;
  readonly snapshotDir?: string;
  readonly persist?: boolean;
  readonly codeVersion?: string;
}

export interface ShadowReplayJobRun {
  readonly id: string | null;
  readonly label: string;
  readonly costProfile: string;
  readonly durationMs: number;
  readonly result: ReplayResult;
}

export async function runShadowReplayJob(
  database: PrismaClient = prisma,
  options: ShadowReplayJobOptions = {}
): Promise<ShadowReplayJobRun[]> {
  const symbol = options.symbol ?? "BTCUSDT";
  const market = options.snapshotDir
    ? await loadSnapshotMarket(options.snapshotDir, symbol)
    : await loadDatabaseMarket(database, symbol);
  const hasEquity = EQUITY_BENCHMARKS.some((benchmark) =>
    market.series.some(
      (series) =>
        series.symbol === benchmark &&
        (series.candles["1d"]?.length ?? 0) >= 200
    )
  );
  const regimePolicy: RegimePolicy =
    options.regimePolicy === undefined || options.regimePolicy === "AUTO"
      ? hasEquity
        ? "AS_SPECIFIED"
        : "CRYPTO_ONLY"
      : options.regimePolicy;

  const traded = market.series.find((series) => series.symbol === symbol);
  const hourly = traded?.candles["1h"] ?? [];
  if (hourly.length === 0) throw new Error(`No 1h candles for ${symbol}.`);
  const splitAt =
    options.splitAt ?? defaultSplit(hourly, options.from, options.to);
  const baseProfile = BOOTSTRAP_EXECUTION_PROFILES[symbol];
  if (baseProfile === undefined)
    throw new Error(`No execution profile for ${symbol}.`);

  const runs: ShadowReplayJobRun[] = [];
  for (const costProfile of options.costProfiles ?? [
    "BOOTSTRAP",
    "REALISTIC"
  ]) {
    const costs = REPLAY_COST_PROFILES[costProfile];
    if (costs === undefined)
      throw new Error(`Unknown cost profile ${costProfile}.`);
    const executionProfile: ReplayExecutionProfile = {
      ...baseProfile,
      ...costs,
      maxParticipationRate: "0.010000000000"
    };
    for (const mode of options.modes ?? ["SPEC", "SIGNAL_EDGE"]) {
      for (const variantKey of options.variants ?? ["BASELINE"]) {
        const variant = STRATEGY_VARIANTS[variantKey];
        if (variant === undefined)
          throw new Error(`Unknown strategy variant ${variantKey}.`);
        const replayConfig: ReplayConfig = {
          symbol,
          strategyKey: options.strategyKey ?? CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
          mode,
          regimePolicy,
          startingCash: "10000",
          executionProfile,
          from: options.from,
          to: options.to,
          trainTestSplitAt: splitAt,
          codeVersion:
            options.codeVersion ??
            process.env.TRADING_CODE_VERSION ??
            "replay-local",
          variant: variant.key
        };
        const variantLabel =
          variant.key === "BASELINE" ? "" : ` · Variante ${variant.label}`;
        const label = `${symbol} ${mode}${variantLabel} · Kosten ${costProfile} · Regime ${regimePolicy}`;
        const startedAt = Date.now();
        const result = runShadowReplay(market, replayConfig);
        const durationMs = Date.now() - startedAt;
        const id =
          options.persist === false
            ? null
            : await persistRun(database, {
                label,
                costProfile,
                durationMs,
                result
              });
        runs.push({ id, label, costProfile, durationMs, result });
        logger.info(
          {
            label,
            cycles: result.funnel.cycles,
            candidates: result.funnel.candidates,
            approved: result.funnel.riskApproved,
            trades: result.trades.length,
            finalEquity: result.finalEquity,
            invariantViolations: result.invariantViolations,
            durationMs
          },
          "shadow replay finished"
        );
      }
    }
  }
  return runs;
}

function defaultSplit(
  hourly: ReplaySeries["candles"]["1h"] & object,
  from?: string,
  to?: string
): string {
  const fromMs = from === undefined ? hourly[0].closeTime : Date.parse(from);
  const toMs =
    to === undefined ? hourly[hourly.length - 1].closeTime : Date.parse(to);
  // Warm-up (200 daily candles) is not tradable; split the tradable part 70/30.
  const tradableFrom = Math.max(
    fromMs,
    hourly[0].closeTime + 200 * 24 * 3600_000
  );
  return new Date(tradableFrom + (toMs - tradableFrom) * 0.7).toISOString();
}

async function loadDatabaseMarket(
  database: PrismaClient,
  symbol: string
): Promise<ReplayMarketData> {
  const symbols = [
    ...new Set([symbol, ...CRYPTO_SERIES, ...EQUITY_BENCHMARKS])
  ];
  const series: ReplaySeries[] = [];
  let synthetic = false;
  for (const name of symbols) {
    const asset = await database.asset.findFirst({
      where: { symbol: name },
      orderBy: { createdAt: "asc" }
    });
    if (asset === null) continue;
    const timeframes =
      CRYPTO_SERIES.includes(name) || name === symbol
        ? TIMEFRAMES
        : (["1d"] as const);
    const candles: Partial<
      Record<ReplayTimeframe, ReplaySeries["candles"]["1h"]>
    > = {};
    let source = "BINANCE";
    for (const timeframe of timeframes) {
      const rows = await database.candle.findMany({
        where: { assetId: asset.id, timeframe },
        orderBy: { openTime: "asc" },
        select: {
          openTime: true,
          closeTime: true,
          open: true,
          high: true,
          low: true,
          close: true,
          volume: true,
          source: true
        }
      });
      if (rows.length === 0) continue;
      source = rows[rows.length - 1].source;
      if (rows.some((row) => row.source === "SYNTHETIC")) synthetic = true;
      candles[timeframe] = rows.map((row) => ({
        openTime: row.openTime.getTime(),
        closeTime: row.closeTime.getTime(),
        open: row.open.toString(),
        high: row.high.toString(),
        low: row.low.toString(),
        close: row.close.toString(),
        volume: row.volume.toString()
      }));
    }
    if (Object.keys(candles).length === 0) continue;
    series.push({
      symbol: name,
      assetType:
        asset.assetType === "CRYPTO"
          ? "CRYPTO"
          : asset.assetType === "ETF"
            ? "ETF"
            : "STOCK",
      source,
      candles
    });
  }
  return { series, origin: "DATABASE", synthetic };
}

/**
 * Gzip-CSV snapshots `<SYMBOL>-<tf>.csv.gz` of the traded symbol and every
 * regime benchmark found in `dir`. An optional `sources.json` names the
 * provider per symbol (e.g. FRED index proxies for SPY/QQQ).
 */
export async function loadSnapshotMarket(
  dir: string,
  symbol: string
): Promise<ReplayMarketData> {
  const sourcesPath = resolve(dir, "sources.json");
  const sources = existsSync(sourcesPath)
    ? (JSON.parse(readFileSync(sourcesPath, "utf8")) as Record<string, { provider?: string }>)
    : {};
  const symbols = [
    ...new Set([symbol, ...CRYPTO_SERIES, ...EQUITY_BENCHMARKS])
  ];
  const series: ReplaySeries[] = [];
  for (const name of symbols) {
    const candles: Partial<
      Record<ReplayTimeframe, ReplaySeries["candles"]["1h"]>
    > = {};
    for (const timeframe of TIMEFRAMES) {
      const path = resolve(dir, candleSnapshotFileName(name, timeframe));
      if (!existsSync(path)) continue;
      candles[timeframe] = (
        await readCandleSnapshot(path, name, timeframe)
      ).map((candle) => ({
        openTime: candle.openTime.getTime(),
        closeTime: candle.closeTime.getTime(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume
      }));
    }
    if (Object.keys(candles).length === 0) continue;
    series.push({
      symbol: name,
      assetType: EQUITY_BENCHMARKS.includes(name) ? "ETF" : "CRYPTO",
      source: sources[name]?.provider ?? "BINANCE",
      candles
    });
  }
  return { series, origin: `SNAPSHOT:${dir}`, synthetic: false };
}

async function persistRun(
  database: PrismaClient,
  run: {
    label: string;
    costProfile: string;
    durationMs: number;
    result: ReplayResult;
  }
): Promise<string> {
  const { result } = run;
  const created = await database.shadowReplayRun.create({
    data: {
      label: run.label,
      symbol: result.config.symbol,
      strategyKey: result.config.strategyKey,
      mode: result.config.mode,
      regimePolicy: result.config.regimePolicy,
      costProfile: run.costProfile,
      dataOrigin: result.origin,
      isSynthetic: result.synthetic,
      engineVersion: result.engineVersion,
      codeVersion: result.config.codeVersion,
      firstAnchorAt:
        result.firstAnchorAt === null ? null : new Date(result.firstAnchorAt),
      lastAnchorAt:
        result.lastAnchorAt === null ? null : new Date(result.lastAnchorAt),
      cycles: result.funnel.cycles,
      candidates: result.funnel.candidates,
      closedTrades: result.trades.length,
      startingCash: result.startingCash,
      finalEquity: result.finalEquity,
      outputHash: result.outputHash,
      durationMs: run.durationMs,
      configJson: result.config as object,
      funnelJson: result.funnel as object,
      metricsJson: result.metrics as object,
      tradesJson: result.trades as unknown as object,
      equityCurveJson: result.equityCurve as unknown as object,
      notesJson: result.notes as unknown as object
    },
    select: { id: true }
  });
  return created.id;
}

function listEnv(name: string): string[] | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === ""
    ? undefined
    : value.split(",").map((entry) => entry.trim());
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runShadowReplayJob(prisma, {
    symbol: process.env.REPLAY_SYMBOL,
    strategyKey: process.env.REPLAY_STRATEGY,
    variants: listEnv("REPLAY_VARIANTS"),
    modes: listEnv("REPLAY_MODES") as ReplayMode[] | undefined,
    costProfiles: listEnv("REPLAY_COST_PROFILES"),
    regimePolicy:
      (process.env.REPLAY_REGIME_POLICY as RegimePolicy | "AUTO" | undefined) ??
      "AUTO",
    from: process.env.REPLAY_FROM,
    to: process.env.REPLAY_TO,
    splitAt: process.env.REPLAY_SPLIT_AT,
    snapshotDir: process.env.REPLAY_SNAPSHOT_DIR,
    persist: process.env.REPLAY_PERSIST !== "false"
  })
    .then((runs) => {
      for (const run of runs) {
        const { result } = run;
        const overall = result.metrics.overall;
        console.log(
          [
            `\n${run.label}${result.synthetic ? "  [SYNTHETISCH]" : ""}`,
            `  Zeitraum ${result.firstAnchorAt} → ${result.lastAnchorAt} · ${result.funnel.cycles} Stundenzyklen`,
            `  Kandidaten ${result.funnel.candidates} · Risk-OK ${result.funnel.riskApproved} · abgelehnt ${result.funnel.riskRejected} · Trades ${result.trades.length}`,
            `  Endkapital ${Number(result.finalEquity).toFixed(2)} USDT · Rendite ${overall.returnPct ?? "–"} % · Trefferquote ${overall.winRatePct ?? "–"} % · Profit Factor ${overall.profitFactor ?? "–"} · Max. Drawdown ${overall.maxDrawdownPct ?? "–"} %`,
            `  Buy & Hold ${overall.buyAndHoldReturnPct ?? "–"} % (Max. Drawdown ${overall.buyAndHoldMaxDrawdownPct ?? "–"} %) · Zeit im Markt ${overall.exposurePct ?? "–"} %`,
            ...[result.metrics.training, result.metrics.test].flatMap(
              (period) =>
                period === null
                  ? []
                  : [
                      `  ${period.label}: ${period.closedTrades} Trades · Rendite ${period.returnPct ?? "–"} % · PF ${period.profitFactor ?? "–"} · Buy & Hold ${period.buyAndHoldReturnPct ?? "–"} %`
                    ]
            ),
            `  Häufigste Strategie-Ablehnungen: ${Object.entries(
              result.funnel.strategyReasons
            )
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([code, count]) => `${code} ${count}`)
              .join(", ")}`,
            `  Invariantenverletzungen ${result.invariantViolations} · ${run.id === null ? "nicht gespeichert" : `gespeichert als ${run.id}`}`
          ].join("\n")
        );
      }
    })
    .catch((error) => {
      logger.error({ error }, `${JOB_NAME} failed`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

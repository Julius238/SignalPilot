/**
 * 24/7 operating health from persisted state: is the market data fresh and
 * real, did every scheduled job (data pipeline, trading, arena) complete
 * recently, when did the trading worker last (re)start, and what do the
 * sessions, kill switches and critical risk events say.
 *
 * One definition of "stale" for the alert collector (which turns it into
 * outbox alerts), the operator `monitor` command and the API. Read-only.
 */

import {
  BotRunStatus,
  RiskSeverity,
  TradingSessionStatus,
  type PrismaClient
} from "@signalpilot/database";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** BotRun name the trading worker records once per process start. */
export const WORKER_STARTUP_JOB_NAME = "tradingWorkerStartup";

/** Symbols the strategies and the crypto-native regime decide on. */
export const OPS_MARKET_DATA_SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;
/**
 * A 1h candle closes at hh:59:59.999 and the data worker fetches it at the
 * next full hour. Older than two hours plus a margin means at least one full
 * cycle was missed.
 */
export const MARKET_DATA_MAX_AGE_MS = 2 * HOUR_MS + 10 * MINUTE_MS;

/**
 * Last successful run each job must have had. The margin covers one missed
 * tick plus the job's own runtime, so a single late tick does not alert.
 */
export const OPS_JOB_EXPECTATIONS: readonly {
  readonly jobName: string;
  readonly label: string;
  readonly maxAgeMs: number;
}[] = [
  { jobName: "fetchCryptoCandles", label: "Daten-Worker: Binance-Kerzen", maxAgeMs: 75 * MINUTE_MS },
  { jobName: "calculateMarketRegime", label: "Daten-Worker: Marktregime", maxAgeMs: 75 * MINUTE_MS },
  { jobName: "shadowGenerateCandidates", label: "Candidate-Scan", maxAgeMs: 75 * MINUTE_MS },
  { jobName: "shadowAssessRisk", label: "Risk-Lauf", maxAgeMs: 10 * MINUTE_MS },
  { jobName: "shadowCreateOrders", label: "Order-Lauf", maxAgeMs: 10 * MINUTE_MS },
  { jobName: "shadowProcessFills", label: "Fill-Lauf", maxAgeMs: 10 * MINUTE_MS },
  { jobName: "shadowMonitorPositions", label: "Positions-Monitor", maxAgeMs: 10 * MINUTE_MS },
  { jobName: "shadowReconcilePortfolio", label: "Reconciliation", maxAgeMs: 15 * MINUTE_MS },
  { jobName: "shadowPerformanceRefresh", label: "Performance-Refresh", maxAgeMs: 75 * MINUTE_MS },
  { jobName: "arenaEvaluate", label: "Arena-Bewertung", maxAgeMs: 75 * MINUTE_MS },
  { jobName: "shadowStartTradingDay", label: "Tagesstart", maxAgeMs: 26 * HOUR_MS }
];

export interface OpsMarketDataHealth {
  readonly symbol: string;
  readonly latestCloseTime: string | null;
  readonly source: string | null;
  readonly ageMinutes: number | null;
  readonly ok: boolean;
  readonly problem: "MISSING" | "STALE" | "NOT_BINANCE" | null;
}

export interface OpsJobHealth {
  readonly jobName: string;
  readonly label: string;
  readonly lastSuccessAt: string | null;
  readonly lastStatus: string | null;
  readonly ageMinutes: number | null;
  readonly maxAgeMinutes: number;
  /** A job that never ran is reported, but only a stalled one is a problem. */
  readonly neverRan: boolean;
  readonly ok: boolean;
}

export interface OpsSessionHealth {
  readonly portfolioKey: string;
  readonly portfolioStatus: string;
  readonly sessionStatus: string | null;
  readonly killSwitchEngaged: boolean | null;
  readonly killReasonCode: string | null;
  readonly unacknowledgedCriticalRiskEvents: number;
}

export interface OpsHealthReport {
  readonly asOf: string;
  readonly ok: boolean;
  readonly marketData: readonly OpsMarketDataHealth[];
  readonly jobs: readonly OpsJobHealth[];
  readonly lastWorkerStartAt: string | null;
  readonly workerStartsLast24h: number;
  readonly sessions: readonly OpsSessionHealth[];
}

const minutes = (ms: number) => Math.floor(ms / MINUTE_MS);

export async function collectOpsHealth(database: PrismaClient, asOf: Date): Promise<OpsHealthReport> {
  const marketData: OpsMarketDataHealth[] = [];
  for (const symbol of OPS_MARKET_DATA_SYMBOLS) {
    const candle = await database.candle.findFirst({
      where: { symbol, timeframe: "1h", closeTime: { lte: asOf } },
      orderBy: { closeTime: "desc" },
      select: { closeTime: true, source: true }
    });
    const ageMs = candle === null ? null : asOf.getTime() - candle.closeTime.getTime();
    const problem =
      candle === null ? "MISSING" : candle.source !== "BINANCE" ? "NOT_BINANCE" : ageMs! > MARKET_DATA_MAX_AGE_MS ? "STALE" : null;
    marketData.push({
      symbol,
      latestCloseTime: candle?.closeTime.toISOString() ?? null,
      source: candle?.source ?? null,
      ageMinutes: ageMs === null ? null : minutes(ageMs),
      ok: problem === null,
      problem
    });
  }

  const jobs: OpsJobHealth[] = [];
  for (const expectation of OPS_JOB_EXPECTATIONS) {
    const [lastSuccess, last] = await Promise.all([
      database.botRun.findFirst({
        where: { jobName: expectation.jobName, status: BotRunStatus.SUCCESS },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true }
      }),
      database.botRun.findFirst({
        where: { jobName: expectation.jobName },
        orderBy: { startedAt: "desc" },
        select: { status: true }
      })
    ]);
    const ageMs = lastSuccess === null ? null : asOf.getTime() - lastSuccess.startedAt.getTime();
    const neverRan = last === null;
    jobs.push({
      jobName: expectation.jobName,
      label: expectation.label,
      lastSuccessAt: lastSuccess?.startedAt.toISOString() ?? null,
      lastStatus: last?.status ?? null,
      ageMinutes: ageMs === null ? null : minutes(ageMs),
      maxAgeMinutes: minutes(expectation.maxAgeMs),
      neverRan,
      // Ran before but never succeeded, or succeeded too long ago.
      ok: neverRan || (ageMs !== null && ageMs <= expectation.maxAgeMs)
    });
  }

  const [lastStart, startsLast24h, portfolios] = await Promise.all([
    database.botRun.findFirst({
      where: { jobName: WORKER_STARTUP_JOB_NAME },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true }
    }),
    database.botRun.count({
      where: { jobName: WORKER_STARTUP_JOB_NAME, startedAt: { gte: new Date(asOf.getTime() - 24 * HOUR_MS) } }
    }),
    database.portfolio.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, key: true, status: true }
    })
  ]);

  const sessions: OpsSessionHealth[] = [];
  for (const portfolio of portfolios) {
    const [session, critical] = await Promise.all([
      database.tradingSession.findFirst({
        where: { portfolioId: portfolio.id, status: { not: TradingSessionStatus.CLOSED } },
        orderBy: { createdAt: "desc" },
        select: { status: true, killSwitchEngaged: true, killReasonCode: true }
      }),
      database.riskEvent.count({
        where: { portfolioId: portfolio.id, severity: RiskSeverity.CRITICAL, acknowledgedAt: null }
      })
    ]);
    sessions.push({
      portfolioKey: portfolio.key,
      portfolioStatus: portfolio.status,
      sessionStatus: session?.status ?? null,
      killSwitchEngaged: session?.killSwitchEngaged ?? null,
      killReasonCode: session?.killReasonCode ?? null,
      unacknowledgedCriticalRiskEvents: critical
    });
  }

  const sessionsOk = sessions.every(
    (session) =>
      session.unacknowledgedCriticalRiskEvents === 0 &&
      session.sessionStatus !== TradingSessionStatus.ERROR_LOCKED &&
      session.sessionStatus !== TradingSessionStatus.KILLED &&
      // A kill switch engaged by a rule (with a reason) is a stop; the
      // bootstrap state (stopped, engaged, no reason) is not.
      !(session.killSwitchEngaged === true && session.killReasonCode !== null)
  );
  return {
    asOf: asOf.toISOString(),
    ok: marketData.every((entry) => entry.ok) && jobs.every((entry) => entry.ok) && sessionsOk,
    marketData,
    jobs,
    lastWorkerStartAt: lastStart?.startedAt.toISOString() ?? null,
    workerStartsLast24h: startsLast24h,
    sessions
  };
}

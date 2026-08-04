/**
 * Shadow-Eligibility-Report (P8, "7. Shadow-Eligibility-Report").
 *
 * Answers exactly one question — "is SignalPilot ready for a longer shadow
 * test phase?" — as `READY`, `NOT_READY` or `ERROR`, with a concrete reason
 * per failed check.
 *
 * The report is strictly read-only. It contains no write of any kind: no
 * activation, no flag change, no session transition, no bootstrap, no
 * migration. Running it a thousand times changes nothing (P8: "Der Report darf
 * nichts aktivieren").
 *
 * A single failed BLOCKER check makes the whole report `NOT_READY` — there is
 * no "mostly ready". `ERROR` is reserved for the report itself failing to
 * establish the facts (a database error), which is not the same as knowing the
 * system is not ready.
 */

import {
  InstrumentExecutionProfileStatus,
  PortfolioStatus,
  RiskLimitSetStatus,
  RiskSeverity,
  ShadowOrderStatus,
  ShadowPositionStatus,
  StrategyStatus,
  StrategyVersionStatus,
  TradingAlertOutboxStatus,
  TradingSessionStatus,
  type PrismaClient
} from "@signalpilot/database";
import {
  RISK_FRESHNESS_LIMITS_MS,
  RISK_LIMIT_SET_KEY,
  RISK_LIMIT_SET_SPECIFICATION_HASH,
  RISK_LIMIT_SET_VERSION
} from "@signalpilot/risk-engine";
import {
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
  CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
  CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS,
  CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH,
  CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_V1_KEY,
  CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
  TIMEFRAME_INTERVAL_MS,
  type StrategyTimeframe
} from "@signalpilot/strategy-engine";
import { DecimalValue, TradeDirection } from "@signalpilot/trading-domain";

import {
  CircuitBreakerScope,
  evaluateCircuitBreaker
} from "./circuitBreaker.js";
import { checkShadowBaseAllowed, type EnvSource } from "./tradingSafety.js";

export const EligibilityStatus = {
  READY: "READY",
  NOT_READY: "NOT_READY",
  ERROR: "ERROR"
} as const;
export type EligibilityStatus =
  (typeof EligibilityStatus)[keyof typeof EligibilityStatus];

export const CheckOutcome = {
  PASS: "PASS",
  FAIL: "FAIL",
  /** True but not disqualifying — the operator should still see it. */
  WARN: "WARN"
} as const;
export type CheckOutcome = (typeof CheckOutcome)[keyof typeof CheckOutcome];

export interface EligibilityCheck {
  readonly code: string;
  readonly label: string;
  readonly outcome: CheckOutcome;
  /** A failed BLOCKER makes the whole report NOT_READY; a WARN never does. */
  readonly blocking: boolean;
  readonly reason: string;
  readonly details?: Record<string, unknown>;
}

export interface EligibilityReport {
  readonly status: EligibilityStatus;
  readonly asOf: string;
  readonly reportVersion: string;
  readonly checks: readonly EligibilityCheck[];
  readonly blockingFailures: readonly string[];
  readonly warnings: readonly string[];
}

export const ELIGIBILITY_REPORT_VERSION = "shadow-eligibility-v3";

/** Heartbeat age past which the worker counts as absent. */
const HEARTBEAT_STALE_MS = 15 * 60_000;
/** Reconciliation age past which the ledger check counts as stale. */
const RECONCILE_STALE_MS = RISK_FRESHNESS_LIMITS_MS.portfolioSnapshot;
const SHADOW_PORTFOLIO_KEY = "SHADOW_V1";
const P9_SYMBOL = "BTCUSDT";
const P9_TIMEFRAMES: readonly StrategyTimeframe[] = ["1h", "4h", "1d"];
const MIN_CANDLES: Readonly<Record<StrategyTimeframe, number>> = {
  "1h": 500,
  "4h": CRYPTO_MTF_BREAKOUT_V1_PARAMETERS.minimumCandlesPerTimeframe,
  "1d": CRYPTO_MTF_BREAKOUT_V1_PARAMETERS.minimumCandlesPerTimeframe
};
const STRATEGY_IDENTITIES = new Map([
  [
    CRYPTO_MTF_BREAKOUT_V1_KEY,
    {
      direction: TradeDirection.LONG,
      engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
      specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
      parameters: CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
      legacy: true
    }
  ],
  [
    CRYPTO_MTF_BREAKOUT_LONG_V1_KEY,
    {
      direction: TradeDirection.LONG,
      engineVersion: CRYPTO_MTF_BREAKOUT_LONG_V1_ENGINE_VERSION,
      specificationHash: CRYPTO_MTF_BREAKOUT_LONG_V1_SPECIFICATION_HASH,
      parameters: CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS,
      legacy: false
    }
  ],
  [
    CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
    {
      direction: TradeDirection.SHORT,
      engineVersion: CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
      specificationHash: CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
      parameters: CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS,
      legacy: false
    }
  ]
] as const);

const pass = (
  code: string,
  label: string,
  reason: string,
  details?: Record<string, unknown>
): EligibilityCheck => ({
  code,
  label,
  outcome: CheckOutcome.PASS,
  blocking: true,
  reason,
  details
});

const fail = (
  code: string,
  label: string,
  reason: string,
  details?: Record<string, unknown>
): EligibilityCheck => ({
  code,
  label,
  outcome: CheckOutcome.FAIL,
  blocking: true,
  reason,
  details
});

const warn = (
  code: string,
  label: string,
  reason: string,
  details?: Record<string, unknown>
): EligibilityCheck => ({
  code,
  label,
  outcome: CheckOutcome.WARN,
  blocking: false,
  reason,
  details
});

export interface BuildEligibilityReportOptions {
  readonly asOf: Date;
  readonly env?: EnvSource;
}

/**
 * Gather every fact and grade it. Only reads; never writes.
 */
export async function buildEligibilityReport(
  database: PrismaClient,
  options: BuildEligibilityReportOptions
): Promise<EligibilityReport> {
  const asOf = options.asOf;
  const env = options.env ?? process.env;
  const checks: EligibilityCheck[] = [];

  try {
    // ── 1. Migrations present ────────────────────────────────────────────
    // The shadow trading tables are the migration's own visible effect; if a
    // query against them succeeds, the migration ran.
    const migrationProbe = await database.portfolio.count();
    checks.push(
      pass(
        "MIGRATIONS_PRESENT",
        "Migrationen vorhanden",
        "Die Shadow-Trading-Tabellen sind abfragbar.",
        {
          portfolioCount: migrationProbe
        }
      )
    );

    // ── 2. No exchange or live-trading capability ─────────────────────────
    const base = checkShadowBaseAllowed(env);
    checks.push(
      base.allowed
        ? pass(
            "SHADOW_ONLY_CAPABILITY",
            "Keine Exchange- oder Live-Trading-Capability",
            "Build ist SHADOW_ONLY, TRADING_MODE=SHADOW, ENABLE_LIVE_TRADING=false.",
            {
              buildCapability: base.flags.buildCapability,
              tradingMode: base.flags.tradingMode
            }
          )
        : fail(
            "SHADOW_ONLY_CAPABILITY",
            "Keine Exchange- oder Live-Trading-Capability",
            `Shadow-Only-Basiskonfiguration nicht erfüllt: ${base.reasonCode} — ${base.message}`
          )
    );

    // ── 3. Portfolio ──────────────────────────────────────────────────────
    const portfolio = await database.portfolio.findUnique({
      where: { key: SHADOW_PORTFOLIO_KEY }
    });

    if (portfolio === null) {
      checks.push(
        fail(
          "PORTFOLIO_PRESENT",
          "Bootstrap vollständig",
          `Portfolio ${SHADOW_PORTFOLIO_KEY} existiert nicht.`
        )
      );
    } else {
      checks.push(
        portfolio.status === PortfolioStatus.ERROR_LOCKED
          ? fail(
              "PORTFOLIO_PRESENT",
              "Bootstrap vollständig",
              `Portfolio ${portfolio.key} steht auf ERROR_LOCKED.`,
              { portfolioId: portfolio.id, status: portfolio.status }
            )
          : pass(
              "PORTFOLIO_PRESENT",
              "Bootstrap vollständig",
              `Portfolio ${portfolio.key} ist ${portfolio.status}.`,
              {
                portfolioId: portfolio.id,
                status: portfolio.status
              }
            )
      );

      // ── 4. Portfolio consistent (reconciliation fresh and clean) ────────
      const reconcileAge =
        portfolio.lastReconciledAt === null
          ? null
          : asOf.getTime() - portfolio.lastReconciledAt.getTime();
      checks.push(
        portfolio.lastReconciledAt === null
          ? fail(
              "RECONCILIATION_FRESH",
              "Reconciliation aktuell",
              "Das Portfolio wurde noch nie abgeglichen."
            )
          : reconcileAge !== null && reconcileAge > RECONCILE_STALE_MS
            ? fail(
                "RECONCILIATION_FRESH",
                "Reconciliation aktuell",
                `Letzter Abgleich liegt ${Math.floor(reconcileAge / 3_600_000)} Stunden zurück.`,
                { lastReconciledAt: portfolio.lastReconciledAt.toISOString() }
              )
            : pass(
                "RECONCILIATION_FRESH",
                "Reconciliation aktuell",
                "Der letzte Abgleich ist frisch.",
                {
                  lastReconciledAt: portfolio.lastReconciledAt.toISOString()
                }
              )
      );

      const ledgerCount = await database.portfolioLedgerEntry.count({
        where: { portfolioId: portfolio.id }
      });
      checks.push(
        ledgerCount === portfolio.ledgerSequence
          ? pass(
              "PORTFOLIO_CONSISTENT",
              "Portfolio konsistent",
              `Ledger-Sequenz ${portfolio.ledgerSequence} entspricht ${ledgerCount} Einträgen.`
            )
          : fail(
              "PORTFOLIO_CONSISTENT",
              "Portfolio konsistent",
              `Ledger-Sequenz ${portfolio.ledgerSequence} passt nicht zu ${ledgerCount} Einträgen.`,
              { ledgerSequence: portfolio.ledgerSequence, ledgerCount }
            )
      );

      const tradingDateUtc = new Date(
        `${asOf.toISOString().slice(0, 10)}T00:00:00.000Z`
      );
      const startOfDaySnapshot = await database.portfolioSnapshot.findFirst({
        where: { portfolioId: portfolio.id, tradingDateUtc }
      });
      checks.push(
        startOfDaySnapshot !== null
          ? pass(
              "START_OF_DAY_SNAPSHOT",
              "Start-of-Day-Snapshot vorhanden",
              `Snapshot für ${tradingDateUtc.toISOString()} ist vorhanden.`,
              {
                snapshotId: startOfDaySnapshot.id,
                asOf: startOfDaySnapshot.asOf.toISOString()
              }
            )
          : fail(
              "START_OF_DAY_SNAPSHOT",
              "Start-of-Day-Snapshot vorhanden",
              `Kein Snapshot für den aktuellen UTC-Tag ${tradingDateUtc.toISOString()}.`
            )
      );

      // ── 5. Session state and kill switch ────────────────────────────────
      const session = await database.tradingSession.findFirst({
        where: {
          portfolioId: portfolio.id,
          status: { not: TradingSessionStatus.CLOSED }
        },
        orderBy: { createdAt: "desc" }
      });

      if (session === null) {
        checks.push(
          fail(
            "SESSION_PRESENT",
            "Sessionzustand",
            "Es existiert keine offene TradingSession für das Portfolio."
          )
        );
      } else {
        checks.push(
          session.status === TradingSessionStatus.ERROR_LOCKED
            ? fail(
                "SESSION_NOT_ERROR_LOCKED",
                "Kein ERROR_LOCKED",
                "Die TradingSession steht auf ERROR_LOCKED.",
                {
                  sessionId: session.id,
                  killReasonCode: session.killReasonCode
                }
              )
            : pass(
                "SESSION_NOT_ERROR_LOCKED",
                "Kein ERROR_LOCKED",
                `Session-Status ist ${session.status}.`,
                {
                  sessionId: session.id,
                  status: session.status
                }
              )
        );

        // A closed kill switch is the SAFE state before a test phase, not a
        // defect — it is reported, never demanded to be open.
        checks.push(
          warn(
            "KILL_SWITCH_STATE",
            "Kill Switch",
            session.killSwitchEngaged
              ? "Kill Switch ist aktiv — das ist der sichere Ausgangszustand, muss für den Testlauf aber bewusst gelöst werden."
              : "Kill Switch ist gelöst.",
            {
              killSwitchEngaged: session.killSwitchEngaged,
              killReasonCode: session.killReasonCode
            }
          )
        );

        const heartbeatAge =
          session.heartbeatAt === null
            ? null
            : asOf.getTime() - session.heartbeatAt.getTime();
        checks.push(
          session.heartbeatAt === null
            ? warn(
                "WORKER_HEARTBEAT",
                "Scheduler-/Worker-Konfiguration",
                "Es wurde noch kein Worker-Heartbeat aufgezeichnet."
              )
            : heartbeatAge !== null && heartbeatAge > HEARTBEAT_STALE_MS
              ? fail(
                  "WORKER_HEARTBEAT",
                  "Scheduler-/Worker-Konfiguration",
                  `Der letzte Heartbeat liegt ${Math.floor(heartbeatAge / 60_000)} Minuten zurück.`,
                  { heartbeatAt: session.heartbeatAt.toISOString() }
                )
              : pass(
                  "WORKER_HEARTBEAT",
                  "Scheduler-/Worker-Konfiguration",
                  "Der Worker-Heartbeat ist frisch.",
                  {
                    heartbeatAt: session.heartbeatAt.toISOString()
                  }
                )
        );
      }

      // ── 6. No unacknowledged critical risk events ───────────────────────
      const criticalRiskEvents = await database.riskEvent.count({
        where: {
          portfolioId: portfolio.id,
          severity: RiskSeverity.CRITICAL,
          acknowledgedAt: null
        }
      });
      checks.push(
        criticalRiskEvents === 0
          ? pass(
              "NO_CRITICAL_RISK_EVENTS",
              "Keine kritischen Risk Events",
              "Keine offenen CRITICAL-Risk-Events."
            )
          : fail(
              "NO_CRITICAL_RISK_EVENTS",
              "Keine kritischen Risk Events",
              `${criticalRiskEvents} unbestätigte CRITICAL-Risk-Events.`,
              { criticalRiskEvents }
            )
      );

      // ── 7. Exact P9 scope, assignment and immutable strategy version ─────
      const allEnabledAssignments = await database.strategyAssignment.findMany({
        where: { enabled: true },
        include: { asset: true, strategy: true, strategyVersion: true },
        orderBy: { createdAt: "asc" }
      });
      const assignments = allEnabledAssignments.filter(
        (entry) => entry.portfolioId === portfolio.id
      );
      const btcAssignments = assignments.filter(
        (entry) => entry.asset.symbol === P9_SYMBOL
      );
      const foreignAssignments = allEnabledAssignments.filter(
        (entry) =>
          entry.portfolioId !== portfolio.id ||
          !CRYPTO_MTF_BREAKOUT_V1_PARAMETERS.allowedSymbols.includes(
            entry.asset.symbol as never
          ) ||
          !STRATEGY_IDENTITIES.has(entry.strategy.key as never)
      );
      checks.push(
        assignments.length > 0 &&
          btcAssignments.length > 0 &&
          foreignAssignments.length === 0
          ? pass(
              "BTC_ONLY_ASSIGNMENT",
              "Explizite Long-/Short-Assignments",
              "Alle aktivierten Assignments sind auf SHADOW_V1 und BTCUSDT/ETHUSDT begrenzt; BTCUSDT ist enthalten.",
              {
                assignments: assignments.map((entry) => ({
                  assignmentId: entry.id,
                  symbol: entry.asset.symbol,
                  strategyKey: entry.strategy.key,
                  direction:
                    typeof entry.assignmentConfigJson === "object" &&
                    entry.assignmentConfigJson !== null &&
                    !Array.isArray(entry.assignmentConfigJson)
                      ? (entry.assignmentConfigJson as Record<string, unknown>)
                          .direction
                      : "UNKNOWN"
                }))
              }
            )
          : fail(
              "BTC_ONLY_ASSIGNMENT",
              "Explizite Long-/Short-Assignments",
              `Mindestens ein BTCUSDT-Assignment in ${SHADOW_PORTFOLIO_KEY} ist erforderlich; fremde Portfolios, Assets oder Strategien blockieren.`,
              {
                symbols: allEnabledAssignments.map(
                  (entry) => entry.asset.symbol
                ),
                foreignAssignmentIds: foreignAssignments.map(
                  (entry) => entry.id
                )
              }
            )
      );

      const btcAssignment = btcAssignments[0] ?? null;
      const deployedCodeVersion = (env.TRADING_CODE_VERSION ?? "").trim();
      const strategyVersionFailures = assignments.flatMap((assignment) => {
        const identity = STRATEGY_IDENTITIES.get(
          assignment.strategy.key as never
        );
        const configJson = assignment.assignmentConfigJson;
        const assignmentDirection =
          typeof configJson === "object" &&
          configJson !== null &&
          !Array.isArray(configJson)
            ? (configJson as Record<string, unknown>).direction
            : null;
        const config =
          typeof configJson === "object" &&
          configJson !== null &&
          !Array.isArray(configJson)
            ? (configJson as Record<string, unknown>)
            : null;
        const parametersJson = assignment.strategyVersion.parametersJson;
        const strategyDirection =
          typeof parametersJson === "object" &&
          parametersJson !== null &&
          !Array.isArray(parametersJson)
            ? (parametersJson as Record<string, unknown>).direction
            : null;
        return identity !== undefined &&
          assignment.timeframe === "1h" &&
          assignment.strategy.status === StrategyStatus.ACTIVE &&
          assignment.strategyVersion.status === StrategyVersionStatus.ACTIVE &&
          assignment.strategyVersion.engineVersion === identity.engineVersion &&
          (identity.legacy ||
            assignment.strategyVersion.codeVersion === deployedCodeVersion) &&
          deployedCodeVersion !== "" &&
          assignment.strategyVersion.specificationHash ===
            identity.specificationHash &&
          assignmentDirection === identity.direction &&
          strategyDirection === identity.direction &&
          (identity.legacy ||
            (config?.leverageAllowed === false &&
              config.marginAllowed === false &&
              config.futuresAllowed === false &&
              config.syntheticShadowShort ===
                (identity.direction === TradeDirection.SHORT)))
          ? []
          : [assignment.id];
      });
      const strategyVersionValid =
        assignments.length > 0 && strategyVersionFailures.length === 0;
      checks.push(
        strategyVersionValid
          ? pass(
              "ACTIVE_STRATEGY_VERSION",
              "Aktuelle StrategyVersion",
              "Alle aktivierten Long-/Short-Versionen haben die erwartete Direction, Engine und Specification Hashes.",
              {
                assignments: assignments.map((assignment) => ({
                  assignmentId: assignment.id,
                  strategyKey: assignment.strategy.key,
                  strategyVersionId: assignment.strategyVersionId,
                  specificationHash:
                    assignment.strategyVersion.specificationHash
                }))
              }
            )
          : fail(
              "ACTIVE_STRATEGY_VERSION",
              "Aktuelle StrategyVersion",
              "Direction, ACTIVE-Status, Engine-/Code-Version, 1h-Timeframe oder Specification Hash stimmen nicht.",
              {
                expectedCodeVersion: deployedCodeVersion,
                assignmentFailures: strategyVersionFailures
              }
            )
      );

      const shortAssignments = assignments.filter(
        (assignment) =>
          assignment.strategy.key === CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY
      );
      const currentLongAssignments = assignments.filter(
        (assignment) =>
          assignment.strategy.key === CRYPTO_MTF_BREAKOUT_LONG_V1_KEY
      );
      const longFlagsValid =
        currentLongAssignments.length === 0 ||
        (base.allowed &&
          base.flags.strategyV1Enabled &&
          base.flags.strategyLongV1Enabled);
      const shortFlagsValid =
        shortAssignments.length === 0 ||
        (base.allowed &&
          base.flags.strategyV1Enabled &&
          base.flags.strategyShortV1Enabled &&
          base.flags.shadowShortEnabled &&
          base.flags.buildCapability === "SHADOW_ONLY" &&
          !base.flags.enableLiveTrading);
      checks.push(
        shortFlagsValid && longFlagsValid
          ? pass(
              "SHADOW_SHORT_FLAGS",
              "Short-Flags und Shadow-only-Capability",
              shortAssignments.length === 0
                ? "Kein Short-Assignment ist aktiv."
                : "Alle Short-Flags sind aktiv; Exchange-, Margin- und Futures-Capabilities fehlen absichtlich.",
              {
                activeShortAssignments: shortAssignments.map(
                  (assignment) => assignment.id
                ),
                activeLongAssignments: currentLongAssignments.map(
                  (assignment) => assignment.id
                ),
                strategyLongV1Enabled: base.allowed
                  ? base.flags.strategyLongV1Enabled
                  : false,
                strategyShortV1Enabled: base.allowed
                  ? base.flags.strategyShortV1Enabled
                  : false,
                shadowShortEnabled: base.allowed
                  ? base.flags.shadowShortEnabled
                  : false,
                exchangeCapability: false,
                marginCapability: false,
                futuresCapability: false
              }
            )
          : fail(
              "SHADOW_SHORT_FLAGS",
              "Short-Flags und Shadow-only-Capability",
              "Ein Short-Assignment ist aktiv, aber nicht alle Short-Flags/Shadow-only-Grenzen sind erfüllt."
            )
      );

      // ── 8. Complete BTC execution profile ────────────────────────────────
      const assignedAssets = [
        ...new Map(
          assignments.map(
            (assignment) => [assignment.assetId, assignment.asset] as const
          )
        ).entries()
      ].map(([assetId, asset]) => ({ assetId, symbol: asset.symbol }));
      const executionProfiles = await Promise.all(
        assignedAssets.map(async (asset) => ({
          ...asset,
          profile: await database.instrumentExecutionProfile.findFirst({
            where: {
              assetId: asset.assetId,
              status: InstrumentExecutionProfileStatus.ACTIVE
            },
            orderBy: { version: "desc" }
          })
        }))
      );
      const positiveDecimal = (value: unknown): boolean =>
        Number(String(value)) > 0;
      const executionProfileComplete =
        executionProfiles.length > 0 &&
        executionProfiles.every(
          ({ profile }) =>
            profile !== null &&
            positiveDecimal(profile.tickSize) &&
            positiveDecimal(profile.stepSize) &&
            positiveDecimal(profile.minQuantity) &&
            positiveDecimal(profile.minNotional) &&
            positiveDecimal(profile.maxParticipationRate) &&
            profile.feeBps >= 0 &&
            profile.fullSpreadBps >= 0 &&
            profile.slippageBps >= 0 &&
            profile.source.trim() !== "" &&
            /^[a-f0-9]{64}$/.test(profile.specificationHash)
        );
      checks.push(
        executionProfileComplete
          ? pass(
              "EXECUTION_PROFILE",
              "Execution Profiles vollständig",
              "Für jedes aktivierte Asset ist ein vollständiges aktives Profil vorhanden.",
              {
                profiles: executionProfiles.map(({ symbol, profile }) => ({
                  symbol,
                  executionProfileId: profile?.id ?? null,
                  version: profile?.version ?? null,
                  sourceObservedAt:
                    profile?.sourceObservedAt.toISOString() ?? null,
                  specificationHash: profile?.specificationHash ?? null
                }))
              }
            )
          : fail(
              "EXECUTION_PROFILE",
              "Execution Profiles vollständig",
              "Mindestens ein Profil fehlt, ist nicht ACTIVE oder enthält ungültige Filter-, Kosten-, Quellen- oder Hashwerte."
            )
      );

      // ── 9. BTC history, gaps, quality, freshness, regime and MTF inputs ──
      if (btcAssignment === null) {
        for (const [code, label] of [
          ["DATA_HISTORY", "BTCUSDT Kerzenhistorie"],
          ["CANDLE_GAPS", "Keine relevanten Kerzenlücken"],
          ["CANDLE_DATA_QUALITY", "CandleDataQuality gültig"],
          ["CANDLE_FRESHNESS", "Letzte Kerzen frisch"],
          ["REGIME_FRESHNESS", "Regime-Daten aktuell"],
          ["SIGNAL_MTF_INPUTS", "Signale und MTF-Daten vorhanden"]
        ] as const) {
          checks.push(
            fail(
              code,
              label,
              "Kein eindeutiges aktiviertes BTCUSDT-Assignment als Prüfgrundlage."
            )
          );
        }
      } else {
        const counts: Record<string, number> = {};
        const historyFailures: string[] = [];
        const gapFailures: string[] = [];
        const staleCandles: string[] = [];
        const qualityFailures: string[] = [];
        const signalFailures: string[] = [];

        for (const assignedAsset of assignedAssets) {
          const assetId = assignedAsset.assetId;
          for (const timeframe of P9_TIMEFRAMES) {
            const scope = `${assignedAsset.symbol}:${timeframe}`;
            const count = await database.candle.count({
              where: { assetId, timeframe, closeTime: { lte: asOf } }
            });
            counts[scope] = count;
            if (count < MIN_CANDLES[timeframe])
              historyFailures.push(
                `${scope}:${count}/${MIN_CANDLES[timeframe]}`
              );

            const rows = await database.candle.findMany({
              where: { assetId, timeframe, closeTime: { lte: asOf } },
              orderBy: { openTime: "desc" },
              take: Math.max(
                MIN_CANDLES[timeframe],
                CRYPTO_MTF_BREAKOUT_V1_PARAMETERS.gapFreeWindow
              )
            });
            const recent = rows
              .slice(0, CRYPTO_MTF_BREAKOUT_V1_PARAMETERS.gapFreeWindow)
              .slice()
              .reverse();
            for (let index = 1; index < recent.length; index += 1) {
              if (
                recent[index].openTime.getTime() -
                  recent[index - 1].openTime.getTime() !==
                TIMEFRAME_INTERVAL_MS[timeframe]
              ) {
                gapFailures.push(scope);
                break;
              }
            }
            if (
              recent.some(
                (candle) =>
                  candle.source.trim() === "" || candle.source === "UNKNOWN"
              )
            ) {
              gapFailures.push(`${scope}:source`);
            }
            const latest = rows[0] ?? null;
            if (
              latest === null ||
              asOf.getTime() - latest.closeTime.getTime() >
                CRYPTO_MTF_BREAKOUT_V1_PARAMETERS.maxCandleAgeMs[timeframe]
            ) {
              staleCandles.push(scope);
            }

            const quality = await database.candleDataQuality.findFirst({
              where: { assetId, timeframe },
              orderBy: { updatedAt: "desc" }
            });
            const qualityObservedAt =
              quality?.lastAuditAt ?? quality?.updatedAt ?? null;
            if (
              quality === null ||
              qualityObservedAt === null ||
              asOf.getTime() - qualityObservedAt.getTime() >
                CRYPTO_MTF_BREAKOUT_V1_PARAMETERS.maxDataQualityAgeMs ||
              quality.candleCount <
                CRYPTO_MTF_BREAKOUT_V1_PARAMETERS.minimumCandlesPerTimeframe ||
              quality.gapCount > 0 ||
              quality.missingCandleCount > 0 ||
              quality.providerErrorCount > 0 ||
              quality.entitlementErrorCount > 0 ||
              quality.noDataCount > 0 ||
              (quality.lastErrorKind !== null && quality.lastErrorKind !== "")
            ) {
              qualityFailures.push(scope);
            }

            const signal = await database.signal.findFirst({
              where: { assetId, timeframe, createdAt: { lte: asOf } },
              orderBy: { createdAt: "desc" }
            });
            if (
              signal === null ||
              asOf.getTime() - signal.createdAt.getTime() >
                CRYPTO_MTF_BREAKOUT_V1_PARAMETERS.maxSignalAgeMs[timeframe]
            ) {
              signalFailures.push(scope);
            }
          }
        }

        checks.push(
          historyFailures.length === 0
            ? pass(
                "DATA_HISTORY",
                "Long-/Short-Kerzenhistorie",
                "Alle aktivierten Assets erfüllen die 1h-/4h-/1d-Mindesthistorie.",
                { counts, minimum: MIN_CANDLES }
              )
            : fail(
                "DATA_HISTORY",
                "Long-/Short-Kerzenhistorie",
                `Unzureichende Historie: ${historyFailures.join(", ")}.`,
                {
                  counts,
                  minimum: MIN_CANDLES
                }
              )
        );
        checks.push(
          gapFailures.length === 0
            ? pass(
                "CANDLE_GAPS",
                "Keine relevanten Kerzenlücken",
                `Die letzten ${CRYPTO_MTF_BREAKOUT_V1_PARAMETERS.gapFreeWindow} Kerzen je Timeframe sind lückenlos.`
              )
            : fail(
                "CANDLE_GAPS",
                "Keine relevanten Kerzenlücken",
                `Lücken oder ungültige Quellen: ${[...new Set(gapFailures)].join(", ")}.`
              )
        );
        checks.push(
          qualityFailures.length === 0
            ? pass(
                "CANDLE_DATA_QUALITY",
                "CandleDataQuality gültig",
                "Alle drei Timeframes haben frische, fehler- und lückenfreie Quality-Datensätze."
              )
            : fail(
                "CANDLE_DATA_QUALITY",
                "CandleDataQuality gültig",
                `Ungültig oder stale: ${qualityFailures.join(", ")}.`
              )
        );
        checks.push(
          staleCandles.length === 0
            ? pass(
                "CANDLE_FRESHNESS",
                "Letzte Kerzen frisch",
                "1h-, 4h- und 1d-Anker liegen innerhalb der Strategiegrenzen."
              )
            : fail(
                "CANDLE_FRESHNESS",
                "Letzte Kerzen frisch",
                `Stale oder fehlend: ${staleCandles.join(", ")}.`
              )
        );

        const regime = await database.marketRegimeSnapshot.findFirst({
          where: { generatedAt: { lte: asOf } },
          orderBy: { generatedAt: "desc" }
        });
        const regimeFresh =
          regime !== null &&
          Number.isFinite(regime.confidence) &&
          asOf.getTime() - regime.generatedAt.getTime() <=
            CRYPTO_MTF_BREAKOUT_V1_PARAMETERS.maxRegimeAgeMs;
        checks.push(
          regimeFresh
            ? pass(
                "REGIME_FRESHNESS",
                "Regime-Daten aktuell",
                "Aktuelles, auswertbares Regime vorhanden.",
                {
                  generatedAt: regime.generatedAt.toISOString(),
                  cryptoRegime: regime.cryptoRegime,
                  riskMode: regime.riskMode,
                  confidence: regime.confidence
                }
              )
            : fail(
                "REGIME_FRESHNESS",
                "Regime-Daten aktuell",
                "Regime fehlt, ist stale oder hat keine gültige Confidence."
              )
        );
        checks.push(
          signalFailures.length === 0
            ? pass(
                "SIGNAL_MTF_INPUTS",
                "Signale und MTF-Daten vorhanden",
                "Frische 1h-/4h-/1d-Signale erlauben die deterministische MTF-Ableitung."
              )
            : fail(
                "SIGNAL_MTF_INPUTS",
                "Signale und MTF-Daten vorhanden",
                `Fehlende oder stale Signale: ${signalFailures.join(", ")}.`
              )
        );
      }

      // ── 10. Circuit breakers closed ─────────────────────────────────────
      const breakerJobs = [
        {
          jobKey: "trading:monitor-positions",
          scope: CircuitBreakerScope.MONITORING
        },
        { jobKey: "trading:reconcile", scope: CircuitBreakerScope.MONITORING }
      ] as const;
      const openBreakers: string[] = [];
      for (const job of breakerJobs) {
        const breaker = await evaluateCircuitBreaker(database, {
          jobKey: job.jobKey,
          portfolioId: portfolio.id,
          scope: job.scope,
          asOf
        });
        if (!breaker.allowed)
          openBreakers.push(
            `${job.jobKey}:${breaker.reasonCode ?? breaker.state}`
          );
      }
      checks.push(
        openBreakers.length === 0
          ? pass(
              "CIRCUIT_BREAKERS_CLOSED",
              "Circuit Breaker",
              "Kein Monitoring-Circuit-Breaker ist offen."
            )
          : fail(
              "CIRCUIT_BREAKERS_CLOSED",
              "Circuit Breaker",
              `Offene Circuit Breaker: ${openBreakers.join(", ")}.`,
              {
                openBreakers
              }
            )
      );

      const [activePositions, activeEntryOrders] = await Promise.all([
        database.shadowPosition.findMany({
          where: {
            portfolioId: portfolio.id,
            status: {
              in: [
                ShadowPositionStatus.OPENING,
                ShadowPositionStatus.OPEN,
                ShadowPositionStatus.PARTIALLY_CLOSED,
                ShadowPositionStatus.ERROR
              ]
            }
          },
          select: {
            id: true,
            assetId: true,
            direction: true,
            reservedCollateral: true
          }
        }),
        database.shadowOrder.findMany({
          where: {
            portfolioId: portfolio.id,
            purpose: "ENTRY",
            status: {
              in: [
                ShadowOrderStatus.ACCEPTED,
                ShadowOrderStatus.WAITING_FOR_ENTRY,
                ShadowOrderStatus.PARTIALLY_FILLED
              ]
            }
          },
          select: {
            id: true,
            assetId: true,
            direction: true,
            shadowPositionId: true,
            reservedQuoteAmount: true
          }
        })
      ]);
      const opposingScopes = activeEntryOrders.filter((order) =>
        activePositions.some(
          (position) =>
            position.assetId === order.assetId &&
            position.id !== order.shadowPositionId &&
            position.direction !== order.direction
        )
      );
      const duplicateOrderAssets = activeEntryOrders.filter(
        (order, index, orders) =>
          orders.findIndex(
            (candidate) => candidate.assetId === order.assetId
          ) !== index
      );
      checks.push(
        opposingScopes.length === 0 && duplicateOrderAssets.length === 0
          ? pass(
              "NO_OPPOSING_ACTIVE_SCOPES",
              "Keine gegensätzlichen aktiven Orders oder Positionen",
              "Richtungsfreie Asset-Scopes sind eindeutig."
            )
          : fail(
              "NO_OPPOSING_ACTIVE_SCOPES",
              "Keine gegensätzlichen aktiven Orders oder Positionen",
              "Gegensätzliche oder doppelte aktive Entry-Scopes wurden gefunden.",
              {
                opposingOrderIds: opposingScopes.map((order) => order.id),
                duplicateOrderIds: duplicateOrderAssets.map((order) => order.id)
              }
            )
      );

      const collateralShapeValid = activePositions.every((position) => {
        const collateral = DecimalValue.fromString(
          String(position.reservedCollateral)
        );
        return position.direction === TradeDirection.LONG
          ? collateral.isZero()
          : position.direction === TradeDirection.SHORT &&
              collateral.isPositive();
      });
      const representedReserve = DecimalValue.sum([
        ...activeEntryOrders.map((order) =>
          DecimalValue.fromString(String(order.reservedQuoteAmount))
        ),
        ...activePositions
          .filter((position) => position.direction === TradeDirection.SHORT)
          .map((position) =>
            DecimalValue.fromString(String(position.reservedCollateral))
          )
      ]);
      const reserveMatches = representedReserve
        .sub(DecimalValue.fromString(String(portfolio.reservedCash)))
        .abs()
        .lte(DecimalValue.fromString("0.00000001"));
      checks.push(
        collateralShapeValid && reserveMatches
          ? pass(
              "SHORT_COLLATERAL_CONSISTENT",
              "Short-Collateral und Portfolio konsistent",
              "Typed Short-Collateral plus offene Entry-Reserven entsprechen reservedCash."
            )
          : fail(
              "SHORT_COLLATERAL_CONSISTENT",
              "Short-Collateral und Portfolio konsistent",
              "Collateral fehlt, ist für LONG gesetzt oder passt nicht zur Portfolio-Reserve.",
              {
                representedReserve: representedReserve.toString(),
                reservedCash: String(portfolio.reservedCash)
              }
            )
      );

      // ── 11. Every open position has a live exit plan ────────────────────
      const positionsWithoutExit = await database.shadowPosition.count({
        where: {
          portfolioId: portfolio.id,
          status: {
            in: [
              ShadowPositionStatus.OPENING,
              ShadowPositionStatus.OPEN,
              ShadowPositionStatus.PARTIALLY_CLOSED,
              ShadowPositionStatus.ERROR
            ]
          },
          activeExitPlanVersion: null
        }
      });
      checks.push(
        positionsWithoutExit === 0
          ? pass(
              "POSITIONS_HAVE_EXITS",
              "Positionen mit sicherem Exit",
              "Jede offene Position hat einen aktiven ExitPlan."
            )
          : fail(
              "POSITIONS_HAVE_EXITS",
              "Positionen mit sicherem Exit",
              `${positionsWithoutExit} offene Positionen ohne aktiven ExitPlan.`,
              { positionsWithoutExit }
            )
      );
    }

    // ── 12. Valid risk limit set ──────────────────────────────────────────
    const activeLimitSet = await database.riskLimitSet.findFirst({
      where: {
        key: RISK_LIMIT_SET_KEY,
        version: RISK_LIMIT_SET_VERSION,
        status: RiskLimitSetStatus.ACTIVE
      }
    });
    const activeLimitSetValid =
      activeLimitSet !== null &&
      activeLimitSet.specificationHash === RISK_LIMIT_SET_SPECIFICATION_HASH;
    checks.push(
      !activeLimitSetValid
        ? fail(
            "ACTIVE_RISK_LIMIT_SET",
            "Gültiges RiskLimitSet",
            `Kein aktives ${RISK_LIMIT_SET_KEY} v${RISK_LIMIT_SET_VERSION} mit aktuellem Specification Hash vorhanden.`,
            { expectedSpecificationHash: RISK_LIMIT_SET_SPECIFICATION_HASH }
          )
        : pass(
            "ACTIVE_RISK_LIMIT_SET",
            "Gültiges RiskLimitSet",
            `RiskLimitSet ${activeLimitSet.key} v${activeLimitSet.version} ist aktiv.`,
            {
              riskLimitSetId: activeLimitSet.id,
              version: activeLimitSet.version,
              specificationHash: activeLimitSet.specificationHash
            }
          )
    );

    // ── 13. Alert outbox operable ─────────────────────────────────────────
    const [deadAlerts, pendingAlerts] = await Promise.all([
      database.tradingAlertOutbox.count({
        where: { status: TradingAlertOutboxStatus.DEAD }
      }),
      database.tradingAlertOutbox.count({
        where: { status: TradingAlertOutboxStatus.PENDING }
      })
    ]);
    checks.push(
      deadAlerts === 0
        ? pass(
            "ALERT_OUTBOX_HEALTHY",
            "Alert-Outbox funktionsfähig",
            "Keine Dead-Letter-Einträge in der Outbox.",
            {
              pendingAlerts
            }
          )
        : fail(
            "ALERT_OUTBOX_HEALTHY",
            "Alert-Outbox funktionsfähig",
            `${deadAlerts} Alerts konnten endgültig nicht zugestellt werden.`,
            { deadAlerts, pendingAlerts }
          )
    );
    checks.push(
      base.allowed && base.flags.alertOutboxEnabled
        ? pass(
            "ALERT_OUTBOX_ENABLED",
            "Alert-Outbox aktiviert",
            "TRADING_ALERT_OUTBOX_ENABLED ist true."
          )
        : fail(
            "ALERT_OUTBOX_ENABLED",
            "Alert-Outbox aktiviert",
            "TRADING_ALERT_OUTBOX_ENABLED ist nicht true — sicherheitsrelevante Ereignisse würden nicht erfasst."
          )
    );
  } catch (error) {
    // The report could not establish the facts. That is explicitly not the
    // same as "the system is not ready" and is reported as its own status.
    return {
      status: EligibilityStatus.ERROR,
      asOf: asOf.toISOString(),
      reportVersion: ELIGIBILITY_REPORT_VERSION,
      checks: [
        {
          code: "REPORT_FAILED",
          label: "Report konnte nicht erstellt werden",
          outcome: CheckOutcome.FAIL,
          blocking: true,
          reason:
            error instanceof Error
              ? error.message
              : "Unbekannter Fehler beim Erstellen des Reports."
        }
      ],
      blockingFailures: ["REPORT_FAILED"],
      warnings: []
    };
  }

  const blockingFailures = checks
    .filter((check) => check.blocking && check.outcome === CheckOutcome.FAIL)
    .map((check) => check.code);
  const warnings = checks
    .filter((check) => check.outcome === CheckOutcome.WARN)
    .map((check) => check.code);

  return {
    status:
      blockingFailures.length === 0
        ? EligibilityStatus.READY
        : EligibilityStatus.NOT_READY,
    asOf: asOf.toISOString(),
    reportVersion: ELIGIBILITY_REPORT_VERSION,
    checks,
    blockingFailures,
    warnings
  };
}

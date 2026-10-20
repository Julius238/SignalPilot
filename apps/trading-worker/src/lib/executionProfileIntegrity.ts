/**
 * One trusted reference and one integrity check for stored
 * `InstrumentExecutionProfile` rows.
 *
 * Specification: docs/trading/decisions/0023-execution-profile-value-integrity.md,
 * option W.
 *
 * Fee, spread, slippage and the instrument filters drive sizing, R-007,
 * R-008, R-018, R-019, R-025, every fill, every exit and every valuation. The
 * trusted reference is the approved profile pinned below, never the row: a
 * row that copies the expected hash but carries other numbers must not vouch
 * for itself. Decimals are compared by value (`0.01` = `0.010000000000`),
 * anything unreadable counts as a deviation, nothing is defaulted.
 *
 * Every worker read path shares this module — eligibility, session
 * activation, risk job, order creation, entry fill, exit and valuation — so
 * there is exactly one definition of "approved":
 *   - a path that can open exposure refuses a deviating profile and locks the
 *     portfolio for new entries (`engageExecutionProfileIntegrityLock`);
 *   - a risk-reducing path (exit, valuation) never blocks on it: it prices
 *     with the approved reference instead of the deviating row, so an open
 *     position can still be closed.
 *
 * Deliberately not part of the risk engine (R-026): replays and evolution
 * runs evaluate risk with their own, explicitly configured cost profiles and
 * never read a stored row.
 */

import {
  RiskEventType,
  RiskSeverity,
  TradingActorType,
  TradingSessionStatus,
  PortfolioStatus,
  Prisma,
  type PrismaClient
} from "@signalpilot/database";
import {
  DecimalValue,
  buildAuditEventKey,
  buildRiskEventKey,
  buildSpecificationHash
} from "@signalpilot/trading-domain";

import { decimalString } from "./shadowPortfolioIo.js";

/** An execution profile approved for shadow trading (ADR 0023). */
export interface ApprovedExecutionProfileV1 {
  readonly symbol: string;
  readonly version: number;
  readonly source: string;
  readonly tickSize: string;
  readonly stepSize: string;
  readonly minQuantity: string;
  readonly minNotional: string;
  readonly maxQuantity: string | null;
  readonly feeBps: number;
  readonly fullSpreadBps: number;
  readonly slippageBps: number;
  readonly maxParticipationRate: string;
  /**
   * `buildSpecificationHash` over every other field, pinned as text. The
   * tests recompute it, so values and hash cannot drift apart silently.
   */
  readonly specificationHash: string;
}

const BINANCE_SPOT_VIP0_ESTIMATE_V1_COSTS = Object.freeze({
  feeBps: 10,
  fullSpreadBps: 2,
  slippageBps: 3,
  maxParticipationRate: "0.010000000000",
  source: "BINANCE_SPOT_VIP0_ESTIMATE_V1"
});

/**
 * Every execution profile approved for shadow trading, oldest first per
 * symbol; the highest version of a symbol is the current one.
 *
 * BTCUSDT v2 is the frozen `OFFICIAL_V1` cost profile
 * (docs/trading/research/official-forward-test-v1.md, hash `0fba0118…`):
 * the bootstrap's instrument filters plus `BINANCE_SPOT_VIP0_ESTIMATE_V1`,
 * exactly what `shadow:calibrate-execution-profile` writes. The bootstrap
 * placeholder `MANUAL_CONSERVATIVE_V1` (v1) is not approved; it is the
 * pre-calibration state in which no entry may be made. A new profile is a new
 * entry here, with an ADR and a new forward-test version.
 */
export const APPROVED_EXECUTION_PROFILES_V1: readonly ApprovedExecutionProfileV1[] =
  Object.freeze([
    Object.freeze({
      symbol: "BTCUSDT",
      version: 2,
      tickSize: "0.010000000000",
      stepSize: "0.000010000000",
      minQuantity: "0.000010000000",
      minNotional: "10.000000000000",
      maxQuantity: null,
      ...BINANCE_SPOT_VIP0_ESTIMATE_V1_COSTS,
      specificationHash:
        "0fba0118f710413a0b9811a15726f69ddb48131c26725775d1f0799de43eed13"
    }),
    Object.freeze({
      symbol: "ETHUSDT",
      version: 2,
      tickSize: "0.010000000000",
      stepSize: "0.000100000000",
      minQuantity: "0.000100000000",
      minNotional: "10.000000000000",
      maxQuantity: null,
      ...BINANCE_SPOT_VIP0_ESTIMATE_V1_COSTS,
      specificationHash:
        "fc2ec20033490fdc14b5d2538b091116daa81c43905a3465b597d52aed601d8a"
    })
  ]);

/** The approved profile new entries of `symbol` must use; `null` = none approved. */
export function currentApprovedExecutionProfile(
  symbol: string | null | undefined
): ApprovedExecutionProfileV1 | null {
  let current: ApprovedExecutionProfileV1 | null = null;
  for (const profile of APPROVED_EXECUTION_PROFILES_V1) {
    if (profile.symbol !== symbol) continue;
    if (current === null || profile.version > current.version) current = profile;
  }
  return current;
}

/**
 * The approved profile an existing order snapshot claims by its hash — the
 * current one or an earlier approved version of the same symbol.
 */
export function approvedExecutionProfileByHash(
  symbol: string | null | undefined,
  specificationHash: unknown
): ApprovedExecutionProfileV1 | null {
  return (
    APPROVED_EXECUTION_PROFILES_V1.find(
      (profile) =>
        profile.symbol === symbol &&
        profile.specificationHash === specificationHash
    ) ?? null
  );
}

/** Every field the check can report, in a stable order. */
export const EXECUTION_PROFILE_INTEGRITY_FIELDS = Object.freeze([
  "symbol",
  "assetId",
  "status",
  "version",
  "source",
  "tickSize",
  "stepSize",
  "minQuantity",
  "minNotional",
  "maxQuantity",
  "feeBps",
  "fullSpreadBps",
  "slippageBps",
  "maxParticipationRate",
  "specificationHash",
  "activeProfileCount"
] as const);

export type ExecutionProfileIntegrityField =
  (typeof EXECUTION_PROFILE_INTEGRITY_FIELDS)[number];

const INSTRUMENT_DECIMAL_FIELDS = [
  "tickSize",
  "stepSize",
  "minQuantity",
  "minNotional"
] as const;
const INTEGER_FIELDS = ["feeBps", "fullSpreadBps", "slippageBps"] as const;

/**
 * The stored shapes the check reads: a row, the risk snapshot's
 * `executionProfile` or an order's precision/cost snapshot. Identity fields
 * are checked whenever the shape carries them; the hash binds them in every
 * shape.
 */
export interface ExecutionProfileIntegrityInput {
  readonly tickSize: unknown;
  readonly stepSize: unknown;
  readonly minQuantity: unknown;
  readonly minNotional: unknown;
  readonly maxQuantity: unknown;
  readonly feeBps: unknown;
  readonly fullSpreadBps: unknown;
  readonly slippageBps: unknown;
  readonly maxParticipationRate: unknown;
  readonly specificationHash: unknown;
  readonly version?: unknown;
  readonly status?: unknown;
  readonly source?: unknown;
  readonly assetId?: unknown;
}

/**
 * A stored decimal as text: a plain string as it is, a Prisma `Decimal` at
 * its 12-place scale. Anything else keeps its string form, which the check
 * then refuses.
 */
function storedDecimal(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toFixed?: unknown }).toFixed === "function"
  ) {
    return (value as { toFixed: (digits: number) => string }).toFixed(12);
  }
  return String(value);
}

function sameDecimal(actual: unknown, approved: string): boolean {
  const text = storedDecimal(actual);
  if (!DecimalValue.isDecimalString(text)) return false;
  try {
    return DecimalValue.fromString(text).eq(DecimalValue.fromString(approved));
  } catch {
    return false;
  }
}

/**
 * Fields in which `profile` deviates from the approved `reference`; empty
 * means approved. Any difference — looser or stricter — is a deviation. Pure,
 * never throws.
 */
export function executionProfileDeviations(
  profile: ExecutionProfileIntegrityInput,
  reference: ApprovedExecutionProfileV1 | null,
  expected: { readonly assetId?: string } = {}
): readonly ExecutionProfileIntegrityField[] {
  if (reference === null) return ["symbol"];
  const deviations: ExecutionProfileIntegrityField[] = [];
  if (
    expected.assetId !== undefined &&
    profile.assetId !== undefined &&
    profile.assetId !== expected.assetId
  )
    deviations.push("assetId");
  if (profile.status !== undefined && profile.status !== "ACTIVE")
    deviations.push("status");
  if (profile.version !== undefined && profile.version !== reference.version)
    deviations.push("version");
  if (profile.source !== undefined && profile.source !== reference.source)
    deviations.push("source");
  for (const field of INSTRUMENT_DECIMAL_FIELDS)
    if (!sameDecimal(profile[field], reference[field])) deviations.push(field);
  if (
    reference.maxQuantity === null
      ? profile.maxQuantity !== null
      : !sameDecimal(profile.maxQuantity, reference.maxQuantity)
  )
    deviations.push("maxQuantity");
  for (const field of INTEGER_FIELDS)
    if (profile[field] !== reference[field]) deviations.push(field);
  if (!sameDecimal(profile.maxParticipationRate, reference.maxParticipationRate))
    deviations.push("maxParticipationRate");
  if (profile.specificationHash !== reference.specificationHash)
    deviations.push("specificationHash");
  return deviations;
}

/** The recomputed hash of an approved profile (used by tests and calibration). */
export function approvedExecutionProfileHash(
  profile: ApprovedExecutionProfileV1
): string {
  return buildSpecificationHash({
    symbol: profile.symbol,
    version: profile.version,
    tickSize: profile.tickSize,
    stepSize: profile.stepSize,
    minQuantity: profile.minQuantity,
    minNotional: profile.minNotional,
    maxQuantity: profile.maxQuantity,
    feeBps: profile.feeBps,
    fullSpreadBps: profile.fullSpreadBps,
    slippageBps: profile.slippageBps,
    maxParticipationRate: profile.maxParticipationRate,
    source: profile.source
  });
}

/** The columns of an `InstrumentExecutionProfile` row the worker reads. */
export interface ExecutionProfileRow {
  readonly id: string;
  readonly assetId: string;
  readonly version: number;
  readonly status: string;
  readonly tickSize: unknown;
  readonly stepSize: unknown;
  readonly minQuantity: unknown;
  readonly minNotional: unknown;
  readonly maxQuantity: unknown;
  readonly feeBps: number;
  readonly fullSpreadBps: number;
  readonly slippageBps: number;
  readonly maxParticipationRate: unknown;
  readonly source: string;
  readonly specificationHash: string;
}

/** A stored row as Prisma returns it. */
export type StoredExecutionProfile = Awaited<
  ReturnType<PrismaClient["instrumentExecutionProfile"]["findFirstOrThrow"]>
>;

export interface ActiveExecutionProfile<Row extends ExecutionProfileRow> {
  /** The highest active version — the row every path used before ADR 0023. */
  readonly row: Row | null;
  readonly activeCount: number;
}

/** All `ACTIVE` rows of one asset; more than one is itself a finding. */
export async function loadActiveExecutionProfile(
  database: Pick<PrismaClient, "instrumentExecutionProfile">,
  assetId: string
): Promise<ActiveExecutionProfile<StoredExecutionProfile>> {
  const rows = await database.instrumentExecutionProfile.findMany({
    where: { assetId, status: "ACTIVE" },
    orderBy: { version: "desc" }
  });
  return { row: rows[0] ?? null, activeCount: rows.length };
}

/**
 * Deviations of an asset's active profile from the current approved profile
 * of `symbol`, including a second `ACTIVE` row. A missing row is reported as
 * `activeProfileCount`; callers with an existing missing-profile path check
 * `row === null` first.
 */
export function activeExecutionProfileDeviations(
  active: ActiveExecutionProfile<ExecutionProfileRow>,
  symbol: string | null | undefined,
  assetId: string
): readonly ExecutionProfileIntegrityField[] {
  if (active.row === null) return ["activeProfileCount"];
  const deviations = [
    ...executionProfileDeviations(
      active.row,
      currentApprovedExecutionProfile(symbol),
      { assetId }
    )
  ];
  if (active.activeCount !== 1) deviations.push("activeProfileCount");
  return deviations;
}

/** The profile values every simulation and mark consumes. */
export interface ExecutionProfileValuesV1 {
  readonly id: string;
  readonly tickSize: string;
  readonly stepSize: string;
  readonly minQuantity: string;
  readonly minNotional: string;
  readonly maxQuantity: string | null;
  readonly feeBps: number;
  readonly fullSpreadBps: number;
  readonly slippageBps: number;
  readonly maxParticipationRate: string;
  readonly specificationHash: string;
}

export interface RiskReducingExecutionProfile {
  readonly values: ExecutionProfileValuesV1;
  readonly deviations: readonly ExecutionProfileIntegrityField[];
  /** True when the approved reference replaced a deviating row. */
  readonly substituted: boolean;
}

/**
 * The profile a risk-reducing path (exit, valuation) prices with. An approved
 * row is used exactly as before. A deviating row is replaced by the approved
 * reference of its symbol — the position can still be closed and marked, but
 * never with values nobody approved. Only without any approved reference does
 * the row stay in use; such a symbol cannot open a position in the first
 * place. Never blocks; the caller locks new entries when `deviations` is not
 * empty.
 */
export function riskReducingExecutionProfile(
  active: ActiveExecutionProfile<ExecutionProfileRow> & {
    readonly row: ExecutionProfileRow;
  },
  symbol: string | null | undefined,
  assetId: string
): RiskReducingExecutionProfile {
  const row = active.row;
  const deviations = activeExecutionProfileDeviations(active, symbol, assetId);
  const reference = currentApprovedExecutionProfile(symbol);
  if (deviations.length === 0 || reference === null) {
    return {
      values: {
        id: row.id,
        tickSize: decimalString(row.tickSize),
        stepSize: decimalString(row.stepSize),
        minQuantity: decimalString(row.minQuantity),
        minNotional: decimalString(row.minNotional),
        maxQuantity:
          row.maxQuantity === null ? null : decimalString(row.maxQuantity),
        feeBps: row.feeBps,
        fullSpreadBps: row.fullSpreadBps,
        slippageBps: row.slippageBps,
        maxParticipationRate: decimalString(row.maxParticipationRate),
        specificationHash: row.specificationHash
      },
      deviations,
      substituted: false
    };
  }
  return {
    values: {
      id: row.id,
      tickSize: reference.tickSize,
      stepSize: reference.stepSize,
      minQuantity: reference.minQuantity,
      minNotional: reference.minNotional,
      maxQuantity: reference.maxQuantity,
      feeBps: reference.feeBps,
      fullSpreadBps: reference.fullSpreadBps,
      slippageBps: reference.slippageBps,
      maxParticipationRate: reference.maxParticipationRate,
      specificationHash: reference.specificationHash
    },
    deviations,
    substituted: true
  };
}

/** Kill reason of a portfolio locked over a deviating execution profile (ADR 0023). */
export const EXECUTION_PROFILE_INTEGRITY_VIOLATION =
  "EXECUTION_PROFILE_INTEGRITY_VIOLATION";

export interface EngageExecutionProfileIntegrityLockInput {
  readonly portfolioId: string;
  readonly symbol: string | null;
  readonly executionProfileId: string | null;
  readonly deviations: readonly string[];
  readonly jobKey: string;
  /** What the finding was raised on, e.g. `TradeCandidate` or `ShadowPosition`. */
  readonly causationType: string;
  readonly causationId: string;
  readonly correlationId: string;
  readonly codeVersion: string;
  readonly asOf: Date;
}

/**
 * Stops new entries of a portfolio whose execution profile deviates from the
 * approved one: an unacknowledged CRITICAL `RiskEvent`, the open session to
 * `ERROR_LOCKED` with the kill switch engaged, the portfolio to
 * `ERROR_LOCKED`, audited. Exits and marks keep running (the monitor never
 * gates on session or portfolio state); unlocking stays a manual step after
 * review. Idempotent: the same finding writes one event, an already locked
 * session and portfolio are left untouched.
 */
export async function engageExecutionProfileIntegrityLock(
  database: PrismaClient,
  input: EngageExecutionProfileIntegrityLockInput
): Promise<{ readonly locked: boolean; readonly sessionId: string | null }> {
  const findingHash = buildSpecificationHash({
    portfolioId: input.portfolioId,
    symbol: input.symbol,
    executionProfileId: input.executionProfileId,
    deviations: [...input.deviations]
  });
  const eventKey = buildRiskEventKey({
    type: RiskEventType.CONFIGURATION_INVALID,
    aggregateType: "Portfolio",
    aggregateId: input.portfolioId,
    inputHash: findingHash
  });
  const payload = {
    jobKey: input.jobKey,
    symbol: input.symbol,
    executionProfileId: input.executionProfileId,
    deviations: [...input.deviations],
    causationType: input.causationType,
    causationId: input.causationId
  };
  return database.$transaction(async (tx) => {
    const session = await tx.tradingSession.findFirst({
      where: { portfolioId: input.portfolioId, status: { not: "CLOSED" } },
      orderBy: { createdAt: "desc" }
    });
    await tx.riskEvent.upsert({
      where: { eventKey },
      update: {},
      create: {
        eventKey,
        type: RiskEventType.CONFIGURATION_INVALID,
        severity: RiskSeverity.CRITICAL,
        reasonCode: EXECUTION_PROFILE_INTEGRITY_VIOLATION,
        portfolioId: input.portfolioId,
        tradingSessionId: session?.id ?? null,
        payloadJson: payload as Prisma.InputJsonValue,
        inputHash: findingHash
      }
    });
    let sessionLocked = false;
    if (
      session !== null &&
      session.status !== TradingSessionStatus.ERROR_LOCKED
    ) {
      const updated = await tx.tradingSession.updateMany({
        where: {
          id: session.id,
          version: session.version,
          killSwitchEngaged: session.killSwitchEngaged
        },
        data: {
          status: TradingSessionStatus.ERROR_LOCKED,
          killSwitchEngaged: true,
          killReasonCode: EXECUTION_PROFILE_INTEGRITY_VIOLATION,
          killedAt: input.asOf,
          lastChangedBy: input.jobKey,
          version: { increment: 1 }
        }
      });
      sessionLocked = updated.count > 0;
    }
    const portfolio = await tx.portfolio.updateMany({
      where: {
        id: input.portfolioId,
        status: { not: PortfolioStatus.ERROR_LOCKED }
      },
      data: { status: PortfolioStatus.ERROR_LOCKED, version: { increment: 1 } }
    });
    if (!sessionLocked && portfolio.count === 0)
      return { locked: false, sessionId: session?.id ?? null };
    const idempotencyKey = `${session?.id ?? input.portfolioId}-execution-profile-${findingHash.slice(0, 32)}`;
    await tx.tradingAuditEvent.create({
      data: {
        eventKey: buildAuditEventKey({
          eventType: "SESSION_ERROR_LOCKED",
          aggregateType: "Portfolio",
          aggregateId: input.portfolioId,
          idempotencyKey
        }),
        eventType: "SESSION_ERROR_LOCKED",
        aggregateType: "Portfolio",
        aggregateId: input.portfolioId,
        actorType: TradingActorType.SYSTEM,
        actorId: input.jobKey,
        correlationId: input.correlationId,
        causationId: input.causationId,
        idempotencyKey,
        reasonCode: EXECUTION_PROFILE_INTEGRITY_VIOLATION,
        tradingSessionId: session?.id ?? null,
        metadataJson: payload as Prisma.InputJsonValue,
        codeVersion: input.codeVersion,
        occurredAt: input.asOf
      }
    });
    return { locked: true, sessionId: session?.id ?? null };
  });
}

/**
 * Append-only ledger folding and replay.
 *
 * Specification:
 *   docs/trading/03-domain-model.md, `PortfolioLedgerEntry`
 *   docs/trading/06-risk-engine-specification.md, "Portfolio-Konsistenz und Toleranz"
 *   docs/trading/decisions/0004-postgresql-workflow-ledger-and-atomic-audit.md
 *
 * The ledger is the truth; `Portfolio`'s cached columns are a projection of it
 * (ADR 0004). `replayLedger` recomputes that projection from scratch so a
 * caller can compare it against the live cache without trusting either side
 * blindly (docs/trading/06, R-003-PORTFOLIO-CONSISTENCY).
 */

import { DecimalValue } from "@signalpilot/trading-domain";

import type { LedgerEntryDraftV1, PortfolioStateV1, ReplayReportV1 } from "./contracts.js";

export const EMPTY_PORTFOLIO_STATE: PortfolioStateV1 = Object.freeze({
  availableCash: "0.000000000000",
  reservedCash: "0.000000000000",
  realizedPnl: "0.000000000000",
  feesPaid: "0.000000000000",
  ledgerSequence: 0
});

/**
 * Fold one ledger entry into a state. Pure arithmetic only — the caller is
 * responsible for sequence-contiguity and idempotency checks before calling
 * this (`checkNextSequence`, `classifyReplay` in `@signalpilot/trading-domain`).
 */
export function applyLedgerEntry(state: PortfolioStateV1, entry: LedgerEntryDraftV1): PortfolioStateV1 {
  return {
    availableCash: DecimalValue.fromString(state.availableCash)
      .add(DecimalValue.fromString(entry.availableCashDelta))
      .toString(),
    reservedCash: DecimalValue.fromString(state.reservedCash)
      .add(DecimalValue.fromString(entry.reservedCashDelta))
      .toString(),
    realizedPnl: DecimalValue.fromString(state.realizedPnl)
      .add(DecimalValue.fromString(entry.realizedPnlDelta))
      .toString(),
    feesPaid: DecimalValue.fromString(state.feesPaid).add(DecimalValue.fromString(entry.feeDelta)).toString(),
    ledgerSequence: entry.sequence
  };
}

/**
 * Replay every entry in order, reporting sequence gaps, duplicate keys and
 * dangling references so the caller can decide whether the result is
 * trustworthy — it never silently skips a bad entry.
 */
export function replayLedger(
  entries: readonly LedgerEntryDraftV1[],
  knownAggregateIds: {
    readonly shadowOrderIds: ReadonlySet<string>;
    readonly shadowFillIds: ReadonlySet<string>;
    readonly shadowPositionIds: ReadonlySet<string>;
  },
  startingState: PortfolioStateV1 = EMPTY_PORTFOLIO_STATE
): ReplayReportV1 {
  const sorted = [...entries].sort((a, b) => a.sequence - b.sequence);
  const seenKeys = new Set<string>();
  let duplicateEntryKeyCount = 0;
  let sequenceGapCount = 0;
  let orphanReferenceCount = 0;
  let state = startingState;
  let lastSequence = startingState.ledgerSequence;

  for (const entry of sorted) {
    if (seenKeys.has(entry.entryKey)) {
      duplicateEntryKeyCount += 1;
      continue;
    }
    seenKeys.add(entry.entryKey);

    if (entry.sequence !== lastSequence + 1) {
      sequenceGapCount += 1;
    }
    lastSequence = entry.sequence;

    if (entry.shadowOrderId !== null && !knownAggregateIds.shadowOrderIds.has(entry.shadowOrderId)) {
      orphanReferenceCount += 1;
    }
    if (entry.shadowFillId !== null && !knownAggregateIds.shadowFillIds.has(entry.shadowFillId)) {
      orphanReferenceCount += 1;
    }
    if (entry.shadowPositionId !== null && !knownAggregateIds.shadowPositionIds.has(entry.shadowPositionId)) {
      orphanReferenceCount += 1;
    }

    state = applyLedgerEntry(state, entry);
  }

  return {
    state,
    entryCount: sorted.length,
    orphanReferenceCount,
    sequenceGapCount,
    duplicateEntryKeyCount
  };
}

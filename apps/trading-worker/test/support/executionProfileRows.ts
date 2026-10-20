/**
 * A stored `InstrumentExecutionProfile` row exactly as Prisma returns the
 * approved profile of a symbol (ADR 0023): decimal columns as
 * `Prisma.Decimal`, which the worker renders as `0.010000000000`. Tests that
 * need a deviating row override single fields.
 */

import { Prisma } from "@signalpilot/database";

import { currentApprovedExecutionProfile } from "../../src/lib/executionProfileIntegrity.js";

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

export function approvedExecutionProfileRow(
  symbol = "BTCUSDT",
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const approved = currentApprovedExecutionProfile(symbol);
  if (approved === null) throw new Error(`No approved profile for ${symbol}.`);
  return {
    version: approved.version,
    status: "ACTIVE",
    tickSize: decimal(approved.tickSize),
    stepSize: decimal(approved.stepSize),
    minQuantity: decimal(approved.minQuantity),
    minNotional: decimal(approved.minNotional),
    maxQuantity:
      approved.maxQuantity === null ? null : decimal(approved.maxQuantity),
    feeBps: approved.feeBps,
    fullSpreadBps: approved.fullSpreadBps,
    slippageBps: approved.slippageBps,
    maxParticipationRate: decimal(approved.maxParticipationRate),
    source: approved.source,
    sourceObservedAt: new Date("2026-08-01T00:00:00.000Z"),
    specificationHash: approved.specificationHash,
    ...overrides
  };
}

/** The risk snapshot's `executionProfile` of an approved row, as the assembler writes it. */
export function approvedRiskSnapshotProfile(
  row: Record<string, unknown>
): Record<string, unknown> {
  const text = (value: unknown): string | null =>
    value === null ? null : (value as Prisma.Decimal).toFixed(12);
  return {
    id: row.id,
    assetId: row.assetId,
    version: row.version,
    status: row.status,
    tickSize: text(row.tickSize),
    stepSize: text(row.stepSize),
    minQuantity: text(row.minQuantity),
    minNotional: text(row.minNotional),
    maxQuantity: text(row.maxQuantity),
    feeBps: row.feeBps,
    fullSpreadBps: row.fullSpreadBps,
    slippageBps: row.slippageBps,
    maxParticipationRate: text(row.maxParticipationRate),
    sourceObservedAt: (row.sourceObservedAt as Date).toISOString(),
    specificationHash: row.specificationHash
  };
}

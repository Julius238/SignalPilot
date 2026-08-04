/**
 * @signalpilot/trading-domain — pure contracts for SignalPilot Shadow Trading v1.
 *
 * Owns money and quantity value objects, enums, reason codes, idempotency keys
 * and transition guards. It must never import Prisma, a network client,
 * `process.env`, the system clock or a scheduler
 * (docs/trading/02-shadow-trading-target-architecture.md, module table).
 *
 * This package contains no executable shadow trading logic: no strategy, no
 * risk calculation, no position sizing, no fill simulation and no ledger.
 */

export * from "./types.js";
export * from "./decimal.js";
export * from "./direction.js";
export * from "./canonical-json.js";
export * from "./state-machines.js";
export * from "./idempotency.js";

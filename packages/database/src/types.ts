// Type-declaration source for @signalpilot/database.
//
// This file's compiled .d.ts (dist/types.d.ts) is what TypeScript reads
// when type-checking consumers. The compiled .js is never loaded at runtime
// — Node.js loads dist/index.js instead (see package.json exports).
//
// Re-exporting from @prisma/client here preserves the dual value+type
// semantics for Prisma 6 enums (e.g. `status: AlertStatus` and
// `AlertStatus.PENDING` both work in consumers). A plain `export const`
// re-export in the runtime file only exposes the value side.

export {
  Prisma,
  AlertChannel,
  AlertStatus,
  AssetType,
  BacktestOutcome,
  BacktestOutcomeStatus,
  BacktestRunStatus,
  BotRunStatus,
  PaperOrderSide,
  PaperOrderStatus,
  PaperPositionStatus,
  PaperEvaluationKind,
  PaperEvaluationOutcome,
  PaperEvaluationStatus,
  PaperExpectedMoveDirection,
  MarketEventSeverity,
  MarketEventType,
  RadarEventSeverity,
  RadarEventType,
  RiskLevel,
  SignalDirection,
  SignalStatus,
  SignalType,
  StrategyComparisonStatus,
  WatchlistPriority
} from "@prisma/client";

export type { PrismaClient } from "@prisma/client";

// prisma singleton — its type is inferred from the runtime-values declaration
export { prisma } from "./runtime-values.js";

import { createRequire } from "node:module";

// Load @prisma/client as CJS. Its default.js spreads require() output which
// Node.js cannot statically analyze for named ESM bindings. createRequire
// bypasses static analysis entirely, so there is no "Named export not found" error.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const p = createRequire(import.meta.url)("@prisma/client") as typeof import("@prisma/client");

// ── Enum runtime constants ────────────────────────────────────────────────
// These are plain const exports. TypeScript types for these names come from
// dist/types.d.ts (see src/types.ts) — NOT from here.
export const Prisma = p.Prisma;
export const AlertChannel = p.AlertChannel;
export const AlertStatus = p.AlertStatus;
export const AssetType = p.AssetType;
export const BacktestOutcome = p.BacktestOutcome;
export const BacktestOutcomeStatus = p.BacktestOutcomeStatus;
export const BacktestRunStatus = p.BacktestRunStatus;
export const BotRunStatus = p.BotRunStatus;
export const PaperOrderSide = p.PaperOrderSide;
export const PaperOrderStatus = p.PaperOrderStatus;
export const PaperPositionStatus = p.PaperPositionStatus;
export const PaperEvaluationKind = p.PaperEvaluationKind;
export const PaperEvaluationOutcome = p.PaperEvaluationOutcome;
export const PaperEvaluationStatus = p.PaperEvaluationStatus;
export const PaperExpectedMoveDirection = p.PaperExpectedMoveDirection;
export const RiskLevel = p.RiskLevel;
export const SignalDirection = p.SignalDirection;
export const SignalStatus = p.SignalStatus;
export const SignalType = p.SignalType;
export const StrategyComparisonStatus = p.StrategyComparisonStatus;
export const WatchlistPriority = p.WatchlistPriority;

// ── Prisma client singleton ───────────────────────────────────────────────
export const prisma = new p.PrismaClient();

import { createRequire } from "node:module";

// Load @prisma/client as CJS. Its default.js spreads require() output which
// Node.js cannot statically analyze for named ESM bindings. createRequire
// bypasses static analysis entirely, so there is no "Named export not found" error.
const p = createRequire(import.meta.url)("@prisma/client") as typeof import("@prisma/client");

// ── Enum runtime constants ────────────────────────────────────────────────
// These are plain const exports. TypeScript types for these names come from
// dist/types.d.ts (see src/types.ts) — NOT from here.
export const Prisma = p.Prisma;
export const AlertChannel = p.AlertChannel;
export const AlertStatus = p.AlertStatus;
export const AssetType = p.AssetType;
export const AssetUniverseRole = p.AssetUniverseRole;
export const AssetUniverseSource = p.AssetUniverseSource;
export const AssetDiscoveryRunKind = p.AssetDiscoveryRunKind;
export const AssetDiscoveryCandidateStatus = p.AssetDiscoveryCandidateStatus;
export const AssetDiscoveryAction = p.AssetDiscoveryAction;
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
export const MarketEventSeverity = p.MarketEventSeverity;
export const MarketEventType = p.MarketEventType;
export const RadarEventSeverity = p.RadarEventSeverity;
export const RadarEventType = p.RadarEventType;
export const RiskLevel = p.RiskLevel;
export const SignalDirection = p.SignalDirection;
export const SignalStatus = p.SignalStatus;
export const SignalType = p.SignalType;
export const StrategyComparisonStatus = p.StrategyComparisonStatus;
export const WatchlistPriority = p.WatchlistPriority;

// ── Shadow Trading v1 enums (docs/trading/03-domain-model.md) ─────────────
export const ExitPlanStatus = p.ExitPlanStatus;
export const InstrumentExecutionProfileStatus = p.InstrumentExecutionProfileStatus;
export const IntrabarConflictPolicy = p.IntrabarConflictPolicy;
export const PortfolioLedgerEntryType = p.PortfolioLedgerEntryType;
export const PortfolioStatus = p.PortfolioStatus;
export const RiskAssessmentStatus = p.RiskAssessmentStatus;
export const RiskEventType = p.RiskEventType;
export const RiskLimitScope = p.RiskLimitScope;
export const RiskLimitSetStatus = p.RiskLimitSetStatus;
export const RiskRuleOutcome = p.RiskRuleOutcome;
export const RiskSeverity = p.RiskSeverity;
export const ShadowFillTriggerType = p.ShadowFillTriggerType;
export const ShadowOrderPurpose = p.ShadowOrderPurpose;
export const ShadowOrderSide = p.ShadowOrderSide;
export const ShadowOrderStatus = p.ShadowOrderStatus;
export const ShadowOrderTimeInForce = p.ShadowOrderTimeInForce;
export const ShadowOrderType = p.ShadowOrderType;
export const ShadowPositionEventType = p.ShadowPositionEventType;
export const ShadowPositionStatus = p.ShadowPositionStatus;
export const StrategyPerformanceSegment = p.StrategyPerformanceSegment;
export const StrategyPerformanceWindow = p.StrategyPerformanceWindow;
export const StrategyStatus = p.StrategyStatus;
export const StrategyVersionStatus = p.StrategyVersionStatus;
export const TradeCandidateStatus = p.TradeCandidateStatus;
export const TradeDecisionOutcome = p.TradeDecisionOutcome;
export const TradeDirection = p.TradeDirection;
export const TradeEntryType = p.TradeEntryType;
export const TradeEvidenceType = p.TradeEvidenceType;
export const TradingActorType = p.TradingActorType;
// ── Work package 8 (P8: performance segmentation, alert outbox) ──────────
export const TradingAlertEventType = p.TradingAlertEventType;
export const TradingAlertOutboxStatus = p.TradingAlertOutboxStatus;
export const TradingSessionMode = p.TradingSessionMode;
export const TradingSessionStatus = p.TradingSessionStatus;

// ── Prisma client singleton ───────────────────────────────────────────────
export const prisma = new p.PrismaClient();

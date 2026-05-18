import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export {
  AlertChannel,
  AlertStatus,
  AssetType,
  BotRunStatus,
  PaperOrderSide,
  PaperOrderStatus,
  PaperPositionStatus,
  PaperEvaluationKind,
  PaperEvaluationOutcome,
  PaperEvaluationStatus,
  PaperExpectedMoveDirection,
  Prisma,
  RiskLevel,
  SignalDirection,
  SignalStatus,
  SignalType,
  WatchlistPriority
} from "@prisma/client";

export type { PrismaClient };

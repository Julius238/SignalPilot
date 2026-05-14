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
  Prisma,
  RiskLevel,
  SignalDirection,
  SignalStatus,
  SignalType
} from "@prisma/client";

export type { PrismaClient };

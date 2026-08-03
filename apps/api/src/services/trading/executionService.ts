import {
  prisma,
  ShadowPositionStatus,
  type PrismaClient,
  type ShadowOrderPurpose,
  type ShadowOrderStatus
} from "@signalpilot/database";

const assetSelect = { symbol: true } as const;

const OPEN_POSITION_STATUSES = [ShadowPositionStatus.OPENING, ShadowPositionStatus.OPEN, ShadowPositionStatus.PARTIALLY_CLOSED];
const CLOSED_POSITION_STATUSES = [
  ShadowPositionStatus.CLOSED,
  ShadowPositionStatus.STOPPED_OUT,
  ShadowPositionStatus.INVALIDATED,
  ShadowPositionStatus.ERROR
];

export interface ListOrdersFilters {
  readonly assetId?: string;
  readonly portfolioId?: string;
  readonly status?: ShadowOrderStatus;
  readonly purpose?: ShadowOrderPurpose;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export async function listOrders(database: PrismaClient = prisma, filters: ListOrdersFilters) {
  return database.shadowOrder.findMany({
    where: {
      assetId: filters.assetId,
      portfolioId: filters.portfolioId,
      status: filters.status,
      purpose: filters.purpose,
      createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined
    },
    orderBy: { createdAt: "desc" },
    skip: filters.offset,
    take: filters.limit,
    include: { asset: { select: assetSelect } }
  });
}

export interface ListFillsFilters {
  readonly assetId?: string;
  readonly shadowOrderId?: string;
  readonly shadowPositionId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export async function listFills(database: PrismaClient = prisma, filters: ListFillsFilters) {
  return database.shadowFill.findMany({
    where: {
      assetId: filters.assetId,
      shadowOrderId: filters.shadowOrderId,
      shadowPositionId: filters.shadowPositionId,
      occurredAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined
    },
    orderBy: { occurredAt: "desc" },
    skip: filters.offset,
    take: filters.limit,
    include: { asset: { select: assetSelect } }
  });
}

export interface ListPositionsFilters {
  readonly assetId?: string;
  readonly portfolioId?: string;
  readonly open?: boolean;
  readonly limit: number;
  readonly offset: number;
}

export async function listPositions(database: PrismaClient = prisma, filters: ListPositionsFilters) {
  return database.shadowPosition.findMany({
    where: {
      assetId: filters.assetId,
      portfolioId: filters.portfolioId,
      status:
        filters.open === undefined
          ? undefined
          : { in: filters.open ? OPEN_POSITION_STATUSES : CLOSED_POSITION_STATUSES }
    },
    orderBy: { createdAt: "desc" },
    skip: filters.offset,
    take: filters.limit,
    include: { asset: { select: assetSelect } }
  });
}

export async function getPositionById(database: PrismaClient = prisma, id: string) {
  return database.shadowPosition.findUnique({
    where: { id },
    include: { asset: { select: assetSelect }, events: { orderBy: { sequence: "asc" } } }
  });
}

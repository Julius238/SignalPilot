export type AssetType = "STOCK" | "ETF" | "CRYPTO";
export type SignalStatus = "STRONG_WATCH" | "WATCH" | "WAIT" | "AVOID" | "NO_EDGE";
export type SignalDirection = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  assetType: AssetType;
  exchange: string;
  baseCurrency: string | null;
  quoteCurrency: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SignalOutput = {
  id: string;
  signalId: string;
  shortConclusion: string;
  counterArgument?: string;
  nextTrigger: string;
  telegramText?: string;
  dashboardJson?: unknown;
  technicalJson?: unknown;
  intelligenceJson?: unknown;
  marketConfirmationJson?: unknown;
  createdAt: string;
};

export type SignalListItem = {
  id: string;
  symbol: string;
  timeframe: string;
  signalType: string;
  status: SignalStatus;
  direction: SignalDirection;
  score: number;
  riskLevel: RiskLevel;
  createdAt: string;
  asset: Asset;
  signalOutput: SignalOutput | null;
};

export type SignalDetail = {
  signal: SignalListItem["id"] extends string
    ? {
        id: string;
        assetId: string;
        symbol: string;
        timeframe: string;
        signalType: string;
        status: SignalStatus;
        direction: SignalDirection;
        score: number;
        riskLevel: RiskLevel;
        trendScore: number;
        momentumScore: number;
        volumeScore: number;
        volatilityScore: number;
        rsiScore: number;
        newsScore: number;
        socialScore: number;
        eventScore: number;
        riskScore: number;
        createdAt: string;
      }
    : never;
  asset: Asset;
  signalOutput: SignalOutput | null;
  candles: Candle[];
};

export type Candle = {
  id: string;
  symbol: string;
  timeframe: string;
  openTime: string;
  closeTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  source: string;
};

export type AssetDetail = Asset & {
  latestSignal: Omit<SignalListItem, "asset" | "signalOutput"> | null;
  latestSignalOutput: SignalOutput | null;
  candleCounts: Record<string, number>;
  candles?: Candle[];
};

export type BotRun = {
  id: string;
  jobName: string;
  status: "SUCCESS" | "FAILED" | "RUNNING";
  startedAt: string;
  finishedAt: string | null;
  metadataJson: unknown;
};

export type BotLog = {
  id: string;
  level: string;
  service: string;
  message: string;
  metadataJson: unknown;
  createdAt: string;
};

export type Alert = {
  id: string;
  signalId: string | null;
  channel: string;
  status: "PENDING" | "SENT" | "FAILED";
  payloadJson: unknown;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
  signal?: {
    id: string;
    symbol: string;
    timeframe: string;
    status: SignalStatus;
    signalType: string;
    score: number;
  } | null;
};

export type ApiResult<T> =
  | {
      data: T;
      error: null;
    }
  | {
      data: null;
      error: string;
    };

const apiUrl = process.env.NEXT_PUBLIC_SIGNALPILOT_API_URL ?? "http://localhost:3100";

export async function fetchApi<T>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      cache: "no-store"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message =
        typeof body?.message === "string"
          ? body.message
          : `SignalPilot API returned HTTP ${response.status}`;

      return {
        data: null,
        error: message
      };
    }

    return {
      data: (await response.json()) as T,
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to reach SignalPilot API"
    };
  }
}

export function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }

  const value = query.toString();
  return value ? `?${value}` : "";
}

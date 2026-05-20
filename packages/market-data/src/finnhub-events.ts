type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type FinnhubEarningsCalendarApiItem = {
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  hour: string;
  quarter: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  symbol: string;
  year: number | null;
};

export type NormalizedEarningsEvent = {
  symbol: string;
  eventType: "EARNINGS";
  title: string;
  source: "FINNHUB";
  eventDate: Date;
  eventTime: string | null;
  fiscalQuarter: string | null;
  fiscalYear: number | null;
  epsEstimate: string | null;
  epsActual: string | null;
  revenueEstimate: string | null;
  revenueActual: string | null;
  rawJson: unknown;
};

export type FinnhubEventsFetchResult =
  | { kind: "ok"; items: NormalizedEarningsEvent[] }
  | { kind: "no_events" }
  | { kind: "rate_limit" }
  | { kind: "forbidden"; statusCode: number; body: string };

export class FinnhubEventsAdapter {
  private readonly baseUrl: string;
  private readonly fetchClient: FetchLike;
  private readonly apiKey: string;

  constructor(options: { baseUrl?: string; fetchClient?: FetchLike; apiKey?: string } = {}) {
    this.baseUrl = options.baseUrl ?? "https://finnhub.io";
    this.fetchClient = options.fetchClient ?? fetch;
    this.apiKey = options.apiKey ?? process.env.FINNHUB_API_KEY ?? "";
  }

  assertApiKey(): void {
    if (!this.apiKey) {
      throw new Error("FINNHUB_API_KEY environment variable is not set.");
    }
  }

  async fetchEarningsCalendar(input: {
    from: string;
    to: string;
    symbol?: string;
  }): Promise<FinnhubEventsFetchResult> {
    this.assertApiKey();

    const url = new URL("/api/v1/calendar/earnings", this.baseUrl);
    url.searchParams.set("from", input.from);
    url.searchParams.set("to", input.to);
    if (input.symbol) {
      url.searchParams.set("symbol", input.symbol);
    }
    url.searchParams.set("token", this.apiKey);

    const response = await this.fetchClient(url);

    if (response.status === 429) {
      return { kind: "rate_limit" };
    }

    if (response.status === 403) {
      const body = await response.text().catch(() => "");
      return { kind: "forbidden", statusCode: 403, body };
    }

    if (!response.ok) {
      throw new Error(`Finnhub earnings calendar request failed with HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();
    return normalizeEarningsCalendarResponse(payload);
  }
}

export function normalizeEarningsCalendarResponse(payload: unknown): FinnhubEventsFetchResult {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid Finnhub earnings calendar response format.");
  }

  const obj = payload as Record<string, unknown>;
  const earningsCalendar = obj.earningsCalendar;

  if (!Array.isArray(earningsCalendar)) {
    throw new Error("Invalid Finnhub earnings calendar response: missing earningsCalendar array.");
  }

  const items = earningsCalendar
    .filter(isFinnhubEarningsItem)
    .map(normalizeEarningsItem);

  if (items.length === 0) {
    return { kind: "no_events" };
  }

  return { kind: "ok", items };
}

function normalizeEarningsItem(item: FinnhubEarningsCalendarApiItem): NormalizedEarningsEvent {
  return {
    symbol: item.symbol,
    eventType: "EARNINGS",
    title: `${item.symbol} Earnings`,
    source: "FINNHUB",
    eventDate: new Date(item.date),
    eventTime: item.hour || null,
    fiscalQuarter: item.quarter !== null && item.quarter !== undefined ? String(item.quarter) : null,
    fiscalYear: item.year ?? null,
    epsEstimate: item.epsEstimate !== null && item.epsEstimate !== undefined ? String(item.epsEstimate) : null,
    epsActual: item.epsActual !== null && item.epsActual !== undefined ? String(item.epsActual) : null,
    revenueEstimate:
      item.revenueEstimate !== null && item.revenueEstimate !== undefined
        ? String(item.revenueEstimate)
        : null,
    revenueActual:
      item.revenueActual !== null && item.revenueActual !== undefined
        ? String(item.revenueActual)
        : null,
    rawJson: item
  };
}

function isFinnhubEarningsItem(item: unknown): item is FinnhubEarningsCalendarApiItem {
  if (typeof item !== "object" || item === null) return false;
  const n = item as FinnhubEarningsCalendarApiItem;
  return typeof n.symbol === "string" && typeof n.date === "string";
}

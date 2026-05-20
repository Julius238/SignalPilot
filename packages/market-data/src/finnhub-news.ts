type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type FinnhubNewsApiItem = {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
};

export type NormalizedNewsItem = {
  symbol: string;
  source: string;
  headline: string;
  summary: string | null;
  url: string | null;
  imageUrl: string | null;
  publishedAt: Date;
  category: string | null;
  rawJson: unknown;
};

export type FinnhubNewsFetchResult =
  | { kind: "ok"; items: NormalizedNewsItem[] }
  | { kind: "no_news" }
  | { kind: "rate_limit" };

export class FinnhubNewsAdapter {
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

  async fetchCompanyNews(symbol: string, from: Date, to: Date): Promise<FinnhubNewsFetchResult> {
    const url = new URL("/api/v1/company-news", this.baseUrl);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("from", formatDate(from));
    url.searchParams.set("to", formatDate(to));
    url.searchParams.set("token", this.apiKey);

    const response = await this.fetchClient(url);

    if (response.status === 429) {
      return { kind: "rate_limit" };
    }

    if (!response.ok) {
      throw new Error(`Finnhub news request failed with HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();
    return normalizeNewsResponse(symbol, payload);
  }
}

export function normalizeNewsResponse(symbol: string, payload: unknown): FinnhubNewsFetchResult {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid Finnhub news response format.");
  }

  const items = payload.filter(isFinnhubNewsItem).map((item) => normalizeNewsItem(symbol, item));

  if (items.length === 0) {
    return { kind: "no_news" };
  }

  return { kind: "ok", items };
}

function normalizeNewsItem(symbol: string, item: FinnhubNewsApiItem): NormalizedNewsItem {
  return {
    symbol,
    source: item.source,
    headline: item.headline,
    summary: item.summary || null,
    url: item.url || null,
    imageUrl: item.image || null,
    publishedAt: new Date(item.datetime * 1000),
    category: item.category || null,
    rawJson: item
  };
}

function isFinnhubNewsItem(item: unknown): item is FinnhubNewsApiItem {
  if (typeof item !== "object" || item === null) return false;
  const n = item as FinnhubNewsApiItem;
  return (
    typeof n.headline === "string" &&
    typeof n.source === "string" &&
    typeof n.datetime === "number"
  );
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

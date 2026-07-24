import { classifyProviderHttpError, toTemporaryProviderError } from "./provider-errors.js";

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
  externalId: string | null;
  symbol: string;
  relatedSymbols: string[];
  source: string;
  transportProvider: "FINNHUB";
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
  | { kind: "rate_limit" }
  | { kind: "invalid_api_key"; statusCode: number }
  | { kind: "entitlement"; statusCode: number }
  | { kind: "unsupported_symbol"; statusCode: number }
  | { kind: "temporary_error"; statusCode: number | null }
  | { kind: "permanent_error"; statusCode: number };

export type GeneralNewsCategory = "general" | "forex" | "crypto" | "merger";

export type NormalizedGeneralNewsItem = {
  externalId: string | null;
  source: string;
  headline: string;
  summary: string | null;
  url: string | null;
  publishedAt: Date;
  category: string | null;
  rawJson: unknown;
};

export type FinnhubGeneralNewsFetchResult =
  | { kind: "ok"; items: NormalizedGeneralNewsItem[] }
  | { kind: "no_news" }
  | { kind: "rate_limit" }
  | { kind: "invalid_api_key"; statusCode: number }
  | { kind: "entitlement"; statusCode: number }
  | { kind: "unsupported_symbol"; statusCode: number }
  | { kind: "temporary_error"; statusCode: number | null }
  | { kind: "permanent_error"; statusCode: number };

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

    let response: Response;
    try {
      response = await this.fetchClient(url);
    } catch {
      const error = toTemporaryProviderError("FINNHUB", "company-news");
      return { kind: "temporary_error", statusCode: error.statusCode };
    }

    if (response.status === 429) {
      return { kind: "rate_limit" };
    }

    if (!response.ok) {
      return classifyNewsHttpFailure(response, "company-news");
    }

    try {
      const payload: unknown = await response.json();
      return normalizeNewsResponse(symbol, payload);
    } catch {
      return { kind: "temporary_error", statusCode: response.status };
    }
  }

  async fetchGeneralNews(
    category: GeneralNewsCategory = "general"
  ): Promise<FinnhubGeneralNewsFetchResult> {
    const url = new URL("/api/v1/news", this.baseUrl);
    url.searchParams.set("category", category);
    url.searchParams.set("token", this.apiKey);

    let response: Response;
    try {
      response = await this.fetchClient(url);
    } catch {
      return { kind: "temporary_error", statusCode: null };
    }

    if (response.status === 429) {
      return { kind: "rate_limit" };
    }

    if (!response.ok) {
      return classifyNewsHttpFailure(response, "general-news");
    }

    try {
      const payload: unknown = await response.json();
      return normalizeGeneralNewsResponse(payload);
    } catch {
      return { kind: "temporary_error", statusCode: response.status };
    }
  }
}

export function normalizeGeneralNewsResponse(payload: unknown): FinnhubGeneralNewsFetchResult {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid Finnhub general news response format.");
  }

  const items = payload.filter(isFinnhubNewsItem).map(normalizeGeneralNewsItem);

  if (items.length === 0) {
    return { kind: "no_news" };
  }

  return { kind: "ok", items };
}

function normalizeGeneralNewsItem(item: FinnhubNewsApiItem): NormalizedGeneralNewsItem {
  return {
    externalId: typeof item.id === "number" ? String(item.id) : null,
    source: item.source,
    headline: item.headline,
    summary: item.summary || null,
    url: item.url || null,
    publishedAt: new Date(item.datetime * 1000),
    category: item.category || null,
    rawJson: item
  };
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
  const relatedSymbols = normalizeRelatedSymbols(item.related);
  return {
    externalId: typeof item.id === "number" ? String(item.id) : null,
    symbol,
    relatedSymbols: relatedSymbols.length > 0 ? relatedSymbols : [symbol.toUpperCase()],
    source: item.source,
    transportProvider: "FINNHUB",
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

export function normalizeRelatedSymbols(related: string | null | undefined): string[] {
  if (!related) return [];
  return [
    ...new Set(
      related
        .split(/[,\s;|]+/)
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => /^[A-Z0-9.^-]{1,20}$/.test(symbol))
    )
  ];
}

async function classifyNewsHttpFailure(
  response: Response,
  endpoint: string
): Promise<
  | { kind: "invalid_api_key"; statusCode: number }
  | { kind: "entitlement"; statusCode: number }
  | { kind: "unsupported_symbol"; statusCode: number }
  | { kind: "temporary_error"; statusCode: number | null }
  | { kind: "permanent_error"; statusCode: number }
> {
  const hint =
    typeof response.text === "function" ? await response.text().catch(() => "") : "";
  const error = classifyProviderHttpError("FINNHUB", endpoint, response.status, hint);
  if (error.kind === "INVALID_API_KEY") {
    return { kind: "invalid_api_key", statusCode: response.status };
  }
  if (error.kind === "ENTITLEMENT") {
    return { kind: "entitlement", statusCode: response.status };
  }
  if (error.kind === "UNSUPPORTED_SYMBOL") {
    return { kind: "unsupported_symbol", statusCode: response.status };
  }
  if (error.kind === "TEMPORARY") {
    return { kind: "temporary_error", statusCode: response.status };
  }
  return { kind: "permanent_error", statusCode: response.status };
}

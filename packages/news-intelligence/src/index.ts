export type NewsContextSentiment = "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED" | "UNKNOWN";

export type NewsItemInput = {
  id: string;
  symbol: string;
  headline: string;
  summary?: string | null;
  url?: string | null;
  source: string;
  publishedAt: Date | string;
  category?: string | null;
};

export type NewsContextItem = {
  headline: string;
  source: string;
  publishedAt: string;
  url: string | null;
  sentiment: NewsContextSentiment;
};

export type NewsContext = {
  hasRecentNews: boolean;
  recentNewsCount: number;
  relevantNewsCount: number;
  topNews: NewsContextItem[];
  relevanceScore: number;
  sentiment: NewsContextSentiment;
  summary: string;
  riskNote: string;
  sourceNote: string;
};

export type BuildNewsContextInput = {
  asset: { id: string; symbol: string };
  signal: { createdAt: Date | string };
  newsItems: NewsItemInput[];
  now?: Date;
  recentWindowHours?: number;
};

const HIGH_IMPACT_KEYWORDS = [
  "earnings", "guidance", "revenue", "profit", "loss", "lawsuit", "investigation",
  "sec", "fda", "merger", "acquisition", "downgrade", "upgrade", "analyst",
  "dividend", "split", "layoffs", "product", "partnership"
];

const CRITICAL_KEYWORDS = [
  "earnings", "guidance", "revenue", "sec", "fda", "merger", "acquisition",
  "lawsuit", "investigation"
];

const POSITIVE_KEYWORDS = [
  "beat", "raises", "upgrade", "growth", "partnership", "approval", "record",
  "profit", "surpasses", "exceeds", "expansion", "strong", "bullish", "record high"
];

const NEGATIVE_KEYWORDS = [
  "miss", "cuts", "downgrade", "lawsuit", "investigation", "loss", "decline",
  "warning", "layoffs", "recall", "fraud", "fine", "penalty", "bearish",
  "below expectations"
];

const NO_NEWS_SUMMARY = "Keine relevante neue Meldung im News-Fenster gefunden.";

export function buildNewsContextForSignal(input: BuildNewsContextInput): NewsContext {
  const now = input.now ?? new Date();
  const signalTime = toDate(input.signal.createdAt);
  const windowMs = (input.recentWindowHours ?? 72) * 60 * 60 * 1000;

  const recentNews = input.newsItems.filter((item) => {
    const pub = toDate(item.publishedAt);
    return (
      pub.getTime() <= now.getTime() &&
      Math.abs(pub.getTime() - signalTime.getTime()) <= windowMs
    );
  });

  if (recentNews.length === 0) {
    return emptyContext();
  }

  const scored = recentNews
    .map((item) => ({
      item,
      score: scoreRelevance(item),
      sentiment: classifySentiment(item)
    }))
    .sort((a, b) => b.score - a.score);

  const relevantItems = scored.filter((s) => s.score >= 30);
  const topItems = scored.slice(0, 3);
  const relevanceScore = computeRelevanceScore(scored);
  const sentiment = computeOverallSentiment(scored);

  return {
    hasRecentNews: true,
    recentNewsCount: recentNews.length,
    relevantNewsCount: relevantItems.length,
    topNews: topItems.map((s) => ({
      headline: s.item.headline,
      source: s.item.source,
      publishedAt: toDate(s.item.publishedAt).toISOString(),
      url: s.item.url ?? null,
      sentiment: s.sentiment
    })),
    relevanceScore,
    sentiment,
    summary: buildSummaryText(topItems, input.asset.symbol, relevanceScore),
    riskNote: buildRiskNote(sentiment, relevanceScore),
    sourceNote: buildSourceNote(topItems.map((s) => s.item.source))
  };
}

function emptyContext(): NewsContext {
  return {
    hasRecentNews: false,
    recentNewsCount: 0,
    relevantNewsCount: 0,
    topNews: [],
    relevanceScore: 0,
    sentiment: "UNKNOWN",
    summary: NO_NEWS_SUMMARY,
    riskNote: "",
    sourceNote: ""
  };
}

function scoreRelevance(item: NewsItemInput): number {
  const text = `${item.headline} ${item.summary ?? ""}`.toLowerCase();
  let score = 10;

  if (CRITICAL_KEYWORDS.some((kw) => text.includes(kw))) {
    score += 70;
  } else if (HIGH_IMPACT_KEYWORDS.some((kw) => text.includes(kw))) {
    score += 20;
  }

  return Math.min(score, 100);
}

function classifySentiment(item: NewsItemInput): NewsContextSentiment {
  const text = `${item.headline} ${item.summary ?? ""}`.toLowerCase();
  const positive = POSITIVE_KEYWORDS.filter((kw) => text.includes(kw)).length;
  const negative = NEGATIVE_KEYWORDS.filter((kw) => text.includes(kw)).length;

  if (positive > 0 && negative > 0) return "MIXED";
  if (positive > 0) return "POSITIVE";
  if (negative > 0) return "NEGATIVE";
  return "NEUTRAL";
}

function computeRelevanceScore(
  scored: Array<{ score: number }>
): number {
  if (scored.length === 0) return 0;
  const max = Math.max(...scored.map((s) => s.score));
  const avg = scored.reduce((sum, s) => sum + s.score, 0) / scored.length;
  return Math.min(Math.round(max * 0.7 + avg * 0.3), 100);
}

function computeOverallSentiment(
  scored: Array<{ sentiment: NewsContextSentiment }>
): NewsContextSentiment {
  if (scored.length === 0) return "UNKNOWN";
  const pos = scored.filter((s) => s.sentiment === "POSITIVE").length;
  const neg = scored.filter((s) => s.sentiment === "NEGATIVE").length;
  const mixed = scored.filter((s) => s.sentiment === "MIXED").length;

  if ((pos > 0 && neg > 0) || mixed > 0) return "MIXED";
  if (pos > neg) return "POSITIVE";
  if (neg > pos) return "NEGATIVE";

  const neutral = scored.filter((s) => s.sentiment === "NEUTRAL").length;
  return neutral > 0 ? "NEUTRAL" : "UNKNOWN";
}

function buildSummaryText(
  topItems: Array<{ item: NewsItemInput; score: number }>,
  symbol: string,
  relevanceScore: number
): string {
  if (topItems.length === 0) return NO_NEWS_SUMMARY;

  const top = topItems[0].item;
  const text = top.summary?.trim() || top.headline;
  const snippet = text.length > 150 ? `${text.slice(0, 150)}...` : text;
  const countNote = topItems.length > 1 ? ` (${topItems.length} Meldungen)` : "";

  if (relevanceScore >= 70) {
    return `${symbol}: Hochrelevante Meldung – "${top.headline}"${countNote}.`;
  }

  return `${symbol}: ${snippet}${countNote}.`;
}

function buildRiskNote(sentiment: NewsContextSentiment, relevanceScore: number): string {
  if (sentiment === "NEGATIVE" && relevanceScore >= 60) {
    return "Negative Meldungen erhöhen das Risikoprofil. Technisches Signal mit Vorsicht bewerten.";
  }
  if (sentiment === "MIXED") {
    return "Widersprüchliche Meldungslage. Vorsicht geboten.";
  }
  return "";
}

function buildSourceNote(sources: string[]): string {
  const unique = [...new Set(sources)];
  if (unique.length === 0) return "";
  return unique.length === 1 ? `Quelle: ${unique[0]}.` : `Quellen: ${unique.join(", ")}.`;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

import { createHash } from "node:crypto";

// Keyword-basierte, bewusst konservative Vorklassifikation globaler News zu
// Market-Event-Kandidaten. Kein LLM, keine Spekulation: nur transparente
// Schlagwort-Treffer, niedrige Confidence, unklassifizierbare Items werden
// verworfen statt als Rauschen gespeichert.

export type MarketEventTypeLiteral =
  | "MACRO"
  | "CENTRAL_BANK"
  | "INFLATION"
  | "LABOR_MARKET"
  | "RATES"
  | "GEOPOLITICAL"
  | "SANCTIONS"
  | "CONFLICT"
  | "ENERGY_COMMODITY"
  | "SUPPLY_CHAIN"
  | "CORPORATE"
  | "RISK_SENTIMENT"
  | "OTHER";

export type MarketEventSeverityLiteral = "INFO" | "WATCH" | "IMPORTANT" | "CRITICAL";

export type GlobalNewsInput = {
  externalId: string | null;
  source: string;
  headline: string;
  summary?: string | null;
  url?: string | null;
  publishedAt: Date | string;
  category?: string | null;
};

export type MarketEventCandidate = {
  dedupKey: string;
  eventType: MarketEventTypeLiteral;
  severity: MarketEventSeverityLiteral;
  confidence: number;
  title: string;
  summary: string | null;
  region: string | null;
  source: string;
  sourceUrl: string | null;
  publishedAt: Date;
  reasoning: string;
  matchedKeywords: string[];
};

export type ClassifyGlobalNewsOptions = {
  feed?: string;
  maxTitleLength?: number;
  maxSummaryLength?: number;
};

const defaultFeed = "finnhub-general";
const defaultMaxTitleLength = 220;
const defaultMaxSummaryLength = 600;
const maxConfidence = 0.6;

type KeywordRule = {
  eventType: MarketEventTypeLiteral;
  keywords: string[];
};

// Reihenfolge = Tie-Break-Priorität bei gleicher Trefferzahl (spezifisch vor generisch).
const keywordRules: KeywordRule[] = [
  {
    eventType: "CENTRAL_BANK",
    keywords: [
      "federal reserve",
      "fed",
      "fomc",
      "ecb",
      "european central bank",
      "bank of japan",
      "boj",
      "bank of england",
      "rate decision",
      "powell",
      "lagarde",
      "zentralbank",
      "leitzins"
    ]
  },
  {
    eventType: "RATES",
    keywords: [
      "interest rate",
      "interest rates",
      "rate cut",
      "rate hike",
      "treasury yield",
      "bond yield",
      "bond yields",
      "zinssenkung",
      "zinserhoehung",
      "zinserhöhung"
    ]
  },
  {
    eventType: "INFLATION",
    keywords: [
      "inflation",
      "cpi",
      "consumer price",
      "consumer prices",
      "pce",
      "producer price",
      "producer prices",
      "ppi",
      "deflation",
      "disinflation"
    ]
  },
  {
    eventType: "LABOR_MARKET",
    keywords: [
      "payroll",
      "payrolls",
      "nonfarm",
      "unemployment",
      "jobless",
      "jobs report",
      "labor market",
      "labour market",
      "arbeitsmarkt"
    ]
  },
  {
    eventType: "SANCTIONS",
    keywords: [
      "sanction",
      "sanctions",
      "embargo",
      "export controls",
      "export ban",
      "tariff",
      "tariffs",
      "trade war"
    ]
  },
  {
    eventType: "CONFLICT",
    keywords: [
      "war",
      "invasion",
      "military strike",
      "missile",
      "airstrike",
      "air strike",
      "escalation",
      "ceasefire",
      "troops",
      "armed conflict",
      "offensive"
    ]
  },
  {
    eventType: "GEOPOLITICAL",
    keywords: [
      "geopolitical",
      "geopolitics",
      "election",
      "coup",
      "nato",
      "summit",
      "diplomatic",
      "north korea",
      "iran",
      "taiwan",
      "kremlin"
    ]
  },
  {
    eventType: "ENERGY_COMMODITY",
    keywords: [
      "oil",
      "opec",
      "crude",
      "brent",
      "wti",
      "natural gas",
      "energy prices",
      "gold",
      "silver",
      "copper",
      "wheat",
      "commodity",
      "commodities"
    ]
  },
  {
    eventType: "SUPPLY_CHAIN",
    keywords: [
      "supply chain",
      "supply chains",
      "shortage",
      "port strike",
      "shipping",
      "freight",
      "logistics",
      "suez",
      "panama canal",
      "semiconductor shortage"
    ]
  },
  {
    eventType: "CORPORATE",
    keywords: [
      "merger",
      "acquisition",
      "takeover",
      "bankruptcy",
      "insolvency",
      "antitrust",
      "mass layoffs",
      "ipo"
    ]
  },
  {
    eventType: "RISK_SENTIMENT",
    keywords: [
      "selloff",
      "sell-off",
      "market crash",
      "market rout",
      "vix",
      "risk-off",
      "risk appetite",
      "flight to safety",
      "circuit breaker",
      "plunge",
      "tumble",
      "record high",
      "rally"
    ]
  },
  {
    eventType: "MACRO",
    keywords: [
      "gdp",
      "recession",
      "economic growth",
      "economic outlook",
      "pmi",
      "consumer confidence",
      "retail sales",
      "industrial production",
      "trade deficit",
      "imf",
      "world bank",
      "stimulus"
    ]
  }
];

const urgencyKeywords = [
  "breaking",
  "emergency",
  "crash",
  "collapse",
  "crisis",
  "war",
  "invasion",
  "attack",
  "default",
  "plunge",
  "surge",
  "unexpected",
  "shock",
  "historic",
  "record"
];

type RegionRule = {
  region: string;
  keywords: string[];
};

const regionRules: RegionRule[] = [
  { region: "Russland/Ukraine", keywords: ["russia", "russian", "ukraine", "moscow", "kyiv", "kremlin"] },
  {
    region: "Naher Osten",
    keywords: ["middle east", "israel", "iran", "gaza", "saudi", "red sea", "hormuz", "lebanon"]
  },
  { region: "China", keywords: ["china", "chinese", "beijing", "hong kong"] },
  { region: "Japan", keywords: ["japan", "japanese", "boj", "tokyo", "yen"] },
  {
    region: "Europa",
    keywords: ["eurozone", "euro zone", "ecb", "europe", "european", "germany", "france", "eu"]
  },
  { region: "UK", keywords: ["uk", "britain", "british", "london", "bank of england", "pound"] },
  {
    region: "USA",
    keywords: ["u.s.", "us", "usa", "america", "american", "federal reserve", "fed", "washington", "wall street"]
  }
];

export function classifyGlobalNews(
  items: GlobalNewsInput[],
  options: ClassifyGlobalNewsOptions = {}
): MarketEventCandidate[] {
  const candidates: MarketEventCandidate[] = [];
  const seenDedupKeys = new Set<string>();

  for (const item of items) {
    const candidate = classifyGlobalNewsItem(item, options);

    if (!candidate) {
      continue;
    }

    if (seenDedupKeys.has(candidate.dedupKey)) {
      continue;
    }

    seenDedupKeys.add(candidate.dedupKey);
    candidates.push(candidate);
  }

  return candidates;
}

export function classifyGlobalNewsItem(
  item: GlobalNewsInput,
  options: ClassifyGlobalNewsOptions = {}
): MarketEventCandidate | null {
  const headline = item.headline?.trim();

  if (!headline) {
    return null;
  }

  const publishedAt = toDate(item.publishedAt);

  if (!publishedAt) {
    return null;
  }

  const text = `${headline} ${item.summary ?? ""}`.toLowerCase();
  const classification = classifyText(text);

  if (!classification) {
    return null;
  }

  const urgencyMatches = matchKeywords(text, urgencyKeywords);
  const severity = deriveSeverity(classification.matches.length, urgencyMatches.length);
  const confidence = deriveConfidence(classification.matches.length, urgencyMatches.length);
  const matchedKeywords = [...classification.matches, ...urgencyMatches];
  const maxTitleLength = options.maxTitleLength ?? defaultMaxTitleLength;
  const maxSummaryLength = options.maxSummaryLength ?? defaultMaxSummaryLength;

  return {
    dedupKey: buildDedupKey(options.feed ?? defaultFeed, item, publishedAt),
    eventType: classification.eventType,
    severity,
    confidence,
    title: truncate(headline, maxTitleLength),
    summary: item.summary ? truncate(item.summary.trim(), maxSummaryLength) || null : null,
    region: detectRegion(text),
    source: item.source,
    sourceUrl: item.url ?? null,
    publishedAt,
    reasoning: buildReasoning(classification.eventType, classification.matches, urgencyMatches),
    matchedKeywords
  };
}

function classifyText(
  text: string
): { eventType: MarketEventTypeLiteral; matches: string[] } | null {
  let best: { eventType: MarketEventTypeLiteral; matches: string[] } | null = null;

  for (const rule of keywordRules) {
    const matches = matchKeywords(text, rule.keywords);

    if (matches.length === 0) {
      continue;
    }

    if (!best || matches.length > best.matches.length) {
      best = { eventType: rule.eventType, matches };
    }
  }

  return best;
}

function matchKeywords(text: string, keywords: string[]): string[] {
  const matches: string[] = [];

  for (const keyword of keywords) {
    if (keywordPattern(keyword).test(text)) {
      matches.push(keyword);
    }
  }

  return matches;
}

const keywordPatternCache = new Map<string, RegExp>();

function keywordPattern(keyword: string): RegExp {
  let pattern = keywordPatternCache.get(keyword);

  if (!pattern) {
    // Wortgrenzen verhindern Substring-Treffer wie "war" in "software" oder "award".
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "iu");
    keywordPatternCache.set(keyword, pattern);
  }

  return pattern;
}

function deriveSeverity(categoryMatchCount: number, urgencyMatchCount: number): MarketEventSeverityLiteral {
  let level = 0;

  if (categoryMatchCount >= 2) {
    level += 1;
  }

  if (urgencyMatchCount >= 1) {
    level += 1;
  }

  if (urgencyMatchCount >= 3) {
    level += 1;
  }

  if (level >= 3) {
    return "CRITICAL";
  }

  if (level === 2) {
    return "IMPORTANT";
  }

  if (level === 1) {
    return "WATCH";
  }

  return "INFO";
}

function deriveConfidence(categoryMatchCount: number, urgencyMatchCount: number): number {
  const confidence = 0.3 + categoryMatchCount * 0.05 + urgencyMatchCount * 0.05;
  return Math.round(Math.min(maxConfidence, confidence) * 100) / 100;
}

function detectRegion(text: string): string | null {
  for (const rule of regionRules) {
    if (matchKeywords(text, rule.keywords).length > 0) {
      return rule.region;
    }
  }

  return null;
}

function buildReasoning(
  eventType: MarketEventTypeLiteral,
  categoryMatches: string[],
  urgencyMatches: string[]
): string {
  const parts = [
    `Keyword-basierte Einordnung als ${eventType}: ${categoryMatches.join(", ")}.`
  ];

  if (urgencyMatches.length > 0) {
    parts.push(`Dringlichkeits-Schlagworte: ${urgencyMatches.join(", ")}.`);
  }

  parts.push("Automatische Vorbewertung mit niedriger Confidence, Quelle prüfen.");
  return parts.join(" ");
}

function buildDedupKey(feed: string, item: GlobalNewsInput, publishedAt: Date): string {
  if (item.externalId) {
    return `${feed}:${item.externalId}`;
  }

  const normalizedHeadline = item.headline.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const hash = createHash("sha256").update(normalizedHeadline).digest("hex").slice(0, 16);
  return `${feed}:${publishedAt.toISOString().slice(0, 10)}:${hash}`;
}

function toDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

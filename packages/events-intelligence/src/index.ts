export type EventTypeLiteral = "EARNINGS" | "DIVIDEND" | "SPLIT" | "MACRO" | "OTHER";

export type EventRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "NONE";

export type EventInput = {
  id: string;
  symbol: string;
  eventType: string;
  title: string;
  eventDate: Date | string;
  fiscalQuarter?: string | null;
  fiscalYear?: number | null;
  epsEstimate?: string | number | null;
  epsActual?: string | number | null;
  revenueEstimate?: string | number | null;
  revenueActual?: string | number | null;
};

export type EventContextItem = {
  id: string;
  symbol: string;
  eventType: string;
  title: string;
  eventDate: string;
  fiscalQuarter: string | null;
  fiscalYear: number | null;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  daysFromNow: number;
};

export type EventContext = {
  hasUpcomingEvent: boolean;
  hasRecentEvent: boolean;
  upcomingEvents: EventContextItem[];
  recentEvents: EventContextItem[];
  nearestEvent: EventContextItem | null;
  eventRiskLevel: EventRiskLevel;
  daysToNearestEvent: number | null;
  daysSinceRecentEvent: number | null;
  summary: string;
  riskNote: string;
  sourceNote: string;
};

export type BuildEventContextInput = {
  asset: { symbol: string; assetType: string };
  signal: { createdAt: Date | string };
  events: EventInput[];
  now?: Date;
  upcomingWindowDays?: number;
  recentWindowDays?: number;
};

const ETF_SUMMARY = "Earnings/Event-Kontext für ETFs nicht anwendbar.";
const NO_EVENT_SUMMARY = "Kein relevantes Earnings/Event im Beobachtungsfenster gefunden.";

export function buildEventContextForSignal(input: BuildEventContextInput): EventContext {
  if (isEtf(input.asset.assetType)) {
    return etfContext();
  }

  const now = input.now ?? new Date();
  const upcomingWindowDays = input.upcomingWindowDays ?? 60;
  const recentWindowDays = input.recentWindowDays ?? 2;

  const mapped = input.events.map((event) => toContextItem(event, now));

  const upcoming = mapped
    .filter((item) => item.daysFromNow > 0 && item.daysFromNow <= upcomingWindowDays)
    .sort((a, b) => a.daysFromNow - b.daysFromNow);

  const recent = mapped
    .filter((item) => item.daysFromNow >= -recentWindowDays && item.daysFromNow <= 0)
    .sort((a, b) => b.daysFromNow - a.daysFromNow);

  if (upcoming.length === 0 && recent.length === 0) {
    return noEventContext();
  }

  const nearest = upcoming[0] ?? recent[0] ?? null;
  const daysToNearest = nearest && nearest.daysFromNow > 0 ? nearest.daysFromNow : null;
  const daysSinceRecent = recent[0] ? Math.abs(recent[0].daysFromNow) : null;

  const riskLevel = computeRiskLevel(upcoming, recent);
  const summary = buildSummary(input.asset.symbol, upcoming, recent, riskLevel);
  const riskNote = buildRiskNote(riskLevel, upcoming, recent);
  const sourceNote = upcoming.length > 0 || recent.length > 0 ? "Quelle: FINNHUB." : "";

  return {
    hasUpcomingEvent: upcoming.length > 0,
    hasRecentEvent: recent.length > 0,
    upcomingEvents: upcoming,
    recentEvents: recent,
    nearestEvent: nearest,
    eventRiskLevel: riskLevel,
    daysToNearestEvent: daysToNearest,
    daysSinceRecentEvent: daysSinceRecent,
    summary,
    riskNote,
    sourceNote
  };
}

function isEtf(assetType: string): boolean {
  return assetType.toUpperCase() === "ETF" || assetType.toLowerCase() === "etf";
}

function etfContext(): EventContext {
  return {
    hasUpcomingEvent: false,
    hasRecentEvent: false,
    upcomingEvents: [],
    recentEvents: [],
    nearestEvent: null,
    eventRiskLevel: "NONE",
    daysToNearestEvent: null,
    daysSinceRecentEvent: null,
    summary: ETF_SUMMARY,
    riskNote: "",
    sourceNote: ""
  };
}

function noEventContext(): EventContext {
  return {
    hasUpcomingEvent: false,
    hasRecentEvent: false,
    upcomingEvents: [],
    recentEvents: [],
    nearestEvent: null,
    eventRiskLevel: "NONE",
    daysToNearestEvent: null,
    daysSinceRecentEvent: null,
    summary: NO_EVENT_SUMMARY,
    riskNote: "",
    sourceNote: ""
  };
}

function toContextItem(event: EventInput, now: Date): EventContextItem {
  const eventDate = toDate(event.eventDate);
  const diffMs = eventDate.getTime() - now.getTime();
  const daysFromNow = Math.round(diffMs / (1000 * 60 * 60 * 24));

  return {
    id: event.id,
    symbol: event.symbol,
    eventType: event.eventType,
    title: event.title,
    eventDate: eventDate.toISOString(),
    fiscalQuarter: event.fiscalQuarter ?? null,
    fiscalYear: event.fiscalYear ?? null,
    epsEstimate: toNumber(event.epsEstimate),
    epsActual: toNumber(event.epsActual),
    revenueEstimate: toNumber(event.revenueEstimate),
    revenueActual: toNumber(event.revenueActual),
    daysFromNow
  };
}

function computeRiskLevel(
  upcoming: EventContextItem[],
  recent: EventContextItem[]
): EventRiskLevel {
  if (upcoming.length === 0 && recent.length === 0) return "NONE";

  if (upcoming.length > 0) {
    const days = upcoming[0].daysFromNow;
    if (days <= 3) return "HIGH";
    if (days <= 7) return "MEDIUM";
    return "LOW";
  }

  if (recent.length > 0) {
    const item = recent[0];
    if (hasLargeSurprise(item)) return "HIGH";
    const hasActuals = item.epsActual !== null || item.revenueActual !== null;
    return hasActuals ? "MEDIUM" : "LOW";
  }

  return "NONE";
}

function hasLargeSurprise(item: EventContextItem): boolean {
  return (
    hasLargeRelativeSurprise(item.epsActual, item.epsEstimate) ||
    hasLargeRelativeSurprise(item.revenueActual, item.revenueEstimate)
  );
}

function hasLargeRelativeSurprise(actual: number | null, estimate: number | null): boolean {
  if (actual === null || estimate === null || estimate === 0) return false;
  return Math.abs((actual - estimate) / estimate) >= 0.15;
}

function buildSummary(
  symbol: string,
  upcoming: EventContextItem[],
  recent: EventContextItem[],
  riskLevel: EventRiskLevel
): string {
  if (upcoming.length > 0) {
    const next = upcoming[0];
    const days = next.daysFromNow;
    const quarter = next.fiscalQuarter ? `Q${next.fiscalQuarter}` : null;
    const year = next.fiscalYear ? String(next.fiscalYear) : null;
    const period = [quarter, year].filter(Boolean).join(" ");
    const periodNote = period ? ` (${period})` : "";
    if (riskLevel === "HIGH") {
      return `${symbol}: Earnings in ${days} Tag${days === 1 ? "" : "en"}${periodNote} – hohes Event-Risiko.`;
    }
    return `${symbol}: Earnings in ${days} Tag${days === 1 ? "" : "en"}${periodNote}.`;
  }

  if (recent.length > 0) {
    const last = recent[0];
    const daysSince = Math.abs(last.daysFromNow);
    const epsNote =
      last.epsActual !== null
        ? ` EPS Actual: ${last.epsActual}`
        : "";
    return `${symbol}: Earnings vor ${daysSince} Tag${daysSince === 1 ? "" : "en"}.${epsNote}`;
  }

  return NO_EVENT_SUMMARY;
}

function buildRiskNote(
  riskLevel: EventRiskLevel,
  upcoming: EventContextItem[],
  recent: EventContextItem[]
): string {
  if (riskLevel === "HIGH") {
    return "Earnings sehr nah – erhöhte Volatilität möglich. Signal mit Vorsicht bewerten.";
  }
  if (riskLevel === "MEDIUM") {
    const hasUpcoming = upcoming.length > 0;
    if (hasUpcoming) {
      return "Earnings in kürze – erhöhte Volatilität möglich.";
    }
    const hasActuals = recent[0]?.epsActual !== null;
    return hasActuals
      ? "Earnings-Reaktion möglicherweise noch nicht vollständig eingepreist."
      : "Earnings kürzlich – Marktreaktion beobachten.";
  }
  if (riskLevel === "LOW") {
    return "Earnings im Beobachtungsfenster – kein unmittelbares Risiko.";
  }
  return "";
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

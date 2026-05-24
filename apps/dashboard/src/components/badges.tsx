import type {
  MarketRegime,
  MultiTimeframeAlignment,
  RiskLevel,
  RiskMode,
  SignalDirection,
  SignalStatus,
  WatchlistPriority
} from "../lib/signalpilot-api";

export function StatusBadge({ value }: { value: SignalStatus | string }) {
  const labels: Record<string, string> = {
    STRONG_WATCH: "Starke Beobachtung",
    WATCH: "Beobachten",
    WAIT: "Abwarten",
    AVOID: "Meiden",
    NO_EDGE: "Kein Vorteil"
  };
  return (
    <span className={`badge status-${value.toLowerCase()}`}>
      {labels[value] ?? value}
    </span>
  );
}

export function DirectionBadge({ value }: { value: SignalDirection | string }) {
  const labels: Record<string, string> = {
    BULLISH: "Aufwärts",
    BEARISH: "Abwärts",
    NEUTRAL: "Neutral",
    MIXED: "Gemischt"
  };
  return (
    <span className={`badge direction-${value.toLowerCase()}`}>
      {labels[value] ?? value}
    </span>
  );
}

export function RiskBadge({ value }: { value: RiskLevel | string }) {
  const labels: Record<string, string> = {
    LOW: "Risiko: Niedrig",
    MEDIUM: "Risiko: Mittel",
    HIGH: "Risiko: Hoch"
  };
  return (
    <span className={`badge risk-${value.toLowerCase()}`}>
      {labels[value] ?? value}
    </span>
  );
}

export function PriorityBadge({ value }: { value: WatchlistPriority | string }) {
  const labels: Record<string, string> = {
    LOW: "Prio: Niedrig",
    MEDIUM: "Prio: Mittel",
    HIGH: "Prio: Hoch"
  };
  return (
    <span className={`badge risk-${value.toLowerCase()}`}>
      {labels[value] ?? value}
    </span>
  );
}

export function AlignmentBadge({ value }: { value: MultiTimeframeAlignment | string }) {
  const labels: Record<string, string> = {
    BULLISH_ALIGNED: "Multi-TF: Aufwärts",
    BEARISH_ALIGNED: "Multi-TF: Abwärts",
    MIXED: "Multi-TF: Gemischt",
    SHORT_TERM_ONLY: "Nur kurzfristig",
    HIGHER_TIMEFRAME_CONFIRMATION: "HTF-Bestätigung",
    CONFLICT: "Multi-TF: Konflikt",
    NO_EDGE: "Multi-TF: Kein Vorteil"
  };
  return (
    <span className={`badge alignment-${value.toLowerCase()}`}>
      {labels[value] ?? value}
    </span>
  );
}

export function HealthBadge({ ok }: { ok: boolean }) {
  return (
    <span className={`badge ${ok ? "health-ok" : "health-fail"}`}>
      {ok ? "OK" : "DOWN"}
    </span>
  );
}

export function RegimeBadge({ value }: { value: MarketRegime | string }) {
  const labels: Record<string, string> = {
    RISK_ON: "Risk-On",
    RISK_OFF: "Risk-Off",
    MIXED: "Gemischt",
    NEUTRAL: "Neutral",
    UNKNOWN: "Unbekannt"
  };
  return (
    <span className={`regime-tag regime-tag-${value.toLowerCase()}`}>
      {labels[value] ?? value}
    </span>
  );
}

export function RiskModeBadge({ value }: { value: RiskMode | string }) {
  const labels: Record<string, string> = {
    AGGRESSIVE: "Aggressiv",
    NORMAL: "Normal",
    DEFENSIVE: "Defensiv",
    HIGH_RISK: "Hohes Risiko",
    UNKNOWN: "Unbekannt"
  };
  return (
    <span className={`regime-tag regime-tag-${value.toLowerCase()}`}>
      {labels[value] ?? value}
    </span>
  );
}

export function ContextBadge({
  type,
  level
}: {
  type: "news" | "events" | "regime" | "rules";
  level: string;
}) {
  const labels: Record<string, Record<string, string>> = {
    news: {
      none: "News: —",
      relevant: "News: Relevant",
      high: "News: Hoch"
    },
    events: {
      none: "Events: —",
      upcoming: "Event: Bald",
      high: "Event: Hochrisiko"
    },
    regime: {
      aligned: "Regime: Bestätigt",
      conflict: "Regime: Konflikt",
      neutral: "Regime: Neutral"
    },
    rules: {
      adjusted: "Rules: Angepasst",
      none: "Rules: —"
    }
  };
  const label = labels[type]?.[level] ?? `${type}: ${level}`;
  return (
    <span className={`badge context-${type}-${level}`}>{label}</span>
  );
}

export function ScoreBadge({
  value,
  originalValue,
  label = "Signalqualität"
}: {
  value: number | null | undefined;
  originalValue?: number | null;
  label?: string;
}) {
  if (typeof value !== "number") {
    return (
      <div className="score-badge">
        <span className="score-badge-value">—</span>
        <span className="score-badge-label">{label}</span>
      </div>
    );
  }

  const tier =
    value >= 7 ? "score-badge-high" : value >= 4 ? "score-badge-medium" : "score-badge-risk";
  const isAdjusted =
    typeof originalValue === "number" && Math.abs(originalValue - value) > 0.05;

  return (
    <div className={`score-badge ${tier}`}>
      <span className="score-badge-value">{value.toFixed(1)}</span>
      {isAdjusted ? (
        <span className="score-badge-orig">orig. {originalValue?.toFixed(1)}</span>
      ) : null}
      <span className="score-badge-label">{label}</span>
    </div>
  );
}

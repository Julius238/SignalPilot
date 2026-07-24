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
    STRONG_WATCH: "Hohe Relevanz",
    WATCH: "Beobachten",
    WAIT: "Noch unklar",
    AVOID: "Erhöhte Unsicherheit",
    NO_EDGE: "Geringe Relevanz"
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
      {ok ? "Verfügbar" : "Nicht verfügbar"}
    </span>
  );
}

export function RegimeBadge({ value }: { value: MarketRegime | string }) {
  const labels: Record<string, string> = {
    RISK_ON: "Konstruktives Umfeld",
    RISK_OFF: "Defensives Umfeld",
    MIXED: "Gemischtes Umfeld",
    NEUTRAL: "Neutrales Umfeld",
    UNKNOWN: "Noch keine Einschätzung"
  };
  const explanations: Record<string, string> = {
    RISK_ON: "Marktteilnehmer akzeptieren derzeit eher Risiko.",
    RISK_OFF: "Stabilität und Schutz stehen derzeit stärker im Vordergrund.",
    MIXED: "Die beobachteten Märkte senden unterschiedliche Signale.",
    NEUTRAL: "Es gibt aktuell keine klare übergeordnete Tendenz.",
    UNKNOWN: "Für eine belastbare Einordnung fehlen noch Daten."
  };
  return (
    <span
      className={`regime-tag regime-tag-${value.toLowerCase()}`}
      title={explanations[value]}
    >
      {labels[value] ?? value}
    </span>
  );
}

export function RiskModeBadge({ value }: { value: RiskMode | string }) {
  const labels: Record<string, string> = {
    AGGRESSIVE: "Risikofreudiges Klima",
    NORMAL: "Ausgeglichenes Klima",
    DEFENSIVE: "Vorsichtiges Klima",
    HIGH_RISK: "Erhöhte Unsicherheit",
    UNKNOWN: "Risikoklima offen"
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
      none: "Nachrichten: —",
      relevant: "Nachrichten: Relevant",
      high: "Nachrichten: Hoch"
    },
    events: {
      none: "Termine: —",
      upcoming: "Termin: Bald",
      high: "Termin: Hohes Risiko"
    },
    regime: {
      aligned: "Marktlage: Bestätigt",
      conflict: "Marktlage: Konflikt",
      neutral: "Marktlage: Neutral"
    },
    rules: {
      adjusted: "Regeln: Angepasst",
      none: "Regeln: —"
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
    value >= 70
      ? "score-badge-high"
      : value >= 50
        ? "score-badge-medium"
        : "score-badge-risk";
  const isAdjusted =
    typeof originalValue === "number" && Math.abs(originalValue - value) > 0.05;
  const meaning =
    value >= 75
      ? "hohe Relevanz"
      : value >= 60
        ? "gute Relevanz"
        : value >= 45
          ? "gemischtes Bild"
          : "geringe Relevanz";

  return (
    <div className={`score-badge ${tier}`} title={`${label}: ${meaning}`}>
      <span className="score-badge-value">{value.toFixed(1)}</span>
      {isAdjusted ? (
        <span className="score-badge-orig">orig. {originalValue?.toFixed(1)}</span>
      ) : null}
      <span className="score-badge-label">{label}</span>
      <span className="score-badge-meaning">{meaning}</span>
    </div>
  );
}

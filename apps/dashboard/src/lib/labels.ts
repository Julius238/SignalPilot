// Zentrale, typisierte Zuordnung von Roh-Enums und Engine-Texten auf deutsche Anzeige-
// texte. Grundsatz: technische Werte erscheinen nie roh im UI, und es gibt keine
// unkontrollierte String-Ersetzung — jede Übersetzung ist eine explizit gepflegte Regel
// mit Rückfall auf den Originalwert, falls etwas nicht abgedeckt ist.
//
// Ergänzt den Verständlichkeits-Layer in components/dashboard/shared.ts (Radar/Events);
// dieses Modul deckt Signale, Zeitebenen, Datenqualität, Logs und Audit ab.

// ── Asset-Typen ─────────────────────────────────────────────────────────────
const ASSET_TYPE_LABELS: Record<string, string> = {
  CRYPTO: "Krypto",
  STOCK: "Aktie",
  EQUITY: "Aktie",
  ETF: "ETF",
  INDEX: "Index"
};

export function assetTypeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return ASSET_TYPE_LABELS[value] ?? value;
}

// ── Asset-Universe (Rolle und Herkunft) ─────────────────────────────────────
const UNIVERSE_ROLE_LABELS: Record<string, string> = {
  CORE: "Kernbestand",
  ACTIVE: "Aktiv beobachtet",
  DISCOVERY: "Frühe Beobachtung",
  INACTIVE: "Nicht beobachtet"
};

const UNIVERSE_SOURCE_LABELS: Record<string, string> = {
  CORE: "Kernbestand",
  PINNED: "Angeheftet",
  AUTO_DISCOVERED: "Automatisch gefunden",
  MANUAL: "Manuell hinzugefügt",
  EXCLUDED: "Ausgeschlossen",
  INACTIVE: "Nicht beobachtet"
};

export function universeRoleLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return UNIVERSE_ROLE_LABELS[value] ?? value;
}

export function universeSourceLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return UNIVERSE_SOURCE_LABELS[value] ?? value;
}

// ── Signalart (SignalType) ──────────────────────────────────────────────────
const SIGNAL_TYPE_LABELS: Record<string, string> = {
  MOMENTUM_ALERT: "Tempo-Beobachtung",
  TREND_ALERT: "Trend-Beobachtung",
  VOLUME_SPIKE: "Ungewöhnlich viel Handel",
  VOLATILITY_SPIKE: "Erhöhte Schwankung",
  BREAKOUT_ALERT: "Ausbruchsnähe",
  NEWS_REACTION: "Reaktion auf Nachrichten",
  EVENT_IMPACT: "Termin-Auswirkung",
  NO_SIGNAL: "Keine Auffälligkeit"
};

const SIGNAL_TYPE_EXPLANATIONS: Record<string, string> = {
  MOMENTUM_ALERT: "Die Bewegungsdynamik hat sich spürbar verändert.",
  TREND_ALERT: "Die Trendstruktur des Kurses ist auffällig geworden.",
  VOLUME_SPIKE: "Es wurde deutlich mehr gehandelt als zuletzt üblich.",
  VOLATILITY_SPIKE: "Die Kursschwankungen sind größer als gewohnt.",
  BREAKOUT_ALERT: "Der Kurs nähert sich dem Rand seiner jüngsten Spanne.",
  NEWS_REACTION: "Die Bewegung fällt mit Nachrichten zu diesem Wert zusammen.",
  EVENT_IMPACT: "Ein bekannter Unternehmenstermin wirkt auf die Einordnung.",
  NO_SIGNAL: "Die Auswertung hat nichts Auffälliges gefunden — das ist ein normaler Zustand."
};

export function signalTypeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return SIGNAL_TYPE_LABELS[value] ?? value;
}

export function signalTypeExplanation(value: string | null | undefined): string | null {
  if (!value) return null;
  return SIGNAL_TYPE_EXPLANATIONS[value] ?? null;
}

// ── Signalstatus (SignalStatus) ─────────────────────────────────────────────
const SIGNAL_STATUS_EXPLANATIONS: Record<string, string> = {
  STRONG_WATCH: "Mehrere Faktoren sprechen gleichzeitig an — zuerst ansehen.",
  WATCH: "Auffällig genug, um es im Blick zu behalten.",
  WAIT: "Das Bild ist noch nicht eindeutig; eine Bestätigung fehlt.",
  AVOID: "Erhöhte Unsicherheit — die Risikofaktoren überwiegen derzeit.",
  NO_EDGE: "Kein belastbarer Informationsvorteil erkennbar."
};

export function signalStatusExplanation(value: string | null | undefined): string | null {
  if (!value) return null;
  return SIGNAL_STATUS_EXPLANATIONS[value] ?? null;
}

// ── Zeitebenen-Ausrichtung (MultiTimeframeAlignment) ────────────────────────
const ALIGNMENT_EXPLANATIONS: Record<string, string> = {
  BULLISH_ALIGNED: "Kurze und lange Zeitebenen zeigen beide nach oben.",
  BEARISH_ALIGNED: "Kurze und lange Zeitebenen zeigen beide nach unten.",
  MIXED: "Die Zeitebenen liefern verwertbare, aber uneinheitliche Signale.",
  SHORT_TERM_ONLY: "Nur die kurze Zeitebene ist auffällig; die längeren bestätigen es nicht.",
  HIGHER_TIMEFRAME_CONFIRMATION: "Die längere Zeitebene stützt das kurzfristige Bild.",
  CONFLICT: "Die Zeitebenen widersprechen einander direkt.",
  NO_EDGE: "Über die Zeitebenen hinweg ist kein Vorteil erkennbar."
};

export function alignmentExplanation(value: string | null | undefined): string | null {
  if (!value) return null;
  return ALIGNMENT_EXPLANATIONS[value] ?? null;
}

// ── Zeitebenen-Kürzel ───────────────────────────────────────────────────────
const TIMEFRAME_LABELS: Record<string, string> = {
  "1h": "1 Stunde",
  "4h": "4 Stunden",
  "1d": "1 Tag"
};

export function timeframeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return TIMEFRAME_LABELS[value] ?? value;
}

// ── Log-Level ───────────────────────────────────────────────────────────────
const LOG_LEVEL_LABELS: Record<string, string> = {
  ERROR: "Fehler",
  WARN: "Warnung",
  WARNING: "Warnung",
  INFO: "Info",
  DEBUG: "Debug"
};

export type LogTone = "error" | "warn" | "info" | "neutral";

export function logLevelLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return LOG_LEVEL_LABELS[value.toUpperCase()] ?? value.toUpperCase();
}

export function logLevelTone(value: string | null | undefined): LogTone {
  const upper = value?.toUpperCase();
  if (upper === "ERROR") return "error";
  if (upper === "WARN" || upper === "WARNING") return "warn";
  if (upper === "INFO") return "info";
  return "neutral";
}

// ── Audit-Aktionen ──────────────────────────────────────────────────────────
const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: "Anmeldung",
  login_success: "Anmeldung erfolgreich",
  login_failed: "Anmeldung fehlgeschlagen",
  logout: "Abmeldung",
  dev_login: "Entwickler-Anmeldung",
  watchlist_create: "Watchlist-Eintrag angelegt",
  watchlist_update: "Watchlist-Eintrag geändert",
  watchlist_delete: "Watchlist-Eintrag entfernt",
  universe_preference_update: "Universe-Einstellung geändert",
  backtest_run_requested: "Backtest gestartet",
  strategy_comparison_requested: "Strategievergleich gestartet",
  trading_run_job: "Trading-Job ausgeführt",
  trading_activate_portfolio: "Trading-Portfolio aktiviert",
  trading_pause_session: "Trading-Sitzung pausiert",
  trading_activate_session: "Trading-Sitzung aktiviert",
  trading_engage_kill_switch: "Not-Aus aktiviert",
  trading_release_kill_switch: "Not-Aus gelöst",
  trading_manual_close: "Manuelles Schließen angefordert"
};

export type AuditTone = "success" | "warn" | "error" | "neutral";

export function auditActionLabel(action: string): string {
  const known = AUDIT_ACTION_LABELS[action.toLowerCase()];
  if (known) return known;
  // Unbekannte Aktionen lesbar machen, ohne den Rohwert zu verlieren
  // (der steht weiter im aufklappbaren Detailbereich).
  return action.replaceAll("_", " ");
}

export function auditActionTone(action: string): AuditTone {
  const value = action.toLowerCase();
  if (value.includes("fail") || value.includes("delete") || value.includes("kill_switch")) {
    return value.includes("release") ? "neutral" : "error";
  }
  if (value.includes("pause") || value.includes("dev_login")) return "warn";
  if (value.includes("success") || value.includes("create") || value.includes("activate")) {
    return "success";
  }
  return "neutral";
}

// ── Engine-Texte: Englisch → Deutsch ────────────────────────────────────────
// Die Sätze stammen aus packages/scoring-engine und liegen bereits als Text in der
// Datenbank. Sie werden hier bei der Anzeige übersetzt — eine feste Liste, kein
// Musterraten. Was nicht in der Liste steht, bleibt unverändert stehen.
const ANALYSIS_TEXTS: Record<string, string> = {
  // Nächster Auslöser / nächste Bestätigung
  "Wait for risk to cool down and trend structure to improve.":
    "Abwarten, bis das Risiko nachlässt und die Trendstruktur klarer wird.",
  "Watch for price to hold above sma20 with relativeVolume above 1.5.":
    "Beobachten, ob der Kurs über dem 20er-Durchschnitt bleibt und das Handelsvolumen erhöht ist.",
  "Wait for price to reclaim sma50 before reconsidering.":
    "Abwarten, bis der Kurs den 50er-Durchschnitt zurückerobert.",
  "Watch for a clean break above the 20-period high with volume confirmation.":
    "Beobachten, ob der Kurs das 20-Perioden-Hoch klar überschreitet — mit Bestätigung durch das Handelsvolumen.",
  "Wait for clearer trend, momentum, or volume confirmation.":
    "Abwarten, bis Trend, Tempo oder Handelsvolumen ein klareres Bild ergeben.",

  // Gegenargumente / Konflikte
  "News context is neutral because no news integration is connected yet.":
    "Der Nachrichten-Kontext ist neutral, weil noch keine Nachrichtenquelle angebunden ist.",
  "Event context is neutral because no event integration is connected yet.":
    "Der Termin-Kontext ist neutral, weil noch keine Terminquelle angebunden ist.",
  "Social context is neutral for v1.":
    "Der Social-Media-Kontext wird in dieser Version noch nicht ausgewertet.",
  "Need lastClose, sma20 and sma50 before trend can be trusted.":
    "Für eine belastbare Trendaussage fehlen Schlusskurs und gleitende Durchschnitte.",
  "Moving averages do not show a clean directional structure.":
    "Die gleitenden Durchschnitte zeigen keine klare Richtung.",
  "Need periodHigh20 and periodLow20 to evaluate breakout proximity.":
    "Für die Bewertung der Ausbruchsnähe fehlen das 20-Perioden-Hoch und -Tief.",
  "A flat range makes high/low proximity unreliable.":
    "Bei einer sehr engen Kursspanne ist die Nähe zu Hoch und Tief wenig aussagekräftig.",
  "Price is not close enough to the period high or low.":
    "Der Kurs ist weder nahe am Hoch noch am Tief der betrachteten Spanne.",
  "Need averageVolume20 and lastVolume for volume confirmation.":
    "Für die Volumenbestätigung fehlen das durchschnittliche und das letzte Handelsvolumen.",
  "Low participation weakens technical confirmation.":
    "Die geringe Handelsbeteiligung schwächt die technische Bestätigung.",
  "Volume is not confirming an exceptional move.":
    "Das Handelsvolumen bestätigt keine außergewöhnliche Bewegung.",
  "Need atr14 relative to price to evaluate volatility.":
    "Für die Bewertung der Schwankungsbreite fehlt das Verhältnis von ATR zum Kurs.",
  "Very high volatility increases execution and false-breakout risk.":
    "Sehr hohe Schwankungen erhöhen das Risiko von Fehlausbrüchen.",
  "Elevated volatility needs careful confirmation.":
    "Erhöhte Schwankungen brauchen eine sorgfältige Bestätigung.",
  "Need rsi14 for momentum quality.":
    "Für die Bewertung der Tempo-Qualität fehlt der RSI.",
  "RSI above 75 is overheated and increases pullback risk.":
    "Ein RSI über 75 gilt als überhitzt und erhöht die Rückschlaggefahr.",
  "Oversold is not automatically bullish without trend confirmation.":
    "Ein überverkaufter Zustand ist ohne Trendbestätigung noch kein Aufwärtssignal."
};

export function germanizeAnalysisText(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  return ANALYSIS_TEXTS[trimmed] ?? repairAsciiUmlauts(trimmed);
}

// ── ASCII-Umlaute aus packages/multi-timeframe reparieren ───────────────────
// Bewusst eine feste Wortliste statt einer allgemeinen ae/oe/ue-Regel: Letztere würde
// korrekte Wörter wie "Steuer", "neue" oder "Aktien" zerstören.
const ASCII_UMLAUT_WORDS: Array<[RegExp, string]> = [
  [/\bfuehrende\b/g, "führende"],
  [/\bfuehrender\b/g, "führender"],
  [/\bfuehrenden\b/g, "führenden"],
  [/\bbestaetigt\b/g, "bestätigt"],
  [/\bbestaetigen\b/g, "bestätigen"],
  [/\bbestaetigung\b/g, "bestätigung"],
  [/\bBestaetigung\b/g, "Bestätigung"],
  [/\bnaechstes\b/g, "nächstes"],
  [/\bnaechste\b/g, "nächste"],
  [/\bstaerkeres\b/g, "stärkeres"],
  [/\bstaerkere\b/g, "stärkere"],
  [/\bhoehere\b/g, "höhere"],
  [/\bhoeheren\b/g, "höheren"],
  [/\baufgeloest\b/g, "aufgelöst"],
  [/\bunterstuetzt\b/g, "unterstützt"],
  [/\bgegenlaeufig\b/g, "gegenläufig"],
  [/\bwaehrend\b/g, "während"],
  [/\bmoeglich\b/g, "möglich"],
  [/\bmoegliche\b/g, "mögliche"]
];

// "Timeframe" heißt im UI "Zeitebene" — das ändert aber das Geschlecht (der → die).
// Deshalb zuerst die vollständigen Phrasen ersetzen, danach erst einzelne Wörter.
const PHRASE_RULES: Array<[RegExp, string]> = [
  [/\bder fuehrende Timeframe\b/g, "die führende Zeitebene"],
  [/\bkein fuehrender Timeframe\b/g, "keine führende Zeitebene"],
  [/\bder fuehrenden Timeframes\b/g, "der führenden Zeitebenen"],
  [/\bdie hoehere Timeframe-Lage\b/g, "das Bild der längeren Zeitebene"],
  [/\bhoehere Timeframe-Lage\b/g, "Bild der längeren Zeitebene"]
];

export function repairAsciiUmlauts(text: string): string {
  let result = text;
  for (const [pattern, replacement] of PHRASE_RULES) {
    result = result.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of ASCII_UMLAUT_WORDS) {
    result = result.replace(pattern, replacement);
  }
  return result
    .replace(/\bTimeframes\b/g, "Zeitebenen")
    .replace(/\bTimeframe\b/g, "Zeitebene");
}

// ── Datenqualitäts-Warnungen: Englisch → Deutsch ────────────────────────────
// Die Meldungen aus packages/data-quality sind Template-Strings. Deshalb hier
// Muster mit Platzhaltern statt exakter Gleichheit — jedes Muster ist explizit
// aufgeführt, und ohne Treffer bleibt der Originaltext stehen.
const WARNING_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [
    /^(.+) has insufficient (.+) candle coverage\.$/,
    (m) => `${m[1]}: zu wenige Kursdaten auf der Zeitebene ${m[2]}.`
  ],
  [
    /^(.+) has no crypto signals in the last 24h\.$/,
    (m) => `${m[1]}: in den letzten 24 Stunden kein Krypto-Signal erzeugt.`
  ],
  [
    /^(.+) has no stored events in the \+\/- 60 day window\.$/,
    (m) => `${m[1]}: keine Unternehmenstermine im Fenster von ±60 Tagen gespeichert.`
  ],
  [
    /^(.+) has a high skipped evaluation rate\.$/,
    (m) => `${m[1]}: auffällig viele Auswertungen wurden übersprungen.`
  ],
  [
    /^(.+) has alert states but no successful alerts\.$/,
    (m) => `${m[1]}: Benachrichtigungen waren vorgesehen, aber keine wurde zugestellt.`
  ],
  [
    /^(\d+) assets are below minimum candle coverage for (.+)\.$/,
    (m) => `${m[1]} Assets liegen auf der Zeitebene ${m[2]} unter der Mindestabdeckung.`
  ],
  [
    /^(\d+) signals have no Paper Evaluation\.$/,
    (m) => `${m[1]} Signale wurden noch nicht rückblickend ausgewertet.`
  ],
  [/^Many Paper Evaluations are skipped\.$/, () => "Viele Auswertungen werden übersprungen."],
  [
    /^Alert states exist but no successful alerts were found\.$/,
    () => "Es waren Benachrichtigungen vorgesehen, aber keine wurde zugestellt."
  ],
  [
    /^(.+) has (\d+) detected candle gaps\.$/,
    (m) => `${m[1]}: ${m[2]} Lücken in den Kursdaten erkannt.`
  ],
  [
    /^(.+) has (\d+) provider errors\.$/,
    (m) => `${m[1]}: ${m[2]} Fehler beim Datenanbieter.`
  ],
  [
    /^(.+) has (\d+) HTTP 403 entitlement errors\.$/,
    (m) => `${m[1]}: ${m[2]}× Zugriff verweigert (fehlende Berechtigung beim Anbieter).`
  ],
  [
    /^(.+) has (\d+) stale candle series\.$/,
    (m) => `${m[1]}: ${m[2]} Kursreihen sind nicht mehr aktuell.`
  ]
];

export function germanizeDataQualityText(text: string): string {
  const trimmed = text.trim();
  for (const [pattern, build] of WARNING_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return build(match);
  }
  return RECOMMENDATION_TEXTS[trimmed] ?? trimmed;
}

// ── Performance-Texte ───────────────────────────────────────────────────────
// packages/performance-intelligence liefert deutsche Sätze, verwendet darin aber
// die internen Begriffe "Paper Evaluation", "WinRate" und "SKIPPED".
const PERFORMANCE_TERMS: Array<[RegExp, string]> = [
  [/\bPaper Evaluations\b/g, "rückblickende Auswertungen"],
  [/\bPaper Evaluation\b/g, "rückblickende Auswertung"],
  [/\bEvaluations\b/g, "Auswertungen"],
  [/\bGesamt-WinRate\b/g, "Trefferquote insgesamt"],
  [/\bWinRate\b/g, "Trefferquote"],
  [/\bSKIPPED\b/g, "übersprungen"]
];

export function germanizePerformanceText(text: string | null | undefined): string | null {
  if (!text) return null;
  let result = text;
  for (const [pattern, replacement] of PERFORMANCE_TERMS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// Empfehlungen sind feste Sätze — hier als Nutzeraussage formuliert, nicht als
// CLI-Anweisung.
const RECOMMENDATION_TEXTS: Record<string, string> = {
  "Backfill candles for low-coverage assets and timeframes.":
    "Fehlende Kursdaten für schlecht abgedeckte Assets und Zeitebenen nachladen.",
  "Inspect provider job metadata before changing the Finnhub configuration.":
    "Erst die Job-Protokolle des Datenanbieters ansehen, bevor die Anbieter-Konfiguration geändert wird.",
  "Run the bounded candle gap audit.": "Die Prüfung auf Lücken in den Kursdaten anstoßen.",
  "Run the Paper Evaluation backfill worker.":
    "Fehlende rückblickende Auswertungen nachträglich erzeugen lassen.",
  "Run the Paper Evaluation reclassification worker.":
    "Ältere Auswertungen mit den aktuellen Regeln neu einordnen lassen.",
  "Check alert routing and n8n delivery health.":
    "Zustellweg der Benachrichtigungen prüfen.",
  "Continue monitoring data quality after each pipeline run.":
    "Weiter beobachten: Datenqualität nach jedem Datenlauf erneut prüfen."
};

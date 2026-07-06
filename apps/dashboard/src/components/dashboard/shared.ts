import type { MarketEvent, RadarEvent } from "../../lib/signalpilot-api";

// Gemeinsame Labels/Farben für alle Command-Center-Sektionen.
// Severity wird überall als verständliches Prioritäts-Label angezeigt, nie als rohes Enum.

export type Severity = RadarEvent["severity"];

export function severityColor(severity: Severity | undefined): string | undefined {
  if (severity === "CRITICAL") return "var(--bad)";
  if (severity === "IMPORTANT") return "var(--warn)";
  if (severity === "WATCH") return "var(--accent)";
  return undefined;
}

export function severityLabel(severity: Severity | undefined): string {
  if (severity === "CRITICAL") return "Hochrelevant";
  if (severity === "IMPORTANT") return "Wichtig";
  if (severity === "WATCH") return "Beobachten";
  return "Nur Information";
}

export function severityRank(severity: Severity | undefined): number {
  if (severity === "CRITICAL") return 4;
  if (severity === "IMPORTANT") return 3;
  if (severity === "WATCH") return 2;
  return 1;
}

export function radarEventTypeLabel(eventType: RadarEvent["eventType"] | string | undefined): string {
  if (eventType === "MOVEMENT_SPIKE") return "Auffällige Bewegung";
  if (eventType === "VOLUME_SPIKE") return "Volumen auffällig";
  if (eventType === "VOLATILITY_SPIKE") return "Erhöhte Volatilität";
  if (eventType === "SCORE_CHANGE") return "Score-Veränderung";
  if (eventType === "REGIME_CHANGE") return "Marktumfeld";
  if (eventType === "BREAKOUT_PROXIMITY") return "Möglicher Ausbruchsbereich";
  if (eventType === "SR_PROXIMITY") return "Support/Resistance-Nähe";
  if (eventType === "MOMENTUM_SHIFT") return "Momentum-Wechsel";
  if (eventType === "CONFLUENCE") return "Konfluenz";
  return "Beobachtung";
}

export const chartPatternEventTypes: Array<RadarEvent["eventType"]> = [
  "BREAKOUT_PROXIMITY",
  "SR_PROXIMITY",
  "MOMENTUM_SHIFT",
  "CONFLUENCE"
];

export const marketEventTypeLabels: Record<MarketEvent["eventType"], string> = {
  MACRO: "Makro",
  CENTRAL_BANK: "Zentralbank",
  INFLATION: "Inflation",
  LABOR_MARKET: "Arbeitsmarkt",
  RATES: "Zinsen",
  GEOPOLITICAL: "Geopolitik",
  SANCTIONS: "Sanktionen",
  CONFLICT: "Konflikt",
  ENERGY_COMMODITY: "Energie/Rohstoffe",
  SUPPLY_CHAIN: "Lieferkette",
  CORPORATE: "Unternehmen",
  RISK_SENTIMENT: "Risiko-Stimmung",
  OTHER: "Sonstiges"
};

export function pipelineStatusColor(status: string | undefined): string | undefined {
  if (status === "SUCCESS") return "var(--good)";
  if (status === "FAILED") return "var(--bad)";
  if (status === "RUNNING") return "var(--accent)";
  return undefined;
}

export function withinHours(isoTime: string | null | undefined, hours: number, now: Date): boolean {
  if (!isoTime) return false;
  const timestamp = new Date(isoTime).getTime();
  return Number.isFinite(timestamp) && now.getTime() - timestamp <= hours * 3_600_000;
}

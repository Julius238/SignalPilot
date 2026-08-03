// Formatierungshilfen für Shadow-Trading-Anzeigen. Decimal-Werte kommen als
// Strings von der API (Prisma Decimal -> String) und werden hier ausschließlich
// zur Anzeige geparst — nie für Berechnungen weiterverwendet.

export const UNKNOWN_LABEL = "UNBEKANNT";
export const BLOCKED_LABEL = "BLOCKIERT";

export function formatDecimalAmount(
  value: string | null | undefined,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  if (value === null || value === undefined) {
    return "—";
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return "—";
  }

  const { minimumFractionDigits = 2, maximumFractionDigits = 2 } = options ?? {};

  return new Intl.NumberFormat("de-DE", { minimumFractionDigits, maximumFractionDigits }).format(
    parsed
  );
}

export function formatSignedDecimal(
  value: string | null | undefined,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  if (value === null || value === undefined) {
    return "—";
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return "—";
  }

  const formatted = formatDecimalAmount(value, options);
  return parsed > 0 ? `+${formatted}` : formatted;
}

export function decimalTone(value: string | null | undefined): "good" | "bad" | "neutral" {
  if (value === null || value === undefined) {
    return "neutral";
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed === 0) {
    return "neutral";
  }

  return parsed > 0 ? "good" : "bad";
}

export function toneColor(tone: "good" | "bad" | "neutral"): string | undefined {
  if (tone === "good") return "var(--good)";
  if (tone === "bad") return "var(--bad)";
  return undefined;
}

// Unbekannt/blockiert bleibt textuell sichtbar statt als "0" oder gesund zu wirken.
export function formatUnknownableDecimal(
  value: string | null | undefined,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  if (value === null || value === undefined) {
    return UNKNOWN_LABEL;
  }

  return formatDecimalAmount(value, options);
}

export function formatUtcDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const formatted = new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "UTC"
  }).format(date);

  return `${formatted} UTC`;
}

export function isDataStale(
  value: string | null | undefined,
  maxAgeMs: number,
  now: Date = new Date()
): boolean {
  if (!value) {
    return true;
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return true;
  }

  return now.getTime() - timestamp > maxAgeMs;
}

export function formatPercentValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return "—";
  }

  return `${parsed > 0 ? "+" : ""}${parsed.toFixed(2)}%`;
}

import { WatchlistPriority } from "@signalpilot/database";

const alertModes = ["ALL_ASSETS", "WATCHLIST_ONLY", "HIGH_PRIORITY_ONLY"] as const;

export type AlertMode = (typeof alertModes)[number];

export type AlertRouteReason =
  | "ALL_ASSETS"
  | "WATCHLIST_ONLY_MATCH"
  | "HIGH_PRIORITY_MATCH"
  | "WATCHLIST_DISABLED"
  | "NOT_ON_WATCHLIST"
  | "NOT_HIGH_PRIORITY"
  | "INVALID_ALERT_MODE";

export type AlertRouteWatchlistItem = {
  alertEnabled: boolean;
  priority: WatchlistPriority;
} | null;

export type AlertRouteDecision = {
  shouldRoute: boolean;
  reason: AlertRouteReason;
};

export function shouldRouteAlertForAsset(input: {
  asset: { id: string; symbol: string };
  watchlistItem?: AlertRouteWatchlistItem;
  alertMode?: string | null;
}): AlertRouteDecision {
  const parsed = parseAlertMode(input.alertMode);
  const watchlistItem = input.watchlistItem ?? null;

  if (parsed.invalidValue && !watchlistItem) {
    return {
      shouldRoute: true,
      reason: "INVALID_ALERT_MODE"
    };
  }

  if (watchlistItem?.alertEnabled === false) {
    return {
      shouldRoute: false,
      reason: "WATCHLIST_DISABLED"
    };
  }

  if (parsed.alertMode === "ALL_ASSETS") {
    return {
      shouldRoute: true,
      reason: parsed.invalidValue ? "INVALID_ALERT_MODE" : "ALL_ASSETS"
    };
  }

  if (!watchlistItem) {
    return {
      shouldRoute: false,
      reason: "NOT_ON_WATCHLIST"
    };
  }

  if (parsed.alertMode === "WATCHLIST_ONLY") {
    return {
      shouldRoute: true,
      reason: "WATCHLIST_ONLY_MATCH"
    };
  }

  if (watchlistItem.priority === WatchlistPriority.HIGH) {
    return {
      shouldRoute: true,
      reason: "HIGH_PRIORITY_MATCH"
    };
  }

  return {
    shouldRoute: false,
    reason: "NOT_HIGH_PRIORITY"
  };
}

export function parseAlertMode(value: string | null | undefined): {
  alertMode: AlertMode;
  rawAlertMode: string | null | undefined;
  invalidValue: string | null;
} {
  if (value === undefined || value === null || value.trim() === "") {
    return {
      alertMode: "ALL_ASSETS",
      rawAlertMode: value,
      invalidValue: null
    };
  }

  const normalized = value.trim();

  if (alertModes.includes(normalized as AlertMode)) {
    return {
      alertMode: normalized as AlertMode,
      rawAlertMode: value,
      invalidValue: null
    };
  }

  return {
    alertMode: "ALL_ASSETS",
    rawAlertMode: value,
    invalidValue: value
  };
}

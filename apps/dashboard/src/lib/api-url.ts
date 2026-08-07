const DEFAULT_BROWSER_API_URL = "/api";

export function normalizeApiUrl(value: string | undefined, fallback: string): string {
  const url = value?.trim() || fallback;
  return url.replace(/\/+$/, "");
}

export const browserApiUrl = normalizeApiUrl(
  process.env.NEXT_PUBLIC_SIGNALPILOT_API_URL,
  DEFAULT_BROWSER_API_URL
);

export function getApiUrl(isServer = typeof window === "undefined"): string {
  if (!isServer) return browserApiUrl;

  const serverUrl = normalizeApiUrl(process.env.SIGNALPILOT_API_INTERNAL_URL, browserApiUrl);

  // Server-Komponenten rufen `fetch` in Node auf, und Node kann eine relative URL
  // nicht auflösen. Ohne diese Prüfung meldet die Seite nur "Failed to parse URL
  // from /api/health" — eine Meldung, die die eigentliche Ursache verschweigt.
  if (serverUrl.startsWith("/")) {
    throw new Error(
      "SIGNALPILOT_API_INTERNAL_URL ist nicht gesetzt. Server-Komponenten brauchen eine " +
        "absolute API-Adresse, weil Node relative URLs nicht auflösen kann. " +
        "Vorlage: apps/dashboard/.env.local.example"
    );
  }

  return serverUrl;
}

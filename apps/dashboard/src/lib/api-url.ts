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

  return normalizeApiUrl(process.env.SIGNALPILOT_API_INTERNAL_URL, browserApiUrl);
}

"use client";

import { type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const assetTypes = ["", "CRYPTO", "STOCK", "ETF"];
const timeframes = ["", "1h", "4h", "1d"];
const riskLevels = ["", "LOW", "MEDIUM", "HIGH"];
const assetTypeLabels: Record<string, string> = {
  CRYPTO: "Krypto",
  STOCK: "Aktien",
  ETF: "ETF"
};
const riskLabels: Record<string, string> = {
  LOW: "Niedriges Risiko",
  MEDIUM: "Mittleres Risiko",
  HIGH: "Hohes Risiko"
};

const filterKeys = [
  "assetType",
  "timeframe",
  "minScore",
  "riskLevel",
  "showOnlyAlertWorthy",
  "watchlistOnly"
] as const;

export function ScannerFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const query = new URLSearchParams();

    for (const key of filterKeys) {
      const value = String(formData.get(key) ?? "").trim();
      if (value && value !== "false") {
        query.set(key, value);
      }
    }

    router.push(`/dashboard/scanner${query.toString() ? `?${query.toString()}` : ""}`);
  }

  function reset() {
    router.push("/dashboard/scanner");
  }

  const hasActive = filterKeys.some((k) => searchParams.get(k));

  return (
    <form className="scanner-filter-row" onSubmit={submit}>
      <select defaultValue={searchParams.get("assetType") ?? ""} name="assetType">
        {assetTypes.map((v) => (
          <option key={v} value={v}>
            {assetTypeLabels[v] ?? "Alle Asset-Typen"}
          </option>
        ))}
      </select>

      <select defaultValue={searchParams.get("timeframe") ?? ""} name="timeframe">
        {timeframes.map((v) => (
          <option key={v} value={v}>
            {v || "Alle Zeitebenen"}
          </option>
        ))}
      </select>

      <select defaultValue={searchParams.get("riskLevel") ?? ""} name="riskLevel">
        {riskLevels.map((v) => (
          <option key={v} value={v}>
            {riskLabels[v] ?? "Alle Risikostufen"}
          </option>
        ))}
      </select>

      <input
        defaultValue={searchParams.get("minScore") ?? ""}
        inputMode="decimal"
        min="0"
        max="100"
        step="5"
        name="minScore"
        placeholder="Min. Qualität"
        type="number"
        style={{ width: 110 }}
      />

      <label className="check-filter">
        <input
          defaultChecked={searchParams.get("showOnlyAlertWorthy") === "true"}
          name="showOnlyAlertWorthy"
          type="checkbox"
          value="true"
        />
        Nur mit Hinweis
      </label>

      <label className="check-filter">
        <input
          defaultChecked={searchParams.get("watchlistOnly") === "true"}
          name="watchlistOnly"
          type="checkbox"
          value="true"
        />
        Nur Watchlist
      </label>

      <button type="submit">Filtern</button>
      {hasActive ? (
        <button type="button" onClick={reset}>
          Zurücksetzen
        </button>
      ) : null}
    </form>
  );
}

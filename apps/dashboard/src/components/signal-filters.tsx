"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent } from "react";

const assetTypes = [
  { value: "", label: "Alle Asset-Typen" },
  { value: "STOCK", label: "Aktien" },
  { value: "ETF", label: "ETF" },
  { value: "CRYPTO", label: "Krypto" }
];

const statuses = [
  { value: "", label: "Alle Status" },
  { value: "STRONG_WATCH", label: "Starke Beobachtung" },
  { value: "WATCH", label: "Beobachten" },
  { value: "WAIT", label: "Abwarten" },
  { value: "AVOID", label: "Meiden" },
  { value: "NO_EDGE", label: "Kein Vorteil" }
];

const directions = [
  { value: "", label: "Alle Richtungen" },
  { value: "BULLISH", label: "Aufwärts" },
  { value: "BEARISH", label: "Abwärts" },
  { value: "NEUTRAL", label: "Neutral" },
  { value: "MIXED", label: "Gemischt" }
];

const filterKeys = [
  "symbol",
  "assetType",
  "status",
  "direction",
  "timeframe",
  "limit"
] as const;

const activeFilterKeys = ["symbol", "assetType", "status", "direction", "timeframe"] as const;

export function SignalFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const hasActive = activeFilterKeys.some((k) => searchParams.get(k));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    for (const key of filterKeys) {
      const value = String(formData.get(key) ?? "").trim();
      if (value) query.set(key, value);
    }
    router.push(`/dashboard/signals${query.toString() ? `?${query.toString()}` : ""}`);
  }

  function reset() {
    router.push("/dashboard/signals");
  }

  return (
    <form className="filter-bar" onSubmit={submit}>
      <input
        defaultValue={searchParams.get("symbol") ?? ""}
        name="symbol"
        placeholder="Symbol"
      />
      <select defaultValue={searchParams.get("assetType") ?? ""} name="assetType">
        {assetTypes.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <select defaultValue={searchParams.get("status") ?? ""} name="status">
        {statuses.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <select defaultValue={searchParams.get("direction") ?? ""} name="direction">
        {directions.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <input
        defaultValue={searchParams.get("timeframe") ?? ""}
        name="timeframe"
        placeholder="Zeitrahmen"
      />
      <select defaultValue={searchParams.get("limit") ?? "50"} name="limit">
        {["25", "50", "100", "200"].map((v) => (
          <option key={v} value={v}>{v} Einträge</option>
        ))}
      </select>
      <button type="submit">Filtern</button>
      {hasActive ? (
        <button type="button" onClick={reset}>
          Zurücksetzen
        </button>
      ) : null}
    </form>
  );
}

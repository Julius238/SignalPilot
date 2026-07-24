import Link from "next/link";

import { AlignmentBadge, RiskBadge } from "../../../components/badges";
import { EmptyState, ErrorState } from "../../../components/empty-state";
import { PageHeader, SectionCard } from "../../../components/ui";
import { formatScore } from "../../../lib/format";
import {
  buildQuery,
  fetchApi,
  type MultiTimeframeAlignment,
  type MultiTimeframeScannerItem
} from "../../../lib/signalpilot-api";

const ASSET_TYPE_OPTIONS = [
  { value: "", label: "Alle Asset-Typen" },
  { value: "CRYPTO", label: "Krypto" },
  { value: "STOCK", label: "Aktien" },
  { value: "ETF", label: "ETF" }
];

const ALIGNMENT_OPTIONS: { value: "" | MultiTimeframeAlignment; label: string }[] = [
  { value: "", label: "Alle Ausrichtungen" },
  { value: "BULLISH_ALIGNED", label: "Multi-TF: Aufwärts" },
  { value: "BEARISH_ALIGNED", label: "Multi-TF: Abwärts" },
  { value: "MIXED", label: "Gemischt" },
  { value: "SHORT_TERM_ONLY", label: "Nur kurzfristig" },
  { value: "HIGHER_TIMEFRAME_CONFIRMATION", label: "HTF-Bestätigung" },
  { value: "CONFLICT", label: "Konflikt" },
  { value: "NO_EDGE", label: "Kein Vorteil" }
];

type MultiTimeframePageProps = {
  searchParams: Promise<{
    assetType?: string;
    alignment?: string;
    watchlistOnly?: string;
  }>;
};

export default async function MultiTimeframePage({ searchParams }: MultiTimeframePageProps) {
  const params = await searchParams;
  const query = buildQuery({
    assetType: params.assetType,
    alignment: params.alignment,
    watchlistOnly: params.watchlistOnly
  });
  const result = await fetchApi<MultiTimeframeScannerItem[]>(
    `/scanner/multi-timeframe${query}`
  );
  const rows = result.data ?? [];
  const hasFilter = !!(params.assetType || params.alignment || params.watchlistOnly);

  return (
    <>
      <PageHeader
        eyebrow="Kontext"
        title="Zeitebenen"
        subtitle="Zeigt, ob kurzfristige und übergeordnete Beobachtungen dasselbe Bild ergeben oder einander widersprechen."
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/scanner">
            Markt-Radar
          </Link>
        }
      />

      {/* Filter */}
      <form className="filter-bar" method="GET" style={{ marginBottom: 16 }}>
        <select defaultValue={params.assetType ?? ""} name="assetType">
          {ASSET_TYPE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select defaultValue={params.alignment ?? ""} name="alignment">
          {ALIGNMENT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <label className="check-filter">
          <input
            defaultChecked={params.watchlistOnly === "true"}
            name="watchlistOnly"
            type="checkbox"
            value="true"
          />
          Nur Watchlist
        </label>
        <button type="submit">Filtern</button>
        {hasFilter ? (
          <a href="/dashboard/multi-timeframe" className="section-link" style={{ alignSelf: "center" }}>
            Zurücksetzen
          </a>
        ) : null}
      </form>

      {result.error ? (
        <ErrorState title="Multi-Timeframe-Daten konnten nicht geladen werden" message={result.error} />
      ) : null}

      {!result.error && rows.length === 0 ? (
        <EmptyState title="Keine Multi-Timeframe-Zusammenfassungen gefunden." />
      ) : null}

      {rows.length > 0 ? (
        <SectionCard>
          <p className="muted small" style={{ marginBottom: 12 }}>
            {rows.length} Asset{rows.length !== 1 ? "s" : ""}
            {hasFilter ? " (gefiltert)" : ""}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Asset-Typ</th>
                  <th>Ausrichtung</th>
                  <th>Score</th>
                  <th>Risiko</th>
                  <th>Primär</th>
                  <th>Bestätigend</th>
                  <th>Konflikt</th>
                  <th>Zusammenfassung</th>
                  <th>Nächster Fokus</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.asset.id}>
                    <td>
                      <Link href={`/dashboard/assets/${encodeURIComponent(row.asset.symbol)}`}>
                        <strong>{row.asset.symbol}</strong>
                      </Link>
                    </td>
                    <td>{row.asset.assetType}</td>
                    <td>
                      <AlignmentBadge value={row.multiTimeframeSummary.alignment} />
                    </td>
                    <td>{formatScore(row.multiTimeframeSummary.alignmentScore)}</td>
                    <td>
                      <RiskBadge value={row.multiTimeframeSummary.riskLevel} />
                    </td>
                    <td>{row.multiTimeframeSummary.primaryTimeframe ?? "—"}</td>
                    <td>
                      {row.multiTimeframeSummary.confirmingTimeframes.length > 0
                        ? row.multiTimeframeSummary.confirmingTimeframes.join(", ")
                        : "—"}
                    </td>
                    <td>
                      {row.multiTimeframeSummary.conflictingTimeframes.length > 0 ? (
                        <span style={{ color: "var(--bad)" }}>
                          {row.multiTimeframeSummary.conflictingTimeframes.join(", ")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="wide-cell">{row.multiTimeframeSummary.summary}</td>
                    <td className="wide-cell">{row.multiTimeframeSummary.nextFocus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}
    </>
  );
}

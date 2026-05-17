import Link from "next/link";

import { AlignmentBadge, RiskBadge } from "../../../components/badges";
import { EmptyState, ErrorState } from "../../../components/empty-state";
import { formatScore } from "../../../lib/format";
import {
  buildQuery,
  fetchApi,
  type MultiTimeframeAlignment,
  type MultiTimeframeScannerItem
} from "../../../lib/signalpilot-api";

const assetTypes = ["", "CRYPTO", "STOCK", "ETF"];
const alignments: Array<"" | MultiTimeframeAlignment> = [
  "",
  "BULLISH_ALIGNED",
  "BEARISH_ALIGNED",
  "MIXED",
  "SHORT_TERM_ONLY",
  "HIGHER_TIMEFRAME_CONFIRMATION",
  "CONFLICT",
  "NO_EDGE"
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

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Multi-Timeframe</h1>
          <p>Asset-level alignment across 1h, 4h, and 1d signals.</p>
        </div>
        <Link className="primary-link" href="/dashboard/scanner">
          Open Scanner
        </Link>
      </div>

      <form className="filter-bar multi-timeframe-filter-bar">
        <select defaultValue={params.assetType ?? ""} name="assetType">
          {assetTypes.map((value) => (
            <option key={value} value={value}>
              {value || "ALL Assets"}
            </option>
          ))}
        </select>
        <select defaultValue={params.alignment ?? ""} name="alignment">
          {alignments.map((value) => (
            <option key={value} value={value}>
              {value || "ALL Alignments"}
            </option>
          ))}
        </select>
        <label className="check-filter">
          <input
            defaultChecked={params.watchlistOnly === "true"}
            name="watchlistOnly"
            type="checkbox"
            value="true"
          />
          Watchlist only
        </label>
        <button type="submit">Apply</button>
      </form>

      {result.error ? (
        <ErrorState title="Could not load multi-timeframe data" message={result.error} />
      ) : null}

      {!result.error && rows.length === 0 ? (
        <EmptyState title="Keine Multi-Timeframe Summaries gefunden." />
      ) : null}

      {rows.length > 0 ? (
        <section className="multi-timeframe-table-wrap">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Asset</th>
                  <th>Alignment</th>
                  <th>Score</th>
                  <th>Risk</th>
                  <th>Primary</th>
                  <th>Confirming</th>
                  <th>Conflicting</th>
                  <th>Summary</th>
                  <th>Next Focus</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.asset.id}>
                    <td>
                      <Link href={`/dashboard/assets/${encodeURIComponent(row.asset.symbol)}`}>
                        {row.asset.symbol}
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
                    <td>{row.multiTimeframeSummary.primaryTimeframe ?? "-"}</td>
                    <td>{formatTimeframes(row.multiTimeframeSummary.confirmingTimeframes)}</td>
                    <td>{formatTimeframes(row.multiTimeframeSummary.conflictingTimeframes)}</td>
                    <td className="wide-cell">{row.multiTimeframeSummary.summary}</td>
                    <td className="wide-cell">{row.multiTimeframeSummary.nextFocus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function formatTimeframes(timeframes: string[]) {
  return timeframes.length > 0 ? timeframes.join(", ") : "-";
}

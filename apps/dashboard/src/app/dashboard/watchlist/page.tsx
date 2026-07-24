import Link from "next/link";

import {
  AlignmentBadge,
  DirectionBadge,
  PriorityBadge,
  StatusBadge
} from "../../../components/badges";
import { EmptyState, ErrorState } from "../../../components/empty-state";
import { WatchlistItemEditor } from "../../../components/watchlist-controls";
import { PageHeader } from "../../../components/ui";
import { buildQuery, fetchApi, type WatchlistItem } from "../../../lib/signalpilot-api";
import { formatScore } from "../../../lib/format";

const priorities = ["", "LOW", "MEDIUM", "HIGH"];
const assetTypes = ["", "CRYPTO", "STOCK", "ETF"];

type WatchlistPageProps = {
  searchParams: Promise<{
    priority?: string;
    assetType?: string;
    alertEnabled?: string;
  }>;
};

export default async function WatchlistPage({ searchParams }: WatchlistPageProps) {
  const params = await searchParams;
  const query = buildQuery({
    priority: params.priority,
    assetType: params.assetType,
    alertEnabled: params.alertEnabled,
    limit: 500
  });
  const result = await fetchApi<WatchlistItem[]>(`/watchlist${query}`);
  const items = result.data ?? [];
  const highPriorityCount = items.filter((item) => item.priority === "HIGH").length;
  const alertEnabledCount = items.filter((item) => item.alertEnabled).length;

  return (
    <>
      <PageHeader
        eyebrow="Persönlicher Fokus"
        title="Meine Watchlist"
        subtitle="Beobachtete Assets mit ihrem neuesten Signal und dem Bild über mehrere Zeitebenen."
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/assets">
            Märkte durchsuchen
          </Link>
        }
      />

      <form className="filter-bar multi-timeframe-filter-bar">
        <select defaultValue={params.priority ?? ""} name="priority">
          {priorities.map((value) => (
            <option key={value} value={value}>
              {value === "LOW"
                ? "Niedrige Priorität"
                : value === "MEDIUM"
                  ? "Mittlere Priorität"
                  : value === "HIGH"
                    ? "Hohe Priorität"
                    : "Alle Prioritäten"}
            </option>
          ))}
        </select>
        <select defaultValue={params.assetType ?? ""} name="assetType">
          {assetTypes.map((value) => (
            <option key={value} value={value}>
              {value === "CRYPTO"
                ? "Krypto"
                : value === "STOCK"
                  ? "Aktien"
                  : value || "Alle Asset-Typen"}
            </option>
          ))}
        </select>
        <select defaultValue={params.alertEnabled ?? ""} name="alertEnabled">
          <option value="">Alle Benachrichtigungszustände</option>
          <option value="true">Benachrichtigungen aktiv</option>
          <option value="false">Benachrichtigungen aus</option>
        </select>
        <button type="submit">Anwenden</button>
      </form>

      {result.error ? <ErrorState title="Watchlist konnte nicht geladen werden" message={result.error} /> : null}

      <section className="grid metrics">
        <div className="card">
          <span className="metric-label">Beobachtete Assets</span>
          <span className="metric-value">{items.length}</span>
        </div>
        <div className="card">
          <span className="metric-label">Hohe Priorität</span>
          <span className="metric-value">{highPriorityCount}</span>
        </div>
        <div className="card">
          <span className="metric-label">Benachrichtigungen aktiv</span>
          <span className="metric-value">{alertEnabledCount}</span>
        </div>
      </section>

      {!result.error && items.length === 0 ? (
        <EmptyState
          title="Keine passenden Watchlist-Einträge."
          description="Passe die Filter an oder füge über die Marktübersicht ein Asset hinzu."
        />
      ) : null}

      {items.length > 0 ? (
        <section className="watchlist-grid">
          {items.map((item) => (
            <article className="card watchlist-card" key={item.id}>
              <div className="watchlist-card-head">
                <div>
                  <Link
                    className="watchlist-symbol"
                    href={`/dashboard/assets/${encodeURIComponent(item.symbol)}`}
                  >
                    {item.symbol}
                  </Link>
                  <span>
                    {item.asset.name} · {item.asset.assetType}
                  </span>
                </div>
                <div className="watchlist-badges">
                  <PriorityBadge value={item.priority} />
                  <span className={`badge ${item.alertEnabled ? "health-ok" : "status-no_edge"}`}>
                    {item.alertEnabled ? "Hinweise aktiv" : "Hinweise aus"}
                  </span>
                </div>
              </div>

              <div className="watchlist-signal-grid">
                <div>
                  <span className="metric-label">Neuestes Signal</span>
                  {item.latestSignal ? (
                    <>
                      <Link href={`/dashboard/signals/${item.latestSignal.id}`}>
                        {item.latestSignal.signalType}
                      </Link>
                      <div className="watchlist-badges">
                        <StatusBadge value={item.latestSignal.status} />
                        <DirectionBadge value={item.latestSignal.direction} />
                        <span title="Automatisch berechnete Relevanz von 0 bis 100">
                          Qualität {formatScore(item.latestSignal.score)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <strong>-</strong>
                  )}
                </div>
                <div>
                  <span className="metric-label">Zeitebenen</span>
                  {item.multiTimeframeSummary ? (
                    <>
                      <AlignmentBadge value={item.multiTimeframeSummary.alignment} />
                      <strong title="Übereinstimmung der beobachteten Zeitebenen von 0 bis 100">
                        Bestätigung {formatScore(item.multiTimeframeSummary.alignmentScore)}
                      </strong>
                    </>
                  ) : (
                    <strong>-</strong>
                  )}
                </div>
              </div>

              <p className="watchlist-note">{item.notes ?? "Noch keine persönliche Notiz."}</p>
              <WatchlistItemEditor item={item} />
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}

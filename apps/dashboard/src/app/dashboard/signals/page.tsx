import Link from "next/link";

import { EmptyState, ErrorState } from "../../../components/empty-state";
import { SignalFilters } from "../../../components/signal-filters";
import { SignalCard } from "../../../components/signal-card";
import { PageHeader } from "../../../components/ui";
import { buildQuery, fetchApi, type SignalListItem } from "../../../lib/signalpilot-api";

type SignalsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignalsPage({ searchParams }: SignalsPageProps) {
  const params = await searchParams;
  const query = buildQuery({
    symbol: getParam(params.symbol),
    assetType: getParam(params.assetType),
    status: getParam(params.status),
    direction: getParam(params.direction),
    timeframe: getParam(params.timeframe),
    limit: getParam(params.limit) ?? "50"
  });

  const signals = await fetchApi<SignalListItem[]>(`/signals${query}`);
  const list = signals.data ?? [];

  return (
    <>
      <PageHeader
        title="Signal Feed"
        subtitle="Gespeicherte Signalentscheidungen mit Analyse-Zusammenfassung"
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/scanner">
            Scanner →
          </Link>
        }
      />

      <SignalFilters />

      {signals.error ? (
        <ErrorState title="Signals konnten nicht geladen werden" message={signals.error} />
      ) : null}

      {list.length === 0 ? (
        <EmptyState title="Keine Signals gefunden." />
      ) : (
        <>
          <p className="muted small" style={{ marginBottom: 10 }}>
            {list.length} Signal{list.length !== 1 ? "s" : ""} geladen
          </p>
          <div className="signal-cards-list">
            {list.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

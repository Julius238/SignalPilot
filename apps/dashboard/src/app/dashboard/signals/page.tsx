import { ErrorState } from "../../../components/empty-state";
import { SignalFilters } from "../../../components/signal-filters";
import { SignalsTable } from "../../../components/signals-table";
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

  return (
    <>
      <div className="page-header">
        <h1>Signal Feed</h1>
        <p>Stored technical signal decisions with output summaries for the dashboard.</p>
      </div>
      <SignalFilters />
      {signals.error ? <ErrorState title="Could not load signals" message={signals.error} /> : null}
      <SignalsTable signals={signals.data ?? []} />
    </>
  );
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

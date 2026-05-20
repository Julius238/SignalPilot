import { ErrorState } from "../../../components/empty-state";
import { fetchApi, buildQuery } from "../../../lib/signalpilot-api";
import { formatDateTime } from "../../../lib/format";
import type { NewsItem } from "../../../lib/signalpilot-api";

type NewsPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function NewsPage({ searchParams }: NewsPageProps) {
  const params = await searchParams;
  const symbol = params.symbol?.toUpperCase() ?? "";
  const source = params.source ?? "";

  const query = buildQuery({
    symbol: symbol || undefined,
    source: source || undefined,
    limit: 200
  });

  const result = await fetchApi<NewsItem[]>(`/news${query}`);

  if (result.error) {
    return <ErrorState title="Could not load news" message={result.error} />;
  }

  const news = result.data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>News</h1>
        <p>Equity and ETF news fetched via Finnhub</p>
      </div>

      <section className="card">
        <div className="filter-row">
          <form method="GET">
            <input name="symbol" placeholder="Filter by symbol…" defaultValue={symbol} />
            <input name="source" placeholder="Filter by source…" defaultValue={source} />
            <button type="submit">Filter</button>
            {(symbol || source) && (
              <a href="/dashboard/news">Clear</a>
            )}
          </form>
          <span>{news.length} items</span>
        </div>

        {news.length === 0 ? (
          <p className="muted">No news items found. Run <code>pnpm worker:fetch-equity-news</code> to populate.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Source</th>
                <th>Headline</th>
                <th>Published</th>
                <th>Category</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {news.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.symbol}</strong></td>
                  <td>{item.source}</td>
                  <td>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        {item.headline}
                      </a>
                    ) : (
                      item.headline
                    )}
                    {item.summary && (
                      <p className="muted small">{item.summary.slice(0, 120)}{item.summary.length > 120 ? "…" : ""}</p>
                    )}
                  </td>
                  <td className="nowrap">{formatDateTime(item.publishedAt)}</td>
                  <td>{item.category ?? "-"}</td>
                  <td>{item.relevanceScore !== null && item.relevanceScore !== undefined ? item.relevanceScore : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

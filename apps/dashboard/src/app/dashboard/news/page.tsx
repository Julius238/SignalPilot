import Link from "next/link";

import { EmptyState, ErrorState } from "../../../components/empty-state";
import { PageHeader, SectionCard } from "../../../components/ui";
import { buildQuery, fetchApi, type NewsItem } from "../../../lib/signalpilot-api";
import { formatDateTime } from "../../../lib/format";

type NewsPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const SENTIMENT_LABELS: Record<string, string> = {
  POSITIVE: "Positiv",
  NEGATIVE: "Negativ",
  NEUTRAL: "Neutral",
  MIXED: "Gemischt"
};

function sentimentColor(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  if (s === "POSITIVE") return "var(--good)";
  if (s === "NEGATIVE") return "var(--bad)";
  return undefined;
}

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
  const news = result.data ?? [];
  const hasFilter = !!(symbol || source);

  return (
    <>
      <PageHeader
        title="News-Feed"
        subtitle="Nachrichten und Meldungen für beobachtete Assets"
      />

      {result.error ? (
        <ErrorState title="News konnten nicht geladen werden" message={result.error} />
      ) : null}

      {/* Filter */}
      <form className="filter-bar" method="GET" style={{ marginBottom: 16 }}>
        <input
          name="symbol"
          placeholder="Symbol"
          defaultValue={symbol}
        />
        <input
          name="source"
          placeholder="Quelle"
          defaultValue={source}
        />
        <button type="submit">Filtern</button>
        {hasFilter ? (
          <a href="/dashboard/news" className="section-link" style={{ alignSelf: "center" }}>
            Zurücksetzen
          </a>
        ) : null}
      </form>

      <SectionCard>
        {news.length === 0 ? (
          <EmptyState title="Keine News-Einträge gefunden." />
        ) : (
          <>
            <p className="muted small" style={{ marginBottom: 12 }}>
              {news.length} Einträge
              {hasFilter ? " (gefiltert)" : ""}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Quelle</th>
                    <th>Schlagzeile</th>
                    <th>Veröffentlicht</th>
                    <th>Kategorie</th>
                    <th>Sentiment</th>
                    <th>Relevanz</th>
                  </tr>
                </thead>
                <tbody>
                  {news.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link href={`/dashboard/assets/${encodeURIComponent(item.symbol)}`}>
                          <strong>{item.symbol}</strong>
                        </Link>
                      </td>
                      <td>{item.source}</td>
                      <td>
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer">
                            {item.headline}
                          </a>
                        ) : (
                          item.headline
                        )}
                        {item.summary ? (
                          <p className="muted small" style={{ margin: "2px 0 0" }}>
                            {item.summary.slice(0, 120)}
                            {item.summary.length > 120 ? "…" : ""}
                          </p>
                        ) : null}
                      </td>
                      <td className="nowrap">{formatDateTime(item.publishedAt)}</td>
                      <td>{item.category ?? "—"}</td>
                      <td>
                        {item.sentiment ? (
                          <span style={{ color: sentimentColor(item.sentiment) }}>
                            {SENTIMENT_LABELS[item.sentiment] ?? item.sentiment}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {item.relevanceScore != null ? item.relevanceScore : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>
    </>
  );
}

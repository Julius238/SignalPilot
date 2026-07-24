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
        eyebrow="Kontext"
        title="Nachrichten"
        subtitle="Aktuelle Meldungen zu beobachteten Assets — kompakt nach Quelle und Zeitpunkt eingeordnet."
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

      <SectionCard
        title={news.length > 0 ? `${news.length} Meldungen` : undefined}
        subtitle={hasFilter ? "Die Ansicht ist aktuell gefiltert." : "Neueste Meldungen zuerst."}
      >
        {news.length === 0 ? (
          <EmptyState
            title="Keine passenden Nachrichten gefunden."
            description="Passe die Filter an oder warte auf den nächsten News-Abruf."
          />
        ) : (
          <div className="news-feed">
            {news.map((item) => (
              <article className="news-card" key={item.id}>
                <div className="news-card-meta">
                  <Link
                    className="symbol-chip"
                    href={`/dashboard/assets/${encodeURIComponent(item.symbol)}`}
                  >
                    {item.symbol}
                  </Link>
                  <span>{item.source}</span>
                  <time dateTime={item.publishedAt}>{formatDateTime(item.publishedAt)}</time>
                </div>
                <h2>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.headline}
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  ) : (
                    item.headline
                  )}
                </h2>
                {item.summary ? (
                  <p>
                    {item.summary.slice(0, 220)}
                    {item.summary.length > 220 ? "…" : ""}
                  </p>
                ) : null}
                <div className="news-card-footer">
                  {item.category ? <span className="soft-chip">{item.category}</span> : null}
                  {item.sentiment ? (
                    <span
                      className="soft-chip"
                      style={{ color: sentimentColor(item.sentiment) }}
                    >
                      Stimmung: {SENTIMENT_LABELS[item.sentiment] ?? item.sentiment}
                    </span>
                  ) : null}
                  {item.relevanceScore != null ? (
                    <span className="soft-chip" title="Automatisch geschätzte Relevanz der Meldung">
                      Relevanz {item.relevanceScore}/10 ·{" "}
                      {item.relevanceScore >= 7
                        ? "hoch"
                        : item.relevanceScore >= 4
                          ? "mittel"
                          : "gering"}
                    </span>
                  ) : (
                    <span className="soft-chip">Noch nicht bewertet</span>
                  )}
                </div>
              </article>
            ))}
            </div>
        )}
      </SectionCard>
    </>
  );
}

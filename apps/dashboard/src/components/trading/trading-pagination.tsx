import Link from "next/link";

// Die API liefert für Listen keine Gesamtanzahl (kein `total`-Feld) —
// "es gibt eine weitere Seite" wird daher aus `count === limit` abgeleitet,
// wie im P7-Rechercheergebnis zu apps/api/src/routes/trading/reads.ts notiert.
export function TradingPagination({
  basePath,
  searchParams,
  offset,
  limit,
  count,
  paramName = "offset"
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  offset: number;
  limit: number;
  count: number;
  paramName?: string;
}) {
  const buildHref = (nextOffset: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== "" && key !== paramName) {
        params.set(key, value);
      }
    }
    if (nextOffset > 0) {
      params.set(paramName, String(nextOffset));
    }
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const hasPrev = offset > 0;
  const hasNext = count === limit;

  if (!hasPrev && !hasNext) {
    return null;
  }

  return (
    <div className="operation-actions" style={{ marginTop: 12 }}>
      {hasPrev ? (
        <Link className="primary-link secondary-link" href={buildHref(Math.max(0, offset - limit))}>
          ← Vorherige
        </Link>
      ) : null}
      {hasNext ? (
        <Link className="primary-link secondary-link" href={buildHref(offset + limit)}>
          Nächste →
        </Link>
      ) : null}
    </div>
  );
}

import Link from "next/link";

import { EmptyState, ErrorState } from "../../../components/empty-state";
import { MetricCard, PageHeader, SectionCard } from "../../../components/ui";
import { buildQuery, fetchApi, type PaperSignalEvaluation, type PaperStats } from "../../../lib/signalpilot-api";
import { formatDateTime, formatScore } from "../../../lib/format";

type PaperPageProps = {
  searchParams: Promise<{
    evaluationKind?: string;
    skipReason?: string;
  }>;
};

function formatPercent(v: number | null | undefined): string {
  return typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(2)}%` : "—";
}

const KIND_OPTIONS = [
  { value: "", label: "Alle Bewertungstypen" },
  { value: "DIRECTIONAL_BULLISH", label: "Aufwärts-Beobachtung" },
  { value: "DIRECTIONAL_BEARISH", label: "Abwärts-Beobachtung" },
  { value: "RISK_WARNING", label: "Risikowarnung" },
  { value: "OBSERVATION", label: "Beobachtung" },
  { value: "SKIPPED", label: "Übersprungen" }
];

const KIND_LABELS: Record<string, string> = {
  DIRECTIONAL_BULLISH: "Aufwärts",
  DIRECTIONAL_BEARISH: "Abwärts",
  RISK_WARNING: "Risikowarnung",
  OBSERVATION: "Beobachtung",
  SKIPPED: "Übersprungen"
};

const DIRECTION_LABELS: Record<string, string> = {
  BULLISH: "Aufwärts",
  BEARISH: "Abwärts",
  NEUTRAL: "Neutral",
  MIXED: "Gemischt"
};

const OUTCOME_LABELS: Record<string, string> = {
  POSITIVE: "Positiv",
  NEGATIVE: "Negativ",
  NEUTRAL: "Neutral",
  TARGET_REACHED: "Beobachtungsziel",
  INVALIDATED: "Invalidiert",
  OPEN: "Offen",
  EVALUATED: "Ausgewertet",
  EXPIRED: "Abgelaufen",
  SKIPPED: "Übersprungen"
};

function outcomeColor(s: string): string | undefined {
  if (s === "POSITIVE" || s === "TARGET_REACHED") return "var(--good)";
  if (s === "NEGATIVE" || s === "INVALIDATED") return "var(--bad)";
  return undefined;
}

export default async function PaperPage({ searchParams }: PaperPageProps) {
  const params = await searchParams;
  const query = buildQuery({
    limit: 100,
    evaluationKind: params.evaluationKind,
    skipReason: params.skipReason
  });
  const [stats, evaluations] = await Promise.all([
    fetchApi<PaperStats>("/paper/stats"),
    fetchApi<PaperSignalEvaluation[]>(`/paper/evaluations${query}`)
  ]);

  const summary = stats.data;
  const hasFilter = !!(params.evaluationKind || params.skipReason);
  const posCount = (summary?.positiveCount ?? 0) + (summary?.targetReachedCount ?? 0);
  const negCount = (summary?.negativeCount ?? 0) + (summary?.invalidatedCount ?? 0);

  return (
    <>
      <PageHeader
        title="Simulierte Auswertung"
        subtitle="Beobachtungsbasierte Signal-Qualitätsmessung · keine echten Trades"
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/performance">
            Research-Performance →
          </Link>
        }
      />

      {stats.error ? (
        <ErrorState title="Statistiken konnten nicht geladen werden" message={stats.error} />
      ) : null}
      {evaluations.error ? (
        <ErrorState
          title="Auswertungen konnten nicht geladen werden"
          message={evaluations.error}
        />
      ) : null}

      {/* Filter */}
      <form className="filter-bar" method="GET" style={{ marginBottom: 20 }}>
        <select name="evaluationKind" defaultValue={params.evaluationKind ?? ""}>
          {KIND_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          name="skipReason"
          placeholder="Übersprungen-Grund"
          defaultValue={params.skipReason ?? ""}
        />
        <button type="submit">Filtern</button>
        {hasFilter ? (
          <a href="/dashboard/paper" className="section-link" style={{ alignSelf: "center" }}>
            Zurücksetzen
          </a>
        ) : null}
      </form>

      {/* Kennzahlen */}
      <div className="grid metrics" style={{ marginBottom: 20 }}>
        <MetricCard
          label="Auswertungen gesamt"
          value={summary?.totalEvaluations ?? 0}
        />
        <MetricCard
          label="Offen"
          value={summary?.openCount ?? 0}
        />
        <MetricCard
          label="Ausgewertet"
          value={summary?.evaluatedCount ?? 0}
        />
        <MetricCard
          label={`Trefferquote (n=${summary?.evaluatedCount ?? 0})`}
          value={formatPercent(summary?.winRate)}
          sub={
            (summary?.evaluatedCount ?? 0) < 30
              ? "⚠ Kleine Datenbasis"
              : (summary?.evaluatedCount ?? 0) < 100
                ? "Begrenzte Stichprobe"
                : undefined
          }
        />
        <MetricCard
          label="Positiv (inkl. Ziel)"
          value={<span style={{ color: "var(--good)" }}>{posCount}</span>}
        />
        <MetricCard
          label="Negativ (inkl. Inv.)"
          value={<span style={{ color: "var(--bad)" }}>{negCount}</span>}
        />
        <MetricCard label="Ø 1h Kursänd." value={formatPercent(summary?.avgReturnAfter1h)} />
        <MetricCard label="Ø 4h Kursänd." value={formatPercent(summary?.avgReturnAfter4h)} />
        <MetricCard label="Ø 1d Kursänd." value={formatPercent(summary?.avgReturnAfter1d)} />
      </div>

      {/* Auswertungstabelle */}
      <SectionCard title="Einzelauswertungen (simuliert)">
        {evaluations.data && evaluations.data.length > 0 ? (
          <>
            <p className="muted small" style={{ marginBottom: 12 }}>
              {evaluations.data.length} Einträge
              {hasFilter ? " (gefiltert)" : ""}
              {" · "}Alle Kursveränderungen sind hypothetisch.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>TF</th>
                    <th>Status</th>
                    <th>Bewertungstyp</th>
                    <th>Signal</th>
                    <th>Richtung</th>
                    <th>Score</th>
                    <th>Referenzpreis</th>
                    <th>Kursänd. 1h</th>
                    <th>Kursänd. 4h</th>
                    <th>Kursänd. 1d</th>
                    <th>Ergebnis</th>
                    <th>Geöffnet</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluations.data.map((ev) => {
                    const outcome = ev.outcome ?? ev.evaluationStatus;
                    return (
                      <tr key={ev.id}>
                        <td>
                          <Link
                            href={`/dashboard/assets/${encodeURIComponent(ev.symbol)}`}
                          >
                            {ev.symbol}
                          </Link>
                        </td>
                        <td>{ev.timeframe}</td>
                        <td>{ev.status}</td>
                        <td>{KIND_LABELS[ev.evaluationKind] ?? ev.evaluationKind}</td>
                        <td>
                          <Link
                            href={`/dashboard/signals/${encodeURIComponent(ev.signalId)}`}
                          >
                            {ev.signalType}
                          </Link>
                        </td>
                        <td>
                          {DIRECTION_LABELS[ev.direction] ?? ev.direction}
                        </td>
                        <td>{formatScore(ev.score)}</td>
                        <td>{ev.entryPrice}</td>
                        <td>{formatPercent(ev.returnAfter1h)}</td>
                        <td>{formatPercent(ev.returnAfter4h)}</td>
                        <td>{formatPercent(ev.returnAfter1d)}</td>
                        <td style={{ color: outcomeColor(outcome ?? "") }}>
                          {OUTCOME_LABELS[outcome ?? ""] ?? outcome ?? "—"}
                        </td>
                        <td className="nowrap">{formatDateTime(ev.openedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState title="Keine simulierten Auswertungen gefunden." />
        )}
      </SectionCard>
    </>
  );
}

import Link from "next/link";

import { StatusBadge } from "../../../components/badges";
import { EmptyState, ErrorState } from "../../../components/empty-state";
import { MetricCard, PageHeader, SectionCard } from "../../../components/ui";
import { formatDateTime, formatScore } from "../../../lib/format";
import {
  buildQuery,
  fetchApi,
  type RulesSummary,
  type SignalRuleApplication
} from "../../../lib/signalpilot-api";

type RulesPageProps = {
  searchParams: Promise<{ symbol?: string; adjustedStatus?: string; category?: string }>;
};

const STATUS_OPTIONS = [
  { value: "", label: "Alle Status" },
  { value: "STRONG_WATCH", label: "Starke Beobachtung" },
  { value: "WATCH", label: "Beobachten" },
  { value: "WAIT", label: "Abwarten" },
  { value: "AVOID", label: "Meiden" },
  { value: "NO_EDGE", label: "Kein Vorteil" }
];

export default async function RulesPage({ searchParams }: RulesPageProps) {
  const params = await searchParams;
  const query = buildQuery({
    symbol: params.symbol,
    adjustedStatus: params.adjustedStatus,
    category: params.category
  });
  const [summary, applications] = await Promise.all([
    fetchApi<RulesSummary>("/rules/summary"),
    fetchApi<SignalRuleApplication[]>(`/rules/applications${query}`)
  ]);
  const errors = [summary.error, applications.error].filter(Boolean);
  const hasFilter = !!(params.symbol || params.adjustedStatus || params.category);

  const avgDelta = summary.data?.avgDelta ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="Signalregeln"
        subtitle="Welche Regeln eine automatische Basisbewertung verändert haben — mit Richtung und Stärke der Anpassung."
      />

      {errors.length > 0 ? (
        <ErrorState title="Regeln konnten nicht geladen werden" message={errors.join(" | ")} />
      ) : null}

      {/* Kennzahlen */}
      <div className="grid metrics" style={{ marginBottom: 20 }}>
        <MetricCard
          label="Anwendungen gesamt"
          value={summary.data?.totalApplications ?? 0}
        />
        <MetricCard
          label="Durchschnittl. Delta"
          value={
            <span style={{ color: avgDelta > 0 ? "var(--good)" : avgDelta < 0 ? "var(--bad)" : undefined }}>
              {avgDelta > 0 ? "+" : ""}{formatScore(avgDelta)}
            </span>
          }
        />
        <MetricCard
          label="Aufwertungen"
          value={
            <span style={{ color: "var(--good)" }}>
              {summary.data?.positiveAdjustmentCount ?? 0}
            </span>
          }
        />
        <MetricCard
          label="Abwertungen"
          value={
            <span style={{ color: "var(--bad)" }}>
              {summary.data?.negativeAdjustmentCount ?? 0}
            </span>
          }
        />
      </div>

      {/* Filter */}
      <form className="filter-bar" method="GET" style={{ marginBottom: 16 }}>
        <input
          name="symbol"
          placeholder="Symbol"
          defaultValue={params.symbol ?? ""}
        />
        <select defaultValue={params.adjustedStatus ?? ""} name="adjustedStatus">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          name="category"
          placeholder="Kategorie"
          defaultValue={params.category ?? ""}
        />
        <button type="submit">Filtern</button>
        {hasFilter ? (
          <a href="/dashboard/rules" className="section-link" style={{ alignSelf: "center" }}>
            Zurücksetzen
          </a>
        ) : null}
      </form>

      {/* Tabelle */}
      <SectionCard title="Regelanwendungen">
        {!applications.data || applications.data.length === 0 ? (
          <EmptyState title="Keine Regelanwendungen gefunden." />
        ) : (
          <>
            <p className="muted small" style={{ marginBottom: 12 }}>
              {applications.data.length} Einträge
              {hasFilter ? " (gefiltert)" : ""}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>TF</th>
                    <th>Original-Score</th>
                    <th>Angepasst</th>
                    <th>Delta</th>
                    <th>Original-Status</th>
                    <th>Angepasster Status</th>
                    <th>Hauptgrund</th>
                    <th>Erstellt</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.data.map((row) => {
                    const delta = row.adjustedScore - row.originalScore;
                    return (
                      <tr key={row.id}>
                        <td>
                          <Link href={`/dashboard/signals/${encodeURIComponent(row.signalId)}`}>
                            {row.symbol}
                          </Link>
                        </td>
                        <td>{row.timeframe}</td>
                        <td>{formatScore(row.originalScore)}</td>
                        <td>{formatScore(row.adjustedScore)}</td>
                        <td
                          style={{
                            color:
                              delta > 0
                                ? "var(--good)"
                                : delta < 0
                                  ? "var(--bad)"
                                  : undefined
                          }}
                        >
                          {delta > 0 ? "+" : ""}
                          {delta.toFixed(1)}
                        </td>
                        <td>
                          <StatusBadge value={row.originalStatus} />
                        </td>
                        <td>
                          <StatusBadge value={row.adjustedStatus} />
                        </td>
                        <td>{row.adjustments[0]?.reason ?? "—"}</td>
                        <td className="nowrap">{formatDateTime(row.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>
    </>
  );
}

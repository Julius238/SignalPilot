import Link from "next/link";

import { StatusBadge } from "../../../components/badges";
import { EmptyState, ErrorState } from "../../../components/empty-state";
import { RetryButton } from "../../../components/retry-button";
import {
  MetricCard,
  PageHeader,
  PageIntro,
  SectionCard,
  TechnicalDetails
} from "../../../components/ui";
import { describeApiError } from "../../../lib/api-error";
import { formatDateTime, formatScore } from "../../../lib/format";
import { timeframeLabel } from "../../../lib/labels";
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
  const applicationList = applications.data ?? [];
  const changed = applicationList.filter(
    (row) => Math.abs(row.adjustedScore - row.originalScore) > 0.05
  );
  const unchangedCount = applicationList.length - changed.length;
  const errorCopy = describeApiError(
    summary.errorKind ?? applications.errorKind,
    errors.join(" | "),
    "Die Regelauswertung"
  );

  const tone = errors.length > 0 ? "bad" : changed.length > 0 ? "warn" : "good";
  const verdict =
    errors.length > 0
      ? "Regelauswertung nicht abrufbar."
      : applicationList.length === 0
        ? "Noch keine Regelanwendungen aufgezeichnet."
        : changed.length === 0
          ? `Keine der ${applicationList.length} Bewertungen wurde durch eine Regel verändert.`
          : `${changed.length} von ${applicationList.length} Bewertungen wurden durch Regeln angepasst.`;
  const nextStep =
    errors.length > 0
      ? undefined
      : applicationList.length === 0
        ? "Regelanwendungen entstehen automatisch bei jeder Signalauswertung."
        : changed.length === 0
          ? "Nichts zu prüfen — die Basisbewertung galt unverändert."
          : "Die angepassten Einträge stehen oben; die Spalte „Hauptgrund“ nennt die ausschlaggebende Regel.";

  return (
    <>
      <PageHeader eyebrow="Research" title="Signalregeln" />

      <PageIntro
        purpose="Diese Seite macht nachvollziehbar, ob und warum zusätzliche Regeln eine automatische Bewertung nach oben oder unten korrigiert haben."
        tone={tone}
        verdict={verdict}
        nextStep={nextStep}
      />

      {errors.length > 0 ? (
        <ErrorState
          title={errorCopy.title}
          message={errorCopy.message}
          hint={errorCopy.hint}
          action={errorCopy.retryable ? <RetryButton /> : null}
        />
      ) : null}

      {/* Kennzahlen — nur zeigen, wenn es tatsächlich Anpassungen gab. */}
      {changed.length > 0 ? (
        <div className="grid metrics" style={{ marginBottom: 20 }}>
          <MetricCard
            label="Angepasste Bewertungen"
            value={changed.length}
            sub={`von ${applicationList.length} geprüften`}
            hint="Nur bei diesen Einträgen hat eine Regel den Basiswert verändert."
          />
          <MetricCard
            label="Durchschnittliche Anpassung"
            value={`${avgDelta > 0 ? "+" : ""}${formatScore(avgDelta)}`}
            sub="Punkte auf der Skala 0–100"
            hint="Positiv = die Regeln haben die Bewertung im Schnitt angehoben."
            tone={avgDelta > 0 ? "good" : avgDelta < 0 ? "bad" : "quiet"}
          />
          <MetricCard
            label="Aufwertungen"
            value={summary.data?.positiveAdjustmentCount ?? 0}
            tone="good"
          />
          <MetricCard
            label="Abwertungen"
            value={summary.data?.negativeAdjustmentCount ?? 0}
            tone="bad"
          />
        </div>
      ) : null}

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

      {/* Nur die tatsächlich veränderten Bewertungen stehen vorne — unveränderte
          Einträge füllten die Tabelle bisher mit lauter Nullzeilen. */}
      {applicationList.length === 0 ? (
        <EmptyState
          title={
            hasFilter
              ? "Keine Regelanwendung passt zu diesem Filter."
              : "Noch keine Regelanwendungen aufgezeichnet."
          }
          description={
            hasFilter
              ? "Filter zurücksetzen oder ein anderes Symbol wählen."
              : "Sie entstehen automatisch bei jeder Signalauswertung."
          }
        />
      ) : changed.length > 0 ? (
        <SectionCard
          title="Angepasste Bewertungen"
          subtitle={hasFilter ? "Die Ansicht ist aktuell gefiltert." : undefined}
        >
          <RuleTable rows={changed} />
        </SectionCard>
      ) : (
        <EmptyState
          title="Nichts zu prüfen."
          description="Regeln greifen erst, wenn Nachrichten, Termine, Marktumfeld oder Datenqualität für ein Signal deutlich vom Normalfall abweichen. Das war hier bei keinem Eintrag so."
          tone="calm"
        />
      )}

      {unchangedCount > 0 ? (
        <TechnicalDetails summary="Unveränderte Bewertungen anzeigen" count={unchangedCount}>
          <RuleTable
            rows={applicationList.filter(
              (row) => Math.abs(row.adjustedScore - row.originalScore) <= 0.05
            )}
          />
        </TechnicalDetails>
      ) : null}
    </>
  );
}

function RuleTable({ rows }: { rows: SignalRuleApplication[] }) {
  return (
    <div className="table-wrap">
      <table className="responsive-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Zeitebene</th>
            <th>Vorher</th>
            <th>Nachher</th>
            <th>Änderung</th>
            <th>Einstufung vorher</th>
            <th>Einstufung nachher</th>
            <th>Hauptgrund</th>
            <th>Zeitpunkt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta = row.adjustedScore - row.originalScore;
            return (
              <tr key={row.id}>
                <td data-label="Symbol">
                  <Link href={`/dashboard/signals/${encodeURIComponent(row.signalId)}`}>
                    {row.symbol}
                  </Link>
                </td>
                <td data-label="Zeitebene">{timeframeLabel(row.timeframe)}</td>
                <td data-label="Vorher">{formatScore(row.originalScore)}</td>
                <td data-label="Nachher">{formatScore(row.adjustedScore)}</td>
                <td
                  data-label="Änderung"
                  style={{
                    color: delta > 0 ? "var(--good)" : delta < 0 ? "var(--bad)" : undefined
                  }}
                >
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(1)}
                </td>
                <td data-label="Einstufung vorher">
                  <StatusBadge value={row.originalStatus} />
                </td>
                <td data-label="Einstufung nachher">
                  <StatusBadge value={row.adjustedStatus} />
                </td>
                <td data-label="Hauptgrund">{row.adjustments[0]?.reason ?? "—"}</td>
                <td data-label="Zeitpunkt" className="nowrap">
                  {formatDateTime(row.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

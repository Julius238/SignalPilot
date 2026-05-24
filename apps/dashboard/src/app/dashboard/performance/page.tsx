import Link from "next/link";

import { EmptyState, ErrorState } from "../../../components/empty-state";
import { MetricCard, PageHeader, SectionCard } from "../../../components/ui";
import {
  fetchApi,
  type PerformanceBucket,
  type PerformanceIntelligenceReport
} from "../../../lib/signalpilot-api";

function formatPercent(v: number | null | undefined): string {
  return typeof v === "number" ? `${v.toFixed(2)}%` : "—";
}

const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "Hoch",
  MEDIUM: "Mittel",
  LOW: "Niedrig"
};

const CONFIDENCE_COLORS: Record<string, string | undefined> = {
  HIGH: "var(--good)",
  MEDIUM: "var(--warn)",
  LOW: "var(--bad)"
};

function BucketSection({
  title,
  buckets
}: {
  title: string;
  buckets: PerformanceBucket[];
}) {
  if (buckets.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <SectionCard title={title}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Gruppe</th>
                <th>Ausgewertet</th>
                <th>Übersprungen</th>
                <th>Trefferquote</th>
                <th>Ø 1d Kursänd.</th>
                <th>Belastbarkeit</th>
                <th>Beobachtung</th>
                <th>Einschätzung</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.key}>
                  <td>{bucket.label}</td>
                  <td
                    style={{
                      color:
                        bucket.evaluatedCount < 10
                          ? "var(--bad)"
                          : bucket.evaluatedCount < 30
                            ? "var(--warn)"
                            : undefined
                    }}
                  >
                    {bucket.evaluatedCount}
                    {bucket.evaluatedCount < 30 ? " ⚠" : ""}
                  </td>
                  <td>{bucket.skippedCount}</td>
                  <td>
                    <div className="progress-cell">
                      <span>{formatPercent(bucket.winRate)}</span>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${Math.min(Math.max(bucket.winRate, 0), 100)}%`
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  <td>{formatPercent(bucket.avgReturnAfter1d)}</td>
                  <td
                    style={{
                      color: CONFIDENCE_COLORS[bucket.confidenceLevel]
                    }}
                  >
                    {CONFIDENCE_LABELS[bucket.confidenceLevel] ?? bucket.confidenceLevel}
                  </td>
                  <td className="wide-cell">{bucket.insight}</td>
                  <td className="wide-cell">{bucket.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

export default async function PerformancePage() {
  const report = await fetchApi<PerformanceIntelligenceReport>("/performance/report");
  const data = report.data;

  return (
    <>
      <PageHeader
        title="Research-Performance"
        subtitle="Muster aus simulierten Auswertungen · keine echten Trades · kein Indikator für zukünftige Ergebnisse"
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/paper">
            Simulierte Auswertung →
          </Link>
        }
      />

      {report.error ? (
        <ErrorState
          title="Performance-Report konnte nicht geladen werden"
          message={report.error}
        />
      ) : null}

      {/* Globale Kennzahlen */}
      <div className="grid metrics" style={{ marginBottom: 20 }}>
        <MetricCard label="Auswertungen gesamt" value={data?.totalEvaluations ?? 0} />
        <MetricCard label="Ausgewertet" value={data?.evaluatedCount ?? 0} />
        <MetricCard label="Übersprungen" value={data?.skippedCount ?? 0} />
        <MetricCard
          label={`Trefferquote gesamt (n=${data?.evaluatedCount ?? 0})`}
          value={formatPercent(data?.overallWinRate)}
          sub={
            (data?.evaluatedCount ?? 0) < 30
              ? "⚠ Kleine Datenbasis"
              : (data?.evaluatedCount ?? 0) < 100
                ? "Begrenzte Stichprobe"
                : undefined
          }
        />
        <MetricCard
          label="Ø 1d Kursänd. (simuliert)"
          value={formatPercent(data?.overallAvgReturnAfter1d)}
        />
      </div>

      {data ? (
        <>
          {/* Zusammenfassung */}
          <div style={{ marginBottom: 20 }}>
            <SectionCard title="Zusammenfassung">
              {data.summary ? (
                <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  {data.summary}
                </p>
              ) : null}

              {(data.evaluatedCount < 10 || data.skippedCount > data.evaluatedCount) ? (
                <div className="warning-section" style={{ marginTop: 12 }}>
                  <h3 className="warning-section-title">Datenqualität eingeschränkt</h3>
                  <p className="muted small" style={{ margin: 0 }}>
                    Die Datenbasis ist für belastbare Aussagen zu gering.{" "}
                    <Link href="/dashboard/data-quality" className="section-link">
                      Datenqualität prüfen →
                    </Link>
                  </p>
                </div>
              ) : null}

              {data.warnings.length > 0 ? (
                <ul className="warning-list" style={{ marginTop: 12 }}>
                  {data.warnings.map((w) => (
                    <li key={w} className="warning-item">
                      <span className="warning-icon">⚠</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </SectionCard>
          </div>

          {/* Beobachtungsstatistik */}
          <div className="grid metrics" style={{ marginBottom: 20 }}>
            <MetricCard
              label="Beobachtungen"
              value={data.observationStats.total}
              sub="Beobachtungs-Signale"
            />
            <MetricCard
              label="Beobachtungen ausgewertet"
              value={data.observationStats.evaluatedCount}
            />
            <MetricCard
              label="Positive Bewegungen"
              value={
                <span style={{ color: "var(--good)" }}>
                  {data.observationStats.positiveMovementCount}
                </span>
              }
            />
            <MetricCard
              label="Ø Abs. 1d-Kursänd."
              value={formatPercent(data.observationStats.avgAbsReturnAfter1d)}
              sub="hypothetisch"
            />
          </div>

          {/* Signaltyp-Analyse */}
          <BucketSection title="Signaltypen · stärker" buckets={data.bestSignalTypes} />
          <BucketSection title="Signaltypen · schwächer" buckets={data.worstSignalTypes} />

          {/* Zeitrahmen-Analyse */}
          <BucketSection title="Zeitrahmen · stärker" buckets={data.bestTimeframes} />
          <BucketSection title="Zeitrahmen · schwächer" buckets={data.worstTimeframes} />

          {/* Asset-Analyse */}
          <BucketSection title="Assets · stärker" buckets={data.bestAssets} />
          <BucketSection title="Assets · schwächer" buckets={data.worstAssets} />

          {/* Weitere Gruppen */}
          <div className="grid two">
            <BucketSection title="Score-Gruppen" buckets={data.scoreBuckets} />
            <BucketSection title="Risiko-Gruppen" buckets={data.riskBuckets} />
            <BucketSection title="Status-Gruppen" buckets={data.statusBuckets} />
            <BucketSection title="Bewertungstypen" buckets={data.groupedByEvaluationKind} />
          </div>

          {/* Übersprungen-Gründe */}
          {Object.keys(data.skippedByReason).length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <SectionCard title="Übersprungen nach Grund">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Grund</th>
                        <th>Anzahl</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(data.skippedByReason).map(([reason, count]) => (
                        <tr key={reason}>
                          <td>{reason}</td>
                          <td>{count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState title="Kein Performance-Report verfügbar." />
      )}
    </>
  );
}

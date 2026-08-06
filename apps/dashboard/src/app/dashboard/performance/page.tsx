import Link from "next/link";

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
import { germanizePerformanceText } from "../../../lib/labels";
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
  const errorCopy = describeApiError(
    report.errorKind,
    report.error ?? "",
    "Die Performance-Auswertung"
  );

  const evaluated = data?.evaluatedCount ?? 0;
  const hasData = evaluated > 0;
  const isThin = evaluated > 0 && evaluated < 30;

  const tone = report.error ? "bad" : !hasData ? "neutral" : isThin ? "warn" : "good";
  const verdict = report.error
    ? "Auswertung nicht abrufbar."
    : !hasData
      ? "Noch keine ausgewerteten Beobachtungen vorhanden."
      : isThin
        ? `Erst ${evaluated} ausgewertete Beobachtungen — noch keine belastbare Aussage.`
        : `${evaluated} ausgewertete Beobachtungen, Trefferquote ${formatPercent(data?.overallWinRate)}.`;
  const nextStep = report.error
    ? undefined
    : !hasData
      ? "Auswertungen entstehen automatisch, sobald Signale lange genug zurückliegen, um ihr Ergebnis zu messen."
      : isThin
        ? "Erst ab etwa 30 Auswertungen je Gruppe lohnt der Vergleich. Bis dahin: Datenqualität im Blick behalten."
        : "Die Gruppen unten zeigen, welche Signalarten und Marktphasen bisher am besten abgeschnitten haben.";

  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="Research-Performance"
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/paper">
            Simulierte Auswertung →
          </Link>
        }
      />

      <PageIntro
        purpose="Diese Seite prüft rückblickend, wie gut die eigenen Einstufungen bisher lagen — simuliert, ohne echte Trades und ohne Aussage über die Zukunft."
        tone={tone}
        verdict={verdict}
        nextStep={nextStep}
      />

      {report.error ? (
        <ErrorState
          title={errorCopy.title}
          message={errorCopy.message}
          hint={errorCopy.hint}
          action={errorCopy.retryable ? <RetryButton /> : null}
        />
      ) : null}

      {/* Ohne Datenbasis ist eine Wand aus Nullkacheln irreführend — dann lieber
          eine ehrliche Aussage und die Rohzahlen eingeklappt. */}
      {hasData ? (
        <div className="grid metrics" style={{ marginBottom: 20 }}>
          <MetricCard
            label="Trefferquote"
            value={formatPercent(data?.overallWinRate)}
            sub={`aus ${evaluated} Auswertungen`}
            hint="Anteil der Beobachtungen, die sich rückblickend in die erwartete Richtung entwickelt haben."
            tone={isThin ? "warn" : "good"}
          />
          <MetricCard
            label="Ø Kursänderung nach 1 Tag"
            value={formatPercent(data?.overallAvgReturnAfter1d)}
            sub="hypothetisch, ohne Kosten"
            hint="Durchschnittliche Kursbewegung einen Tag nach der Beobachtung. Rein rechnerisch, keine Rendite."
          />
          <MetricCard
            label="Ausgewertet"
            value={evaluated}
            sub={`von ${data?.totalEvaluations ?? 0} insgesamt`}
            tone="quiet"
          />
          <MetricCard
            label="Übersprungen"
            value={data?.skippedCount ?? 0}
            sub="ohne messbares Ergebnis"
            hint="Beobachtungen, die mangels Daten oder Eignung nicht ausgewertet werden konnten."
            tone={(data?.skippedCount ?? 0) > evaluated ? "warn" : "quiet"}
          />
        </div>
      ) : (
        <EmptyState
          title="Noch keine ausgewerteten Beobachtungen."
          description="Sobald Signale alt genug sind, um ihr Ergebnis zu messen, erscheinen hier Trefferquote und Kursänderungen."
        />
      )}

      {data ? (
        <>
          {/* Einordnung — bei fehlender Datenbasis nicht dreimal dasselbe sagen:
              die Aussage steht schon in der Seiteneinleitung. */}
          {hasData || data.warnings.length > 0 ? (
            <div style={{ marginBottom: 20 }}>
              <SectionCard title="Einordnung">
                {hasData && data.summary ? (
                  <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                    {germanizePerformanceText(data.summary)}
                  </p>
                ) : null}

                {data.evaluatedCount < 10 || data.skippedCount > data.evaluatedCount ? (
                  <div className="finding finding--warn" style={{ marginTop: hasData ? 12 : 0 }}>
                    <span className="finding-icon">⚠</span>
                    <span className="finding-text">
                      Datenbasis für belastbare Aussagen zu gering
                    </span>
                    <span className="finding-action">
                      <Link href="/dashboard/data-quality" className="section-link">
                        Datenqualität prüfen →
                      </Link>
                    </span>
                  </div>
                ) : null}

                {data.warnings.length > 0 ? (
                  <div className="finding-list" style={{ marginTop: 12 }}>
                    {data.warnings.map((w) => (
                      <div className="finding finding--warn" key={w}>
                        <span className="finding-icon">⚠</span>
                        <span className="finding-text">{germanizePerformanceText(w)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </SectionCard>
            </div>
          ) : null}

          {/* Beobachtungsstatistik — sekundär, deshalb eingeklappt. */}
          <TechnicalDetails
            summary="Reine Beobachtungen im Detail"
            count={data.observationStats.total}
          >
            <div className="grid metrics">
              <MetricCard
                label="Beobachtungen"
                value={data.observationStats.total}
                sub="ohne Richtungserwartung"
                hint="Signale, die nur festhalten, dass etwas auffällig war — ohne eine Richtung zu erwarten."
                tone="quiet"
              />
              <MetricCard
                label="Davon ausgewertet"
                value={data.observationStats.evaluatedCount}
                tone="quiet"
              />
              <MetricCard
                label="Positive Bewegungen"
                value={data.observationStats.positiveMovementCount}
                tone="good"
              />
              <MetricCard
                label="Ø Bewegung nach 1 Tag"
                value={formatPercent(data.observationStats.avgAbsReturnAfter1d)}
                sub="Betrag, ohne Richtung"
                hint="Wie stark sich der Kurs nach der Beobachtung bewegt hat — unabhängig davon, in welche Richtung."
                tone="quiet"
              />
            </div>
          </TechnicalDetails>

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

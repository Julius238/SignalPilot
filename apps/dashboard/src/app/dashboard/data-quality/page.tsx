import Link from "next/link";

import { ErrorState, EmptyState } from "../../../components/empty-state";
import { RetryButton } from "../../../components/retry-button";
import {
  InfoHint,
  MetricCard,
  PageHeader,
  PageIntro,
  SectionCard,
  TechnicalDetails
} from "../../../components/ui";
import { describeApiError } from "../../../lib/api-error";
import { formatDateTime } from "../../../lib/format";
import { assetTypeLabel, germanizeDataQualityText } from "../../../lib/labels";
import {
  buildQuery,
  fetchApi,
  type AssetCoverage,
  type DataQualityReport
} from "../../../lib/signalpilot-api";

type DataQualityPageProps = {
  searchParams: Promise<{
    assetType?: string;
    minQualityScore?: string;
  }>;
};

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(1)} %` : "—";
}

function QualityBar({ score }: { score: number }) {
  const color = score >= 80 ? "var(--good)" : score >= 50 ? "var(--warn)" : "var(--bad)";
  const meaning = score >= 80 ? "gut" : score >= 50 ? "lückenhaft" : "kritisch";
  return (
    <div className="progress-cell">
      <span style={{ color, fontWeight: 700 }}>
        {score} / 100 <span className="muted small">· {meaning}</span>
      </span>
      <div
        className="progress-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label={`Datenqualität ${score} von 100 — ${meaning}`}
      >
        <div className="progress-fill" style={{ width: `${score}%`, background: color }} />
      </div>
    </div>
  );
}

function TimeframeCoverage({ asset }: { asset: AssetCoverage }) {
  return (
    <div className="stack-list compact">
      {Object.entries(asset.candleCountsByTimeframe).map(([timeframe, count]) => {
        const ok = asset.hasMinimumCandlesByTimeframe[timeframe];
        return (
          <div key={timeframe} className="list-row">
            <strong>{timeframe}</strong>
            <span style={{ color: ok ? undefined : "var(--bad)" }}>
              {count}
              {ok ? "" : " · zu wenig"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Ordnet einer übersetzten Warnung den nächsten sinnvollen Schritt zu.
function nextStepForWarning(warning: string): string {
  const value = warning.toLowerCase();
  if (value.includes("ausgewertet") || value.includes("auswertung")) {
    return "Die rückblickende Auswertung nachziehen lassen.";
  }
  if (value.includes("kursdaten") || value.includes("kursreihen") || value.includes("lücken")) {
    return "Datenanbindung prüfen — der Kursdaten-Abruf ist möglicherweise unterbrochen.";
  }
  if (value.includes("benachrichtigung") || value.includes("zugestellt")) {
    return "Zustellweg der Benachrichtigungen prüfen.";
  }
  if (value.includes("signal")) {
    return "Analyse-Pipeline erneut ausführen oder das betroffene Asset in der Watchlist prüfen.";
  }
  if (value.includes("termin")) {
    return "Terminquelle prüfen — für dieses Asset liegen keine Termine vor.";
  }
  return "Details in der Abdeckungstabelle weiter unten prüfen.";
}

// Warnungen entstehen meist mehrfach pro Asset. Gruppiert lesen sie sich als
// "3 Punkte bei AAPL" statt als drei gleich aussehende Zeilen.
function groupWarnings(warnings: string[]): Array<{ subject: string; items: string[] }> {
  const groups = new Map<string, string[]>();
  for (const warning of warnings) {
    const subject = warning.includes(":") ? warning.slice(0, warning.indexOf(":")) : "Allgemein";
    const list = groups.get(subject) ?? [];
    list.push(warning);
    groups.set(subject, list);
  }
  return [...groups.entries()]
    .map(([subject, items]) => ({ subject, items }))
    .sort((left, right) => right.items.length - left.items.length);
}

export default async function DataQualityPage({ searchParams }: DataQualityPageProps) {
  const params = await searchParams;
  const query = buildQuery({
    assetType: params.assetType,
    minQualityScore: params.minQualityScore,
    limit: 100
  });
  const [report, assets] = await Promise.all([
    fetchApi<DataQualityReport>("/data-quality/report"),
    fetchApi<AssetCoverage[]>(`/data-quality/assets${query}`)
  ]);
  const data = report.data;

  const warnings = (data?.warnings ?? []).map(germanizeDataQualityText);
  const recommendations = (data?.recommendations ?? []).map(germanizeDataQualityText);
  const warningGroups = groupWarnings(warnings);

  const reportErrorCopy = describeApiError(
    report.errorKind,
    report.error ?? "",
    "Der Qualitätsbericht"
  );
  const assetsErrorCopy = describeApiError(
    assets.errorKind,
    assets.error ?? "",
    "Die Abdeckung je Asset"
  );

  const signalsLast24h = data?.signalCoverage.signalsLast24h ?? 0;
  const totalSignals = data?.signalCoverage.totalSignals ?? 0;
  const withoutEvaluation = data?.signalCoverage.signalsWithoutEvaluation ?? 0;
  const skippedRate = data?.evaluationCoverage.skippedRate ?? 0;

  // Zustand der Seite: Stimmen die Daten, auf denen alles andere aufbaut?
  const isStale = totalSignals > 0 && signalsLast24h === 0;
  const tone = report.error ? "bad" : warnings.length > 0 || isStale ? "warn" : "good";
  const verdict = report.error
    ? "Qualitätsbericht nicht abrufbar."
    : warnings.length === 0 && !isStale
      ? "Keine Datenqualitätsprobleme erkannt."
      : isStale && warnings.length === 0
        ? "Die Daten sind vollständig, aber nicht mehr aktuell."
        : `${warnings.length} Punkt${warnings.length !== 1 ? "e" : ""} zur Datenqualität offen.`;
  const detail = isStale
    ? "In den letzten 24 Stunden wurde kein neues Signal erzeugt."
    : undefined;
  const nextStep = report.error
    ? undefined
    : isStale
      ? "Prüfen, ob die Analyse-Pipeline läuft — alle anderen Seiten zeigen sonst veraltete Stände."
      : warningGroups.length > 0
        ? `Zuerst „${warningGroups[0].subject}“ ansehen — dort sind die meisten Punkte offen.`
        : "Nichts zu tun. Nach dem nächsten Datenlauf erneut prüfen.";

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Datenqualität"
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/performance">
            Performance ansehen
          </Link>
        }
      />

      <PageIntro
        purpose="Diese Seite zeigt, wie vollständig und wie frisch die Daten sind, auf denen alle Auswertungen im Dashboard beruhen."
        tone={tone}
        verdict={verdict}
        detail={detail}
        nextStep={nextStep}
      />

      {report.error ? (
        <ErrorState
          title={reportErrorCopy.title}
          message={reportErrorCopy.message}
          hint={reportErrorCopy.hint}
          action={reportErrorCopy.retryable ? <RetryButton /> : null}
        />
      ) : null}
      {assets.error ? (
        <ErrorState
          title={assetsErrorCopy.title}
          message={assetsErrorCopy.message}
          hint={assetsErrorCopy.hint}
          action={assetsErrorCopy.retryable ? <RetryButton /> : null}
        />
      ) : null}

      <form className="filter-bar" style={{ marginBottom: 16 }}>
        <select name="assetType" defaultValue={params.assetType ?? ""} aria-label="Asset-Typ">
          <option value="">Alle Asset-Typen</option>
          <option value="CRYPTO">Krypto</option>
          <option value="STOCK">Aktien</option>
          <option value="ETF">ETF</option>
        </select>
        <input
          name="minQualityScore"
          defaultValue={params.minQualityScore ?? ""}
          inputMode="numeric"
          placeholder="Mindest-Qualität (0–100)"
          aria-label="Mindest-Qualitätsscore"
        />
        <button type="submit">Filtern</button>
      </form>

      {/* ── Die vier Kennzahlen, die den Zustand tragen ── */}
      <section className="grid metrics">
        <MetricCard
          label="Neue Signale (24 h)"
          value={signalsLast24h}
          sub={`${totalSignals} insgesamt gespeichert`}
          hint="Wie viele Signale die Analyse in den letzten 24 Stunden erzeugt hat. 0 bedeutet, dass die Pipeline nicht gelaufen ist."
          tone={isStale ? "warn" : signalsLast24h > 0 ? "good" : "quiet"}
        />
        <MetricCard
          label="Noch nicht ausgewertet"
          value={withoutEvaluation}
          sub="Signale ohne rückblickende Auswertung"
          hint="Signale, für die noch keine Paper-Auswertung vorliegt. Sie fehlen dadurch in der Performance-Statistik."
          tone={withoutEvaluation > 0 ? "warn" : "good"}
        />
        <MetricCard
          label="Auswertungsquote"
          value={formatPercent(data?.signalCoverage.evaluationCoverageRate)}
          sub="Anteil der Signale mit Auswertung"
          hint="Je höher, desto belastbarer sind die Performance-Zahlen."
          tone={
            (data?.signalCoverage.evaluationCoverageRate ?? 0) >= 80
              ? "good"
              : (data?.signalCoverage.evaluationCoverageRate ?? 0) > 0
                ? "warn"
                : "quiet"
          }
        />
        <MetricCard
          label="Übersprungen"
          value={formatPercent(skippedRate)}
          sub="Auswertungen ohne Ergebnis"
          hint="Auswertungen, die mangels Daten oder Eignung nicht durchgeführt wurden. Über 20 % ist auffällig."
          tone={skippedRate > 20 ? "warn" : "quiet"}
        />
      </section>

      {/* ── Befunde: Warnungen und Empfehlungen ── */}
      {data ? (
        <div className="grid two" style={{ marginTop: 16 }}>
          <SectionCard
            title="Was auffällt"
            subtitle={
              warnings.length > 0
                ? "Nach Asset gruppiert — aufklappen zeigt die Einzelpunkte."
                : undefined
            }
          >
            {warningGroups.length > 0 ? (
              <div className="finding-list">
                {warningGroups.map((group) => (
                  <details className="finding-group" key={group.subject}>
                    <summary>
                      <span className="finding-icon" style={{ color: "var(--warn)" }}>
                        ⚠
                      </span>
                      <span className="finding-group-title">{group.subject}</span>
                      <span className="finding-group-count">
                        {group.items.length} Punkt{group.items.length !== 1 ? "e" : ""}
                      </span>
                    </summary>
                    <div className="finding-group-body">
                      {group.items.map((warning) => (
                        <div className="finding finding--warn" key={warning}>
                          <span className="finding-icon">⚠</span>
                          <span className="finding-text">{warning}</span>
                          <span className="finding-action">{nextStepForWarning(warning)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Keine Datenqualitätsprobleme erkannt."
                description="Abdeckung, Frische und Auswertungen liegen im erwarteten Rahmen."
                tone="calm"
              />
            )}
          </SectionCard>

          <SectionCard
            title="Was hilft"
            subtitle="Vorschläge, die sich aus den obigen Punkten ergeben."
          >
            {recommendations.length > 0 ? (
              <div className="finding-list">
                {recommendations.map((rec) => (
                  <div className="finding finding--info" key={rec}>
                    <span className="finding-icon">→</span>
                    <span className="finding-text">{rec}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Derzeit kein Handlungsbedarf." tone="calm" />
            )}
          </SectionCard>
        </div>
      ) : null}

      {/* ── Abdeckung je Asset ── */}
      <SectionCard
        title="Abdeckung je Asset"
        subtitle="Unter 50 = kritische Lücke · 50–80 = Verbesserungsbedarf · über 80 = gut."
        className="section-card--spaced"
      >
        {assets.data && assets.data.length > 0 ? (
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Typ</th>
                  <th>Datenqualität</th>
                  <th>Kursdaten</th>
                  <th>Signale</th>
                  <th>Auswertungen</th>
                  <th>Letztes Signal (1 Std.)</th>
                  <th>Hinweise</th>
                </tr>
              </thead>
              <tbody>
                {assets.data.map((asset) => (
                  <tr key={asset.symbol}>
                    <td data-label="Asset">
                      <Link href={`/dashboard/assets/${encodeURIComponent(asset.symbol)}`}>
                        {asset.symbol}
                      </Link>
                    </td>
                    <td data-label="Typ">{assetTypeLabel(asset.assetType)}</td>
                    <td data-label="Datenqualität">
                      <QualityBar score={asset.qualityScore} />
                    </td>
                    <td data-label="Kursdaten">
                      <TimeframeCoverage asset={asset} />
                    </td>
                    <td data-label="Signale">{asset.signalCount}</td>
                    <td data-label="Auswertungen">
                      {asset.evaluationCount}
                      {asset.skippedEvaluationCount > 0 ? (
                        <span className="muted small">
                          {" "}
                          · {asset.skippedEvaluationCount} übersprungen
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Letztes Signal (1 Std.)" className="muted small">
                      {formatDateTime(asset.latestSignalByTimeframe["1h"])}
                    </td>
                    <td data-label="Hinweise">
                      {asset.warnings.length > 0 ? (
                        <span style={{ color: "var(--warn)", fontSize: 12 }}>
                          {asset.warnings.map(germanizeDataQualityText).join(" · ")}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Keine Abdeckungsdaten vorhanden."
            description="Sie entstehen, sobald für mindestens ein Asset Kursdaten gespeichert sind."
          />
        )}
      </SectionCard>

      {/* ── Technische Rohdaten: erreichbar, aber nicht dominant ── */}
      {data ? (
        <>
          <TechnicalDetails
            summary="Datenanbieter im Detail"
            count={data.providerHealth.length}
          >
            {data.providerHealth.length > 0 ? (
              <div className="table-wrap">
                <table className="responsive-table">
                  <thead>
                    <tr>
                      <th>Anbieter</th>
                      <th>Abdeckung</th>
                      <th>Kerzen</th>
                      <th>Lücken</th>
                      <th>Veraltet</th>
                      <th>Fehler</th>
                      <th>Ratenlimits</th>
                      <th>Zugriff verweigert</th>
                      <th>Ohne Daten</th>
                      <th>Letzter Erfolg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.providerHealth.map((provider) => (
                      <tr key={provider.provider}>
                        <td data-label="Anbieter">
                          <strong>{provider.provider}</strong>
                        </td>
                        <td data-label="Abdeckung">{formatPercent(provider.coveragePercent)}</td>
                        <td data-label="Kerzen">
                          {provider.candleCount} / {provider.expectedCandleCount}
                        </td>
                        <td
                          data-label="Lücken"
                          style={{ color: provider.gapCount > 0 ? "var(--warn)" : undefined }}
                        >
                          {provider.gapCount} ({provider.missingCandleCount} Kerzen)
                        </td>
                        <td
                          data-label="Veraltet"
                          style={{
                            color: provider.staleSeriesCount > 0 ? "var(--warn)" : undefined
                          }}
                        >
                          {provider.staleSeriesCount}
                        </td>
                        <td data-label="Fehler">{provider.providerErrorCount}</td>
                        <td data-label="Ratenlimits">{provider.rateLimitCount}</td>
                        <td
                          data-label="Zugriff verweigert"
                          style={{
                            color: provider.entitlementErrorCount > 0 ? "var(--bad)" : undefined
                          }}
                        >
                          {provider.entitlementErrorCount}
                        </td>
                        <td data-label="Ohne Daten">{provider.noDataCount}</td>
                        <td data-label="Letzter Erfolg">
                          {provider.lastSuccessfulFetchAt
                            ? formatDateTime(provider.lastSuccessfulFetchAt)
                            : "Noch keiner"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Noch keine Messwerte der Datenanbieter."
                description="Sie entstehen mit dem ersten Kursdaten-Abruf."
              />
            )}
          </TechnicalDetails>

          <TechnicalDetails summary="Nachrichten-Abdeckung im Detail">
            <div className="grid metrics">
              <MetricCard
                label="Gespeicherte Meldungen"
                value={data.newsCoverage.totalStored}
                sub={`${data.newsCoverage.storedLast7Days} in den letzten 7 Tagen`}
                tone="quiet"
              />
              <MetricCard
                label="Relevant (72 Std.)"
                value={data.newsCoverage.relevantLast72Hours}
                sub="Relevanz mindestens 30 von 100"
                hint="Nur Meldungen ab dieser Schwelle erscheinen auf der Übersicht."
                tone="quiet"
              />
              <MetricCard
                label="Nur im Dashboard"
                value={data.newsCoverage.dashboardOnlyCount}
                sub="Rohmeldungen unter der Relevanzschwelle"
                tone="quiet"
              />
              <MetricCard
                label="Duplikate (7 Tage)"
                value={data.newsCoverage.duplicateCount}
                sub="zusammengeführt statt neu gespeichert"
                tone="quiet"
              />
              <MetricCard
                label="Verworfen (7 Tage)"
                value={data.newsCoverage.discardedCount}
                sub="unklassifizierte Meldungen bleiben erhalten"
                tone="quiet"
              />
            </div>
          </TechnicalDetails>

          <TechnicalDetails summary="Weitere Zähler">
            <div className="grid metrics">
              <MetricCard
                label="Zugestellte Benachrichtigungen"
                value={data.alertCoverage.successfulAlertCount}
                tone="quiet"
              />
              <MetricCard label="Signale gesamt" value={totalSignals} tone="quiet" />
            </div>
          </TechnicalDetails>
        </>
      ) : null}

      <p className="muted small" style={{ marginTop: 16 }}>
        Alle Werte stammen aus gespeicherten Daten dieser Installation
        <InfoHint text="Es werden keine externen Dienste abgefragt, um diese Seite zu erzeugen." />
      </p>
    </>
  );
}

import Link from "next/link";

import { DiscoveryControls } from "../../../components/discovery-controls";
import { EmptyState, ErrorState } from "../../../components/empty-state";
import { RetryButton } from "../../../components/retry-button";
import {
  MetricCard,
  PageHeader,
  PageIntro,
  SectionCard,
  type PageVerdictTone
} from "../../../components/ui";
import { describeApiError } from "../../../lib/api-error";
import {
  assetTypeLabel,
  universeRoleLabel,
  universeSourceLabel
} from "../../../lib/labels";
import { formatDateTime } from "../../../lib/format";
import {
  fetchApi,
  type AssetDiscoveryCandidate,
  type AssetDiscoveryOverview
} from "../../../lib/signalpilot-api";

const reasonLabels: Record<string, string> = {
  UNUSUAL_VOLUME: "Ungewöhnlich hohes Volumen",
  MATERIAL_PRICE_MOVEMENT: "Materielle Kursbewegung",
  STRONG_LIQUIDITY: "Hohe Liquidität",
  STRONG_TRADING_VOLUME: "Robustes Handelsvolumen",
  STRONG_VOLUME_CHANGE: "Volumen zieht an",
  STRONG_VOLATILITY: "Verwertbare, nicht extreme Volatilität",
  STRONG_PRICE_MOVEMENT: "Auffällige Bewegung",
  STRONG_TREND_STRENGTH: "Klarer Trend",
  STRONG_RELATIVE_STRENGTH: "Relative Stärke",
  STRONG_BREAKOUT_PROXIMITY: "Nahe an einer relevanten Zone",
  OPEN_CAPACITY_AND_POLICY_MATCH: "Erfüllt Score- und Diversifikationsregeln",
  CORE_PROTECTED: "Core-Asset bleibt dauerhaft aktiv",
  USER_PIN_PROTECTED: "Vom Nutzer angeheftet",
  MANUAL_SELECTION_PROTECTED: "Manuell aktiv",
  ACTIVE_INCUMBENT: "Aktiver Bestand bleibt stabil"
};

const exclusionLabels: Record<string, string> = {
  INSUFFICIENT_LIQUIDITY: "Liquidität zu gering",
  INSUFFICIENT_DATA_QUALITY: "Datenqualität zu gering",
  INSUFFICIENT_HISTORY: "Historie zu kurz",
  STALE_DATA: "Daten nicht frisch genug",
  BELOW_MINIMUM_SCORE: "Score unter Mindestwert",
  USER_EXCLUDED: "Vom Nutzer ausgeschlossen",
  HARD_QUALITY_GATE: "Qualitätsgate nicht bestanden",
  DIVERSIFICATION_OR_CAPACITY_LIMIT: "Diversifikation oder Klassenlimit"
};

const componentLabels: Record<string, string> = {
  liquidity: "Liquidität",
  tradingVolume: "Handelsvolumen",
  volumeChange: "Volumenänderung",
  volatility: "Volatilität",
  priceMovement: "Kursbewegung",
  trendStrength: "Trendstärke",
  relativeStrength: "Relative Stärke",
  breakoutProximity: "Ausbruchsnähe",
  multiTimeframeConfluence: "Zeitebenen-Konfluenz",
  dataFreshness: "Datenfrische",
  dataCompleteness: "Datenvollständigkeit",
  newsActivity: "News/Event-Aktivität",
  unusualActivity: "Ungewöhnliche Aktivität",
  historicalSignalQuality: "Bisherige Signalqualität",
  paperAndBacktestQuality: "Paper/Backtest-Qualität"
};

function scoreColor(score: number) {
  return score >= 75 ? "var(--good)" : score >= 62 ? "var(--warn)" : "var(--muted)";
}

function statusLabel(candidate: AssetDiscoveryCandidate) {
  if (candidate.isCore) return "Core";
  if (candidate.isExcluded) return "Ausgeschlossen";
  if (candidate.isPinned) return "Angeheftet";
  if (candidate.manualActive) return "Manuell";
  if (candidate.universeSource === "AUTO_DISCOVERED") return "Automatisch";
  if (candidate.observeOnly) return "Frühe Beobachtung";
  return candidate.isActive ? "Voll analysiert" : "Discovery";
}

function actionLabel(action: AssetDiscoveryCandidate["proposedAction"]) {
  if (action === "ADD") return "Aufnahme vorgeschlagen";
  if (action === "REMOVE") return "Entfernung vorgeschlagen";
  if (action === "KEEP") return "Beibehalten";
  return "Keine Änderung";
}

function CandidateTable({
  candidates,
  emptyTitle
}: {
  candidates: AssetDiscoveryCandidate[];
  emptyTitle: string;
}) {
  if (candidates.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description="Nach dem nächsten aktivierten Discovery-Lauf erscheinen hier begründete Kandidaten."
      />
    );
  }

  return (
    <div className="table-wrap discovery-table">
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Score</th>
            <th>Qualität</th>
            <th>Liquidität</th>
            <th>Warum auffällig?</th>
            <th>Status</th>
            <th>Nutzersteuerung</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => {
            const components = Object.entries(candidate.components)
              .sort((left, right) => right[1] - left[1])
              .slice(0, 6);
            return (
              <tr key={candidate.id}>
                <td>
                  <Link href={`/dashboard/assets/${encodeURIComponent(candidate.symbol)}`}>
                    {candidate.symbol}
                  </Link>
                  <span className="muted small discovery-asset-meta">
                    {assetTypeLabel(candidate.assetType)} · {candidate.exchange}
                    {candidate.sector ? ` · ${candidate.sector}` : ""}
                  </span>
                </td>
                <td>
                  <strong style={{ color: scoreColor(candidate.score) }}>
                    {candidate.score.toFixed(1)}
                  </strong>
                  <span className="muted small discovery-asset-meta">
                    Confidence {candidate.confidence.toFixed(0)}
                    {candidate.scoreDelta === null
                      ? ""
                      : ` · ${candidate.scoreDelta > 0 ? "+" : ""}${candidate.scoreDelta.toFixed(1)}`}
                  </span>
                </td>
                <td>{candidate.dataQuality.toFixed(0)} / 100</td>
                <td>{candidate.liquidity.toFixed(0)} / 100</td>
                <td className="wide-cell">
                  <div className="discovery-reasons">
                    {candidate.reasons.slice(0, 3).map((reason) => (
                      <span key={reason}>{reasonLabels[reason] ?? reason}</span>
                    ))}
                    {candidate.exclusionReasons.slice(0, 2).map((reason) => (
                      <span className="negative" key={reason}>
                        {exclusionLabels[reason] ?? reason}
                      </span>
                    ))}
                  </div>
                  {components.length > 0 ? (
                    <details className="discovery-details">
                      <summary>Score erklären</summary>
                      <div className="discovery-component-grid">
                        {components.map(([key, value]) => (
                          <span key={key}>
                            {componentLabels[key] ?? key}: <strong>{value.toFixed(0)}</strong>
                          </span>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </td>
                <td>
                  <span className="badge badge-info">{statusLabel(candidate)}</span>
                  <span className="muted small discovery-asset-meta">
                    {actionLabel(candidate.proposedAction)}
                  </span>
                </td>
                <td>
                  <DiscoveryControls
                    assetId={candidate.assetId}
                    isCore={candidate.isCore}
                    isPinned={candidate.isPinned}
                    isExcluded={candidate.isExcluded}
                    manualActive={candidate.manualActive}
                    observeOnly={candidate.observeOnly}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function DiscoveryPage() {
  const overview = await fetchApi<AssetDiscoveryOverview>("/discovery/overview?limit=120");
  const data = overview.data;
  const errorCopy = describeApiError(
    overview.errorKind,
    overview.error ?? "",
    "Die Discovery-Daten"
  );

  const proposals =
    (data?.summary.proposedAdditionCount ?? 0) + (data?.summary.proposedRemovalCount ?? 0);
  const introTone: PageVerdictTone = overview.error
    ? "bad"
    : !data?.config.enabled
      ? "neutral"
      : data.latestRun === null
        ? "neutral"
        : proposals > 0
          ? "warn"
          : "good";
  const introVerdict = overview.error
    ? "Auswahl nicht abrufbar."
    : !data?.config.enabled
      ? `Automatische Auswahl ist ausgeschaltet — ${data?.summary.activeCount ?? 0} Werte werden manuell beobachtet.`
      : data.latestRun === null
        ? "Automatische Auswahl ist eingeschaltet, aber noch nie gelaufen."
        : proposals > 0
          ? `${proposals} Änderungsvorschlag${proposals !== 1 ? "e" : ""} aus dem letzten Lauf.`
          : `Keine Änderung vorgeschlagen — die ${data.summary.activeCount} beobachteten Werte bleiben unverändert.`;
  const introNextStep = overview.error
    ? undefined
    : !data?.config.enabled
      ? "Solange die Auswahl ausgeschaltet ist, ändert SignalPilot nichts von selbst."
      : data.latestRun === null
        ? "Der erste Lauf erzeugt Kandidaten, Scores und Vorschläge."
        : proposals > 0
          ? "Die Vorschläge unten ansehen — im Dry-Run wird nichts automatisch übernommen."
          : "Nichts zu tun. Der nächste Lauf prüft erneut.";

  return (
    <>
      <PageHeader
        eyebrow="Beobachten"
        title="Markt entdecken"
        actions={
          <>
            <Link className="primary-link secondary-link" href="/dashboard/data-quality">
              Datenqualität
            </Link>
            <Link className="primary-link secondary-link" href="/dashboard/watchlist">
              Alert-Einstellungen
            </Link>
          </>
        }
      />

      <PageIntro
        purpose="Diese Seite schlägt vor, welche Werte SignalPilot dauerhaft beobachten sollte — anhand von Liquidität, Datenqualität und Auffälligkeit."
        tone={introTone}
        verdict={introVerdict}
        nextStep={introNextStep}
      />

      {overview.error ? (
        <ErrorState
          title={errorCopy.title}
          message={errorCopy.message}
          hint={errorCopy.hint}
          action={errorCopy.retryable ? <RetryButton /> : null}
        />
      ) : null}

      {data ? (
        <>
          <section
            className={`card discovery-mode-banner ${
              data.config.dryRun ? "discovery-mode-banner--dry" : "discovery-mode-banner--live"
            }`}
          >
            <div>
              <span className="page-eyebrow">
                {data.config.enabled ? "Discovery aktiviert" : "Discovery deaktiviert"}
              </span>
              <h2>
                {data.config.dryRun
                  ? "Dry-Run: Vorschläge ohne produktive Änderungen"
                  : "Automatische Reconciliation freigegeben"}
              </h2>
              <p className="muted">
                Policy {data.config.policyVersion} · Zeitplan {data.config.cron}. Discovery
                erzeugt keine Telegram-Sofortmeldungen.
              </p>
            </div>
            <span className={`badge ${data.config.dryRun ? "alert-pending" : "alert-sent"}`}>
              {data.config.dryRun ? "DRY-RUN" : "AKTIV"}
            </span>
          </section>

          {/* "Noch kein Lauf" ist ein eigener Zustand — weder Fehler noch "deaktiviert". */}
          {data.latestRun === null ? (
            <div style={{ marginBottom: 16 }}>
              <EmptyState
                title="Noch kein Discovery-Lauf durchgeführt."
                description={
                  data.config.enabled
                    ? "Das aktive Universe unten stammt aus Core- und manuellen Zuweisungen. Kandidaten, Scores und Vorschläge entstehen mit dem ersten Lauf."
                    : "Asset Discovery ist derzeit deaktiviert. Das aktive Universe unten stammt aus Core- und manuellen Zuweisungen."
                }
              />
            </div>
          ) : null}

          <div className="grid metrics">
            <MetricCard
              label="Aktives Universe"
              value={data.summary.activeCount}
              sub={`${data.summary.coreCount} Core · ${data.summary.autoActiveCount} automatisch`}
            />
            <MetricCard
              label="Geprüfte Kandidaten"
              value={data.summary.candidateCount}
              sub={data.latestRun ? `Lauf ${formatDateTime(data.latestRun.startedAt)}` : "Noch kein Lauf"}
            />
            <MetricCard
              label="Vorgeschlagene Aufnahmen"
              value={data.summary.proposedAdditionCount}
              sub="noch keine Kaufempfehlung"
            />
            <MetricCard
              label="Vorgeschlagene Entfernungen"
              value={data.summary.proposedRemovalCount}
              sub={`Stabilität ${data.summary.stabilityRate.toFixed(0)}%`}
            />
            <MetricCard
              label="Provider-Aufwand"
              value={data.summary.providerRequestCount}
              sub={`ca. ${data.summary.estimatedApiUnits} API-Einheiten`}
            />
          </div>

          <div className="grid two">
            <SectionCard
              title="Vorgeschlagene Aufnahmen"
              subtitle="Nur Kandidaten, die harte Daten-, Liquiditäts- und Diversifikationsregeln bestehen."
            >
              <CandidateTable
                candidates={data.proposedAdditions}
                emptyTitle="Keine Aufnahme vorgeschlagen."
              />
            </SectionCard>
            <SectionCard
              title="Vorgeschlagene Entfernungen"
              subtitle="Core, Pins und manuelle Assets sind vor automatischer Entfernung geschützt."
            >
              <CandidateTable
                candidates={data.proposedRemovals}
                emptyTitle="Keine Entfernung vorgeschlagen."
              />
            </SectionCard>
          </div>

          <div className="grid two discovery-movers">
            <SectionCard title="Aufsteiger" subtitle="Größte Score-Verbesserungen zum vorherigen Lauf.">
              {data.risers.length > 0 ? (
                <div className="stack-list compact">
                  {data.risers.map((candidate) => (
                    <div className="list-row" key={candidate.id}>
                      <Link href={`/dashboard/assets/${encodeURIComponent(candidate.symbol)}`}>
                        {candidate.symbol}
                      </Link>
                      <span className="status-strong_watch badge">
                        +{candidate.scoreDelta?.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Noch kein Vergleichslauf vorhanden.</p>
              )}
            </SectionCard>
            <SectionCard title="Absteiger" subtitle="Score-Rückgänge ohne vorschnelles tägliches Umschichten.">
              {data.fallers.length > 0 ? (
                <div className="stack-list compact">
                  {data.fallers.map((candidate) => (
                    <div className="list-row" key={candidate.id}>
                      <Link href={`/dashboard/assets/${encodeURIComponent(candidate.symbol)}`}>
                        {candidate.symbol}
                      </Link>
                      <span className="status-avoid badge">
                        {candidate.scoreDelta?.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Noch kein Vergleichslauf vorhanden.</p>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="Alle Kandidaten"
            subtitle="Die Detailansicht zeigt Gründe und stärkste Score-Komponenten statt einer rohen Kennzahlenwand."
          >
            <CandidateTable candidates={data.candidates} emptyTitle="Noch keine Kandidaten." />
          </SectionCard>

          <SectionCard
            title="Aktuell vollständig analysiert"
            subtitle="Core, manuelle und automatisch ausgewählte Assets. Alert-Einstellungen bleiben in der Watchlist."
          >
            {data.activeAssets.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Rolle</th>
                      <th>Quelle</th>
                      <th>Score</th>
                      <th>Datenqualität</th>
                      <th>Aktiv seit</th>
                      <th>Alerts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activeAssets.map((item) => (
                      <tr key={item.asset.id}>
                        <td>
                          <Link href={`/dashboard/assets/${encodeURIComponent(item.asset.symbol)}`}>
                            {item.asset.symbol}
                          </Link>
                          <span className="muted small discovery-asset-meta">
                            {assetTypeLabel(item.asset.assetType)} · {item.asset.exchange}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-info">{universeRoleLabel(item.role)}</span>
                        </td>
                        <td>{universeSourceLabel(item.source)}</td>
                        <td>{item.score?.toFixed(1) ?? "—"}</td>
                        <td>{item.dataQuality?.toFixed(0) ?? "—"}</td>
                        <td>{item.activatedAt ? formatDateTime(item.activatedAt) : "—"}</td>
                        <td>{item.alertEnabled ? "Aktiv" : "Aus"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Kein aktives Universe vorhanden."
                description="Core-Assets werden mit der Migration beziehungsweise dem Seed angelegt."
              />
            )}
          </SectionCard>

          <SectionCard
            title="Erfolgsmessung"
            subtitle="Automatische Assets gelten erst nach ausreichend langer Paper-Stichprobe als bewährt."
          >
            <div className="discovery-evaluation-grid">
              <div>
                <span className="metric-label">Automatisch</span>
                <strong>
                  {data.summary.paperComparison.auto.winRate === null
                    ? "Noch keine belastbare Stichprobe"
                    : `${data.summary.paperComparison.auto.winRate.toFixed(1)}% Trefferquote`}
                </strong>
                <span className="muted small">
                  n={data.summary.paperComparison.auto.sampleSize}
                </span>
              </div>
              <div>
                <span className="metric-label">Manuell / Core</span>
                <strong>
                  {data.summary.paperComparison.manual.winRate === null
                    ? "Noch keine belastbare Stichprobe"
                    : `${data.summary.paperComparison.manual.winRate.toFixed(1)}% Trefferquote`}
                </strong>
                <span className="muted small">
                  n={data.summary.paperComparison.manual.sampleSize}
                </span>
              </div>
              <div>
                <span className="metric-label">Ø Verweildauer</span>
                <strong>{data.summary.averageResidenceDays.toFixed(1)} Tage</strong>
                <span className="muted small">historische Active-Memberships</span>
              </div>
            </div>
          </SectionCard>
        </>
      ) : null}
    </>
  );
}

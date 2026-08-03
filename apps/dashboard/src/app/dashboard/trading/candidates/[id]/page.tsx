import Link from "next/link";
import { notFound } from "next/navigation";

import { DebugJsonBlock } from "../../../../../components/debug-json-block";
import { ErrorState } from "../../../../../components/empty-state";
import { MetricCard, PageHeader, SectionCard } from "../../../../../components/ui";
import { CandidateStatusBadge } from "../../../../../components/trading/trading-status";
import { TradingDisabled } from "../../../../../components/trading/trading-disabled";
import { fetchTradeCandidateDetail } from "../../../../../lib/trading-api";
import { formatDecimalAmount, formatUtcDateTime } from "../../../../../lib/trading-format";
import { TRADING_DASHBOARD_ENABLED } from "../../../../../lib/trading-flag";

type PageProps = { params: Promise<{ id: string }> };

export default async function TradeCandidateDetailPage({ params }: PageProps) {
  if (!TRADING_DASHBOARD_ENABLED) {
    return <TradingDisabled />;
  }

  const { id } = await params;
  const result = await fetchTradeCandidateDetail(id);

  if (result.error === "Not Found" || (result.error && result.error.toLowerCase().includes("not found"))) {
    notFound();
  }

  const candidate = result.data;

  return (
    <>
      <PageHeader
        eyebrow="Trade Candidate"
        title={candidate?.symbol ?? candidate?.assetId ?? id}
        subtitle={candidate ? candidate.candidateKey : undefined}
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/trading/candidates">
            ← Alle Kandidaten
          </Link>
        }
      />

      {result.error ? (
        <ErrorState title="Kandidat konnte nicht geladen werden" message={result.error} />
      ) : null}

      {candidate ? (
        <>
          <div className="grid metrics">
            <MetricCard
              label="Status"
              value={<CandidateStatusBadge value={candidate.status} />}
            />
            <MetricCard label="Richtung" value={candidate.direction} />
            <MetricCard label="Entry-Typ" value={candidate.entryType} />
            <MetricCard label="Referenz-Entry" value={formatDecimalAmount(candidate.referenceEntryPrice)} />
            <MetricCard label="Stop" value={formatDecimalAmount(candidate.stopPrice)} />
            <MetricCard label="Take Profit" value={formatDecimalAmount(candidate.takeProfitPrice)} />
            <MetricCard label="Min. CRV" value={formatDecimalAmount(candidate.minimumRewardRisk)} />
            <MetricCard label="Geplantes CRV" value={formatDecimalAmount(candidate.plannedRewardRisk)} />
            <MetricCard label="Stop-Distanz" value={formatDecimalAmount(candidate.stopDistance)} />
            <MetricCard label="Stop-Distanz %" value={`${formatDecimalAmount(candidate.stopDistancePct)}%`} />
          </div>

          <div className="grid two" style={{ marginTop: 16 }}>
            <SectionCard title="Entry-Fenster">
              <div className="stack-list compact">
                <div className="list-row">
                  <span>Geplantes Entry-Minimum</span>
                  <strong>{formatDecimalAmount(candidate.plannedEntryMinimum)}</strong>
                </div>
                <div className="list-row">
                  <span>Geplantes Entry-Maximum</span>
                  <strong>{formatDecimalAmount(candidate.plannedEntryMaximum)}</strong>
                </div>
                <div className="list-row">
                  <span>Max. Entry-Gap-Distanz</span>
                  <strong>{formatDecimalAmount(candidate.maximumEntryGapDistance)}</strong>
                </div>
                <div className="list-row">
                  <span>Gültig ab</span>
                  <strong>{formatUtcDateTime(candidate.validFrom)}</strong>
                </div>
                <div className="list-row">
                  <span>Frühester Fill</span>
                  <strong>{formatUtcDateTime(candidate.earliestFillAt)}</strong>
                </div>
                <div className="list-row">
                  <span>Max. Haltedauer</span>
                  <strong>{candidate.maxHoldHours ?? "—"} Std.</strong>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Ablauf & Entscheidung">
              <div className="stack-list compact">
                <div className="list-row">
                  <span>Datenstand</span>
                  <strong>{formatUtcDateTime(candidate.dataAsOf)}</strong>
                </div>
                <div className="list-row">
                  <span>Entscheidungszeitpunkt</span>
                  <strong>{formatUtcDateTime(candidate.decisionTime)}</strong>
                </div>
                <div className="list-row">
                  <span>Ablauf</span>
                  <strong>{formatUtcDateTime(candidate.expiresAt)}</strong>
                </div>
                <div className="list-row">
                  <span>Invalid-Grund</span>
                  <strong>{candidate.invalidReasonCode ?? "—"}</strong>
                </div>
                <div className="list-row">
                  <span>Cancel-Grund</span>
                  <strong>{candidate.cancelReasonCode ?? "—"}</strong>
                </div>
              </div>
            </SectionCard>
          </div>

          <div style={{ marginTop: 16 }}>
            <SectionCard title="Strategie-Evidenz" subtitle="Rohcodes der Strategie-Engine, unverändert">
              <DebugJsonBlock label="strategyReasonCodes" data={candidate.strategyReasonCodes} />
            </SectionCard>
          </div>
        </>
      ) : null}
    </>
  );
}

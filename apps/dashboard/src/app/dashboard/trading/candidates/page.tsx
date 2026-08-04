import Link from "next/link";

import { DirectionBadge } from "../../../../components/badges";
import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { PageHeader, SectionCard } from "../../../../components/ui";
import { CandidateStatusBadge } from "../../../../components/trading/trading-status";
import { TradingDisabled } from "../../../../components/trading/trading-disabled";
import { TradingPagination } from "../../../../components/trading/trading-pagination";
import {
  fetchTradeCandidates,
  type TradeCandidateStatus
} from "../../../../lib/trading-api";
import {
  formatDecimalAmount,
  formatUtcDateTime
} from "../../../../lib/trading-format";
import { TRADING_DASHBOARD_ENABLED } from "../../../../lib/trading-flag";

const LIMIT = 50;

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Alle Status" },
  { value: "CREATED", label: "Erstellt" },
  { value: "VALIDATING", label: "Wird geprüft" },
  { value: "READY_FOR_RISK", label: "Bereit für Risikoprüfung" },
  { value: "APPROVED_FOR_SHADOW", label: "Für Shadow freigegeben" },
  { value: "INVALID", label: "Ungültig" },
  { value: "RISK_REJECTED", label: "Risiko abgelehnt" },
  { value: "EXPIRED", label: "Abgelaufen" },
  { value: "CANCELLED", label: "Storniert" }
];

type PageProps = {
  searchParams: Promise<{
    status?: string;
    assetId?: string;
    direction?: string;
    strategyVersionId?: string;
    offset?: string;
  }>;
};

export default async function TradeCandidatesPage({ searchParams }: PageProps) {
  if (!TRADING_DASHBOARD_ENABLED) {
    return <TradingDisabled />;
  }

  const params = await searchParams;
  const offset = Math.max(0, Number(params.offset) || 0);
  const result = await fetchTradeCandidates({
    status: params.status || undefined,
    assetId: params.assetId || undefined,
    direction: params.direction || undefined,
    strategyVersionId: params.strategyVersionId || undefined,
    limit: LIMIT,
    offset
  });

  const candidates = result.data ?? [];
  const hasFilter = Boolean(
    params.status ||
    params.assetId ||
    params.direction ||
    params.strategyVersionId
  );

  return (
    <>
      <PageHeader
        eyebrow="Shadow Trading"
        title="Trade Candidates"
        subtitle="Status, Entry/Stop/TP, CRV und Ablehnungsgründe je Kandidat"
      />

      {result.error ? (
        <ErrorState
          title="Kandidaten konnten nicht geladen werden"
          message={result.error}
        />
      ) : null}

      <form className="filter-bar" method="GET">
        <select name="status" defaultValue={params.status ?? ""}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          name="assetId"
          placeholder="Asset-ID"
          defaultValue={params.assetId ?? ""}
        />
        <select name="direction" defaultValue={params.direction ?? ""}>
          <option value="">Long &amp; Short</option>
          <option value="LONG">Nur Long</option>
          <option value="SHORT">Nur Short</option>
        </select>
        <input
          name="strategyVersionId"
          placeholder="StrategyVersion-ID"
          defaultValue={params.strategyVersionId ?? ""}
        />
        <button type="submit">Filtern</button>
        {hasFilter ? (
          <a
            href="/dashboard/trading/candidates"
            className="section-link"
            style={{ alignSelf: "center" }}
          >
            Zurücksetzen
          </a>
        ) : null}
      </form>

      <SectionCard
        title="Kandidaten"
        subtitle={`${candidates.length} Einträge auf dieser Seite`}
      >
        {candidates.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Richtung</th>
                    <th>Strategie</th>
                    <th>Status</th>
                    <th>Entry (Referenz)</th>
                    <th>Stop</th>
                    <th>Take Profit</th>
                    <th>Geplantes CRV</th>
                    <th>Ablehnungsgrund</th>
                    <th>Datenstand</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.id}>
                      <td data-label="Symbol">
                        <Link
                          href={`/dashboard/trading/candidates/${candidate.id}`}
                        >
                          {candidate.symbol ?? candidate.assetId}
                        </Link>
                      </td>
                      <td data-label="Richtung">
                        <DirectionBadge value={candidate.direction} />
                      </td>
                      <td data-label="Strategie" className="muted small">
                        {candidate.strategyKey ?? "—"}
                        {candidate.strategyVersion === null
                          ? ""
                          : ` v${candidate.strategyVersion}`}
                      </td>
                      <td data-label="Status">
                        <CandidateStatusBadge
                          value={candidate.status as TradeCandidateStatus}
                        />
                      </td>
                      <td data-label="Entry">
                        {formatDecimalAmount(candidate.referenceEntryPrice)}
                      </td>
                      <td data-label="Stop">
                        {formatDecimalAmount(candidate.stopPrice)}
                      </td>
                      <td data-label="Take Profit">
                        {formatDecimalAmount(candidate.takeProfitPrice)}
                      </td>
                      <td data-label="CRV">
                        {formatDecimalAmount(candidate.plannedRewardRisk)}
                      </td>
                      <td data-label="Ablehnungsgrund" className="muted small">
                        {candidate.invalidReasonCode ??
                          candidate.cancelReasonCode ??
                          "—"}
                      </td>
                      <td data-label="Datenstand" className="nowrap">
                        {formatUtcDateTime(candidate.dataAsOf)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TradingPagination
              basePath="/dashboard/trading/candidates"
              searchParams={params}
              offset={offset}
              limit={LIMIT}
              count={candidates.length}
            />
          </>
        ) : (
          <EmptyState title="Keine Kandidaten gefunden." />
        )}
      </SectionCard>
    </>
  );
}

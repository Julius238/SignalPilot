import Link from "next/link";

import { AlignmentBadge, DirectionBadge, RiskBadge, ScoreBadge, StatusBadge } from "./badges";
import { EmptyState } from "./empty-state";
import { formatDateTime } from "../lib/format";
import type { MultiTimeframeSummary, ScannerGroupKey, SignalListItem } from "../lib/signalpilot-api";

const groupTitles: Record<ScannerGroupKey, string> = {
  strongWatch: "Hohe Relevanz",
  watchlist: "Beobachten",
  volumeSpikes: "Ungewöhnliche Aktivität",
  breakouts: "Kurszonen im Fokus",
  highRisk: "Hohes Risiko",
  noEdge: "Geringe Relevanz"
};

const groupDescriptions: Record<ScannerGroupKey, string> = {
  strongWatch: "Die derzeit deutlichsten Beobachtungen, nach Qualität sortiert.",
  watchlist: "Prüfenswerte Entwicklungen, die weiter beobachtet werden sollten.",
  volumeSpikes: "Deutlich mehr Marktaktivität als zuletzt üblich.",
  breakouts: "Assets nahe wichtigen Bereichen ihrer jüngsten Kursspanne.",
  highRisk: "Beobachtungen mit erhöhter Unsicherheit und zusätzlichem Prüfbedarf.",
  noEdge: "Signale ohne klaren Informationsvorteil — bewusst nachrangig."
};

export function ScannerGroups({
  groups,
  multiTimeframeSummaries
}: {
  groups: Record<ScannerGroupKey, SignalListItem[]>;
  multiTimeframeSummaries?: Record<string, MultiTimeframeSummary>;
}) {
  const orderedGroups: ScannerGroupKey[] = [
    "strongWatch",
    "watchlist",
    "volumeSpikes",
    "breakouts",
    "highRisk",
    "noEdge"
  ];

  return (
    <section className="scanner-grid">
      {orderedGroups.map((key) => (
        <ScannerGroup
          key={key}
          groupKey={key}
          multiTimeframeSummaries={multiTimeframeSummaries ?? {}}
          signals={groups[key] ?? []}
        />
      ))}
    </section>
  );
}

function ScannerGroup({
  groupKey,
  multiTimeframeSummaries,
  signals
}: {
  groupKey: ScannerGroupKey;
  multiTimeframeSummaries: Record<string, MultiTimeframeSummary>;
  signals: SignalListItem[];
}) {
  const sortedSignals = [...signals].sort((left, right) => {
    const leftSummary = multiTimeframeSummaries[left.symbol];
    const rightSummary = multiTimeframeSummaries[right.symbol];
    const alignmentDiff = alignmentRank(leftSummary) - alignmentRank(rightSummary);
    return alignmentDiff === 0 ? right.score - left.score : alignmentDiff;
  });

  return (
    <div className={`card scanner-card scanner-card-${groupKey}`}>
      <div className="scanner-card-header">
        <div>
          <h2>{groupTitles[groupKey]}</h2>
          <p>{groupDescriptions[groupKey]}</p>
        </div>
        <span className="scanner-count">{sortedSignals.length}</span>
      </div>

      {sortedSignals.length === 0 ? (
        <EmptyState title="Keine passenden Signale gefunden." tone="calm" />
      ) : (
        <div className="scanner-list">
          {sortedSignals.map((signal) => (
            <SignalScannerRow
              key={signal.id}
              multiTimeframeSummary={multiTimeframeSummaries[signal.symbol]}
              signal={signal}
              subdued={groupKey === "noEdge"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SignalScannerRow({
  signal,
  subdued,
  multiTimeframeSummary
}: {
  signal: SignalListItem;
  subdued: boolean;
  multiTimeframeSummary?: MultiTimeframeSummary;
}) {
  const originalScore = getOriginalScore(signal.signalOutput?.dashboardJson);
  const isHighRisk = signal.status === "AVOID" || signal.riskLevel === "HIGH";

  return (
    <article className={`scanner-row ${subdued ? "scanner-row-subdued" : ""}`}>
      <div className="scanner-row-main">
        <div className="scanner-symbol-block">
          <Link className="scanner-symbol" href={`/dashboard/signals/${signal.id}`}>
            {signal.symbol}
          </Link>
          <Link
            className="scanner-asset-link"
            href={`/dashboard/assets/${encodeURIComponent(signal.symbol)}`}
          >
            {signal.asset.assetType} · {signal.timeframe}
          </Link>
          <span className="scanner-asset-link">{signal.signalType}</span>
        </div>
        <ScoreBadge
          value={signal.score}
          originalValue={originalScore ?? undefined}
          label={isHighRisk ? "⚠ Signalqualität" : "Signalqualität"}
        />
      </div>

      <div className="scanner-badges">
        {multiTimeframeSummary ? (
          <AlignmentBadge value={multiTimeframeSummary.alignment} />
        ) : null}
        <StatusBadge value={signal.status} />
        <DirectionBadge value={signal.direction} />
        <RiskBadge value={signal.riskLevel} />
      </div>

      {signal.signalOutput?.shortConclusion ? (
        <p className="scanner-conclusion">{signal.signalOutput.shortConclusion}</p>
      ) : null}

      {signal.signalOutput?.counterArgument ? (
        <p className="scanner-conclusion muted small">
          Gegenargument: {signal.signalOutput.counterArgument}
        </p>
      ) : null}

      {signal.signalOutput?.nextTrigger ? (
        <p className="scanner-trigger">
          Nächster Auslöser: {signal.signalOutput.nextTrigger}
        </p>
      ) : null}

      <div className="scanner-meta">
        <span>{formatDateTime(signal.createdAt)}</span>
        <Link href={`/dashboard/signals/${signal.id}`}>Signal öffnen →</Link>
      </div>
    </article>
  );
}

function alignmentRank(summary: MultiTimeframeSummary | undefined) {
  switch (summary?.alignment) {
    case "BULLISH_ALIGNED":
      return 0;
    case "BEARISH_ALIGNED":
      return 1;
    case "HIGHER_TIMEFRAME_CONFIRMATION":
      return 2;
    case "SHORT_TERM_ONLY":
      return 3;
    case "CONFLICT":
      return 4;
    case "MIXED":
      return 5;
    case "NO_EDGE":
      return 6;
    default:
      return 7;
  }
}

function getOriginalScore(dashboardJson: unknown): number | null {
  if (
    !dashboardJson ||
    typeof dashboardJson !== "object" ||
    !("originalScore" in dashboardJson)
  ) {
    return null;
  }
  const value = (dashboardJson as { originalScore?: unknown }).originalScore;
  return typeof value === "number" ? value : null;
}

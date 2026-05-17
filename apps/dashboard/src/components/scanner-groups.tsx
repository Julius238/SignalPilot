import Link from "next/link";

import { AlignmentBadge, DirectionBadge, RiskBadge, StatusBadge } from "./badges";
import { EmptyState } from "./empty-state";
import { formatDateTime, formatScore } from "../lib/format";
import type { MultiTimeframeSummary, ScannerGroupKey, SignalListItem } from "../lib/signalpilot-api";

const groupTitles: Record<ScannerGroupKey, string> = {
  strongWatch: "Strong Watch",
  watchlist: "Watchlist",
  volumeSpikes: "Volume Spikes",
  breakouts: "Breakouts",
  highRisk: "High Risk / Avoid",
  noEdge: "No Edge / Low Priority"
};

const groupDescriptions: Record<ScannerGroupKey, string> = {
  strongWatch: "Highest conviction signals sorted by score.",
  watchlist: "Constructive setups worth monitoring.",
  volumeSpikes: "Fresh activity shifts by signal timestamp.",
  breakouts: "Breakout alerts sorted by signal strength.",
  highRisk: "Avoid or high-risk signals sorted by risk score.",
  noEdge: "Signals without a current edge."
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
    const alignmentDifference = alignmentRank(leftSummary) - alignmentRank(rightSummary);
    return alignmentDifference === 0 ? right.score - left.score : alignmentDifference;
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
        <EmptyState title="Keine passenden Signals gefunden." />
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
        </div>
        <div className={`scanner-score ${isHighRisk ? "scanner-score-risk" : ""}`}>
          <span>Score</span>
          <strong>{formatScore(signal.score)}</strong>
        </div>
      </div>

      <div className="scanner-badges">
        {multiTimeframeSummary ? <AlignmentBadge value={multiTimeframeSummary.alignment} /> : null}
        <StatusBadge value={signal.status} />
        <DirectionBadge value={signal.direction} />
        <RiskBadge value={signal.riskLevel} />
        <span className="badge signal-type-badge">{signal.signalType}</span>
      </div>

      <p className="scanner-conclusion">{signal.signalOutput?.shortConclusion ?? "-"}</p>
      <p className="scanner-trigger">{signal.signalOutput?.nextTrigger ?? "-"}</p>

      <div className="scanner-meta">
        <span>{formatDateTime(signal.createdAt)}</span>
        <Link href={`/dashboard/signals/${signal.id}`}>Signal öffnen</Link>
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

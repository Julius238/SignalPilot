import Link from "next/link";

import { DirectionBadge, RiskBadge, StatusBadge } from "./badges";
import { EmptyState } from "./empty-state";
import { formatDateTime, formatScore } from "../lib/format";
import type { SignalListItem } from "../lib/signalpilot-api";
import { signalTypeLabel } from "../lib/labels";

export function SignalsTable({ signals }: { signals: SignalListItem[] }) {
  if (signals.length === 0) {
    return <EmptyState title="Keine Signals gefunden." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Created</th>
            <th>Symbol</th>
            <th>Asset</th>
            <th>TF</th>
            <th>Type</th>
            <th>Status</th>
            <th>Direction</th>
            <th>Score</th>
            <th>Risk</th>
            <th>Conclusion</th>
            <th>Next Trigger</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((signal) => (
            <tr key={signal.id}>
              <td>{formatDateTime(signal.createdAt)}</td>
              <td>
                <Link href={`/dashboard/signals/${signal.id}`}>{signal.symbol}</Link>
              </td>
              <td>{signal.asset.assetType}</td>
              <td>{signal.timeframe}</td>
              <td>{signalTypeLabel(signal.signalType)}</td>
              <td>
                <StatusBadge value={signal.status} />
              </td>
              <td>
                <DirectionBadge value={signal.direction} />
              </td>
              <td>{formatScore(signal.score)}</td>
              <td>
                <RiskBadge value={signal.riskLevel} />
              </td>
              <td className="wide-cell">{signal.signalOutput?.shortConclusion ?? "-"}</td>
              <td className="wide-cell">{signal.signalOutput?.nextTrigger ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

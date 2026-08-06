import { EmptyState } from "./empty-state";
import { formatDateTime } from "../lib/format";
import type { AlertState } from "../lib/signalpilot-api";
import { signalTypeLabel } from "../lib/labels";

export function AlertStatesTable({ alertStates }: { alertStates: AlertState[] }) {
  if (alertStates.length === 0) {
    return <EmptyState title="Keine Alert States gefunden." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>TF</th>
            <th>Signal</th>
            <th>Status</th>
            <th>Score</th>
            <th>Risk</th>
            <th>Alignment</th>
            <th>Last Sent</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          {alertStates.map((state) => (
            <tr key={state.id}>
              <td>{state.symbol}</td>
              <td>{state.timeframe}</td>
              <td>{signalTypeLabel(state.signalType)}</td>
              <td>{state.status}</td>
              <td>{state.lastScore.toFixed(1)}</td>
              <td>{state.lastRiskLevel}</td>
              <td>
                {state.lastAlignment ?? "-"}
                {state.lastAlignmentScore === null
                  ? ""
                  : ` (${state.lastAlignmentScore.toFixed(1)})`}
              </td>
              <td>{formatDateTime(state.lastSentAt)}</td>
              <td>{state.sendCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

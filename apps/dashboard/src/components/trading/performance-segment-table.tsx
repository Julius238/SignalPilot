import { EmptyState } from "../empty-state";
import { SectionCard } from "../ui";
import {
  decimalTone,
  formatDecimalAmount,
  formatSignedDecimal,
  toneColor
} from "../../lib/trading-format";
import type { PerformanceSegment } from "../../lib/trading-api";

// Ein null-Wert der Engine wird als "—" mit Begründung im title-Attribut
// dargestellt, niemals als 0. Der Unterschied zwischen "null Gewinn" und
// "nicht berechenbar" ist bei einer Handelsauswertung der wichtigste
// Unterschied überhaupt.
function NullableCell({
  value,
  reasonKey,
  segment,
  signed = false,
  suffix = ""
}: {
  value: string | null;
  reasonKey: string;
  segment: PerformanceSegment;
  signed?: boolean;
  suffix?: string;
}) {
  if (value === null) {
    const reason = segment.nullReasons[reasonKey];
    return (
      <span className="muted" title={reason ? `Nicht berechenbar: ${reason}` : "Nicht berechenbar"}>
        —{reason ? ` (${reason})` : ""}
      </span>
    );
  }

  const text = signed ? formatSignedDecimal(value) : formatDecimalAmount(value);
  if (!signed) return <>{`${text}${suffix}`}</>;
  return <span style={{ color: toneColor(decimalTone(value)) }}>{`${text}${suffix}`}</span>;
}

export function PerformanceSegmentTable({
  title,
  subtitle,
  segments,
  keyHeader,
  emptyLabel
}: {
  title: string;
  subtitle?: string;
  segments: PerformanceSegment[];
  keyHeader: string;
  emptyLabel: string;
}) {
  return (
    <SectionCard title={title} subtitle={subtitle}>
      {segments.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{keyHeader}</th>
                <th>Trades</th>
                <th>Gewinne</th>
                <th>Verluste</th>
                <th>Trefferquote</th>
                <th>Netto-P&amp;L</th>
                <th>Brutto-P&amp;L</th>
                <th>Gebühren</th>
                <th>Ausführungskosten</th>
                <th>Profit-Faktor</th>
                <th>Expectancy</th>
                <th>Ø R</th>
                <th>Kumuliertes R</th>
                <th>Max. Drawdown</th>
                <th>Recovery-Faktor</th>
                <th>Ø Haltedauer (min)</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => (
                <tr key={segment.id}>
                  <td>{segment.segmentLabel}</td>
                  <td>{segment.closedTrades}</td>
                  <td>{segment.wins}</td>
                  <td>{segment.losses}</td>
                  <td>
                    <NullableCell value={segment.winRatePct} reasonKey="winRatePct" segment={segment} suffix=" %" />
                  </td>
                  <td>
                    <span style={{ color: toneColor(decimalTone(segment.netPnl)) }}>
                      {formatSignedDecimal(segment.netPnl)}
                    </span>
                  </td>
                  <td>{formatDecimalAmount(segment.grossPnl)}</td>
                  <td>{formatDecimalAmount(segment.fees)}</td>
                  <td>{formatDecimalAmount(segment.simulatedExecutionCost)}</td>
                  <td>{formatDecimalAmount(segment.profitFactor)}</td>
                  <td>{formatDecimalAmount(segment.expectancy)}</td>
                  <td>{formatDecimalAmount(segment.averageR)}</td>
                  <td>
                    <NullableCell value={segment.cumulativeR} reasonKey="cumulativeR" segment={segment} />
                  </td>
                  <td>
                    <NullableCell
                      value={segment.maxDrawdownAmount}
                      reasonKey="maxDrawdownAmount"
                      segment={segment}
                    />
                  </td>
                  <td>
                    <NullableCell value={segment.recoveryFactor} reasonKey="recoveryFactor" segment={segment} />
                  </td>
                  <td>{formatDecimalAmount(segment.averageHoldMinutes, { maximumFractionDigits: 0 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={emptyLabel} />
      )}
    </SectionCard>
  );
}

/**
 * Kennzahlen, die nur für die Gesamtauswertung definiert sind (Sharpe,
 * Sortino, Risk-Rejection-Quote) plus Gebühren- und Kostenübersicht.
 */
export function PerformanceOverallCard({ segment }: { segment: PerformanceSegment }) {
  return (
    <SectionCard
      title="Gesamtauswertung"
      subtitle={`${segment.closedTrades} abgeschlossene Shadow-Trades im Fenster`}
    >
      <div className="table-wrap">
        <table>
          <tbody>
            <tr>
              <th>Netto-P&amp;L</th>
              <td>
                <span style={{ color: toneColor(decimalTone(segment.netPnl)) }}>
                  {formatSignedDecimal(segment.netPnl)}
                </span>
              </td>
              <th>Brutto-P&amp;L</th>
              <td>{formatDecimalAmount(segment.grossPnl)}</td>
            </tr>
            <tr>
              <th>Gebühren</th>
              <td>{formatDecimalAmount(segment.fees)}</td>
              <th>Simulierte Ausführungskosten</th>
              <td>{formatDecimalAmount(segment.simulatedExecutionCost)}</td>
            </tr>
            <tr>
              <th>Bruttogewinn</th>
              <td>{formatDecimalAmount(segment.grossProfit)}</td>
              <th>Bruttoverlust</th>
              <td>{formatDecimalAmount(segment.grossLoss)}</td>
            </tr>
            <tr>
              <th>Ø Gewinn</th>
              <td>
                <NullableCell value={segment.averageWin} reasonKey="averageWin" segment={segment} />
              </td>
              <th>Ø Verlust</th>
              <td>
                <NullableCell value={segment.averageLoss} reasonKey="averageLoss" segment={segment} />
              </td>
            </tr>
            <tr>
              <th>Max. Gewinnserie</th>
              <td>{segment.maxWinStreak}</td>
              <th>Max. Verlustserie</th>
              <td>{segment.maxLossStreak}</td>
            </tr>
            <tr>
              <th>Max. Drawdown</th>
              <td>
                <NullableCell value={segment.maxDrawdownAmount} reasonKey="maxDrawdownAmount" segment={segment} />
              </td>
              <th>Max. Drawdown %</th>
              <td>{formatDecimalAmount(segment.maxDrawdownPct)} %</td>
            </tr>
            <tr>
              <th>Exposure (min)</th>
              <td>{formatDecimalAmount(segment.exposureMinutes, { maximumFractionDigits: 0 })}</td>
              <th>Exposure-Anteil</th>
              <td>
                <NullableCell value={segment.exposurePct} reasonKey="exposurePct" segment={segment} suffix=" %" />
              </td>
            </tr>
            <tr>
              <th>Ø MAE</th>
              <td>
                <NullableCell value={segment.averageMaePct} reasonKey="averageMaePct" segment={segment} suffix=" %" />
              </td>
              <th>Ø MFE</th>
              <td>
                <NullableCell value={segment.averageMfePct} reasonKey="averageMfePct" segment={segment} suffix=" %" />
              </td>
            </tr>
            <tr>
              <th>Sharpe</th>
              <td>
                <NullableCell value={segment.sharpeRatio} reasonKey="sharpeRatio" segment={segment} />
              </td>
              <th>Sortino</th>
              <td>
                <NullableCell value={segment.sortinoRatio} reasonKey="sortinoRatio" segment={segment} />
              </td>
            </tr>
            <tr>
              <th>Bewertete Candidates</th>
              <td>{segment.assessedCandidates}</td>
              <th>Risk-Ablehnungen</th>
              <td>
                {segment.riskRejectedCandidates}{" "}
                <NullableCell
                  value={segment.riskRejectionRatePct}
                  reasonKey="riskRejectionRatePct"
                  segment={segment}
                  suffix=" %"
                />
              </td>
            </tr>
            <tr>
              <th>Ungültige Candidates</th>
              <td>{segment.invalidCandidates}</td>
              <th>Abgelaufene Candidates</th>
              <td>{segment.expiredCandidates}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

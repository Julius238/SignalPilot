import type { ReactNode } from "react";

import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { PageHeader, PageIntro, SectionCard } from "../../../../components/ui";
import { TradingDisabled } from "../../../../components/trading/trading-disabled";
import {
  fetchForwardComparison,
  type ForwardComparison,
  type ForwardComparisonEntry,
  type ForwardMetric
} from "../../../../lib/trading-api";
import { TRADING_DASHBOARD_ENABLED } from "../../../../lib/trading-flag";
import {
  decimalTone,
  formatDecimalAmount,
  formatPercentValue,
  formatSignedDecimal,
  formatUtcDateTime,
  toneColor
} from "../../../../lib/trading-format";

// Vorab festgelegt (docs/trading/research/2026-10-14-challenger-regime-long-v1.md):
// verglichen wird frühestens nach 30 geschlossenen Trades je Strategie oder 6 Monaten.
const MIN_TRADES_FOR_VERDICT = 30;
const MIN_DAYS_FOR_VERDICT = 182;
const DAY_MS = 24 * 60 * 60 * 1000;

const ROLE_LABEL: Record<ForwardComparisonEntry["role"], string> = {
  CHAMPION: "Champion",
  CHALLENGER: "Challenger"
};

const NULL_REASON_LABEL: Record<string, string> = {
  NOT_STARTED: "Forward-Test nicht gestartet",
  NO_CLOSED_TRADES: "noch kein geschlossener Trade",
  NO_WINNING_TRADES: "noch kein Gewinn",
  NO_LOSING_TRADES: "noch kein Verlust",
  NO_GROSS_LOSS: "noch kein Verlust (nicht definiert)",
  NO_PLANNED_RISK: "kein geplantes Risiko gespeichert",
  NO_DRAWDOWN: "kein Drawdown",
  NO_EQUITY_BASE: "keine Equity-Basis",
  EMPTY_WINDOW: "Zeitraum leer"
};

function metricText(metric: ForwardMetric, format: (value: string) => string): ReactNode {
  if (metric.value !== null) return format(metric.value);
  return (
    <span className="muted small">
      — {metric.reason ? (NULL_REASON_LABEL[metric.reason] ?? metric.reason) : ""}
    </span>
  );
}

const plainPercent = (value: string | null | undefined) =>
  value === null || value === undefined ? "—" : `${formatDecimalAmount(value)} %`;

function sessionBadge(entry: ForwardComparisonEntry) {
  if (entry.sessionStatus === null) return <span className="badge trading-neutral">keine Session</span>;
  const tone =
    entry.sessionStatus === "SHADOW_ACTIVE" && entry.killSwitchEngaged === false
      ? "trading-good"
      : entry.sessionStatus === "ERROR_LOCKED" || entry.sessionStatus === "KILLED"
        ? "trading-bad"
        : "trading-warn";
  return (
    <span className={`badge ${tone}`}>
      {entry.sessionStatus}
      {entry.killSwitchEngaged ? " · Kill Switch" : ""}
    </span>
  );
}

function forwardProgress(entry: ForwardComparisonEntry, asOf: string): string {
  if (entry.forwardStartAt === null) return "nicht gestartet";
  const days = Math.max(0, (new Date(asOf).getTime() - new Date(entry.forwardStartAt).getTime()) / DAY_MS);
  return `${entry.closedTrades}/${MIN_TRADES_FOR_VERDICT} Trades · ${days.toFixed(1)}/${MIN_DAYS_FOR_VERDICT} Tage`;
}

type Row = { label: string; hint?: string; cell: (entry: ForwardComparisonEntry) => ReactNode };

function forwardRows(asOf: string): Row[] {
  return [
    {
      label: "Strategie",
      cell: (entry) =>
        entry.strategies.length === 0 ? (
          <span className="muted">keine aktive Zuweisung</span>
        ) : (
          entry.strategies.map((strategy) => (
            <div key={strategy.strategyVersionId}>
              <strong>{strategy.strategyKey}</strong> v{strategy.version} · {strategy.symbol}
              <div className="muted small">
                {strategy.engineVersion} · Hash {strategy.specificationHash.slice(0, 12)}…
              </div>
            </div>
          ))
        )
    },
    {
      label: "Portfolio / Session",
      cell: (entry) => (
        <>
          <code>{entry.portfolioKey}</code> {sessionBadge(entry)}
        </>
      )
    },
    { label: "Forward-Start", cell: (entry) => formatUtcDateTime(entry.forwardStartAt) },
    { label: "Fortschritt bis zum Vergleich", cell: (entry) => forwardProgress(entry, asOf) },
    {
      label: "Equity",
      cell: (entry) => (
        <>
          {formatDecimalAmount(entry.equity)} USDT
          <div className="muted small">Start {formatDecimalAmount(entry.startingCash)} USDT</div>
        </>
      )
    },
    {
      label: "Netto-PnL",
      hint: "Equity minus Startkapital, nach Gebühren, Spread und Slippage (inkl. offener Position).",
      cell: (entry) => (
        <span style={{ color: toneColor(decimalTone(entry.netPnl)) }}>
          {formatSignedDecimal(entry.netPnl)} USDT ({formatPercentValue(entry.netPnlPct)})
        </span>
      )
    },
    {
      label: "Trades (geschlossen)",
      cell: (entry) => `${entry.closedTrades} (${entry.wins} Gewinne / ${entry.losses} Verluste)`
    },
    { label: "Profit Factor", cell: (entry) => metricText(entry.profitFactor, (value) => formatDecimalAmount(value)) },
    { label: "Trefferquote", cell: (entry) => metricText(entry.winRatePct, plainPercent) },
    { label: "Ø R", cell: (entry) => metricText(entry.averageR, (value) => formatSignedDecimal(value)) },
    {
      label: "Max. Drawdown",
      hint: "Aus den täglichen Portfolio-Snapshots seit dem Forward-Start.",
      cell: (entry) => metricText(entry.maxDrawdownPct, plainPercent)
    },
    { label: "Zeit im Markt", cell: (entry) => metricText(entry.exposurePct, plainPercent) },
    {
      label: "Kosten",
      hint: "Gebühren plus simulierte Spread-/Slippage-Kosten der geschlossenen Trades.",
      cell: (entry) => (
        <>
          {formatDecimalAmount(String(Number(entry.fees) + Number(entry.simulatedExecutionCost)))} USDT
          <div className="muted small">
            Gebühren {formatDecimalAmount(entry.fees)} · Spread/Slippage {formatDecimalAmount(entry.simulatedExecutionCost)}
          </div>
        </>
      )
    },
    {
      label: "Offene Position",
      cell: (entry) =>
        entry.openPosition === null ? (
          <span className="muted">keine</span>
        ) : (
          <>
            {entry.openPosition.symbol} · {formatDecimalAmount(entry.openPosition.quantity, { maximumFractionDigits: 6 })} @{" "}
            {formatDecimalAmount(entry.openPosition.averageEntryPrice)}
            <div className="muted small">
              Stop {formatDecimalAmount(entry.openPosition.stopPrice)} · Ziel{" "}
              {formatDecimalAmount(entry.openPosition.takeProfitPrice)} · seit {formatUtcDateTime(entry.openPosition.openedAt)}
            </div>
          </>
        )
    },
    {
      label: "Letzter Trade",
      cell: (entry) =>
        entry.lastTrade === null ? (
          <span className="muted">noch keiner</span>
        ) : (
          <>
            <span style={{ color: toneColor(decimalTone(entry.lastTrade.netPnl)) }}>
              {formatSignedDecimal(entry.lastTrade.netPnl)} USDT
            </span>{" "}
            · {entry.lastTrade.status}
            <div className="muted small">
              {formatDecimalAmount(entry.lastTrade.averageEntryPrice)} → {formatDecimalAmount(entry.lastTrade.averageExitPrice)} ·
              geschlossen {formatUtcDateTime(entry.lastTrade.closedAt)}
            </div>
          </>
        )
    },
    {
      label: "Letzte Bewertung",
      cell: (entry) =>
        entry.lastEvaluation === null ? (
          <span className="muted">noch keine</span>
        ) : (
          <>
            {entry.lastEvaluation.outcome === "CANDIDATE" ? "Kandidat" : "kein Kandidat"} ·{" "}
            <code>{entry.lastEvaluation.reasonCode}</code>
            <div className="muted small">{formatUtcDateTime(entry.lastEvaluation.occurredAt)}</div>
          </>
        )
    },
    {
      label: "Trades vor dem Start",
      hint: "Kontrollwert: geschlossene Trades des Portfolios vor dem Forward-Start. Sie zählen nie mit und sollten 0 sein.",
      cell: (entry) =>
        entry.tradesBeforeForwardStart === 0 ? (
          "0"
        ) : (
          <span className="badge trading-warn">{entry.tradesBeforeForwardStart}</span>
        )
    }
  ];
}

function introVerdict(data: ForwardComparison): { tone: "neutral" | "warn"; verdict: string; detail: string } {
  const started = data.forward.filter((entry) => entry.forwardStartAt !== null);
  if (started.length < data.forward.length) {
    return {
      tone: "warn",
      verdict: "Nicht beide Forward-Tests laufen",
      detail: `${started.length} von ${data.forward.length} Portfolios haben eine aktivierte Session.`
    };
  }
  const minTrades = Math.min(...data.forward.map((entry) => entry.closedTrades));
  return {
    tone: "neutral",
    verdict:
      minTrades >= MIN_TRADES_FOR_VERDICT
        ? "Genug Trades für einen ersten Vergleich"
        : "Beide Forward-Tests laufen — noch keine belastbare Aussage",
    detail: `Vergleich frühestens nach ${MIN_TRADES_FOR_VERDICT} geschlossenen Trades je Strategie oder ${MIN_DAYS_FOR_VERDICT} Tagen (vorab festgelegt).`
  };
}

export default async function ComparisonPage() {
  if (!TRADING_DASHBOARD_ENABLED) {
    return <TradingDisabled />;
  }

  const result = await fetchForwardComparison();
  const data = result.data;

  return (
    <>
      <PageHeader
        eyebrow="Shadow Trading"
        title="Champion vs. Challenger"
        subtitle="Zwei Strategien, zwei getrennte virtuelle Portfolios, dieselben Live-Daten, Kosten und Limits"
      />

      {result.error ? <ErrorState title="Vergleich konnte nicht geladen werden" message={result.error} /> : null}

      {data ? (
        <>
          <PageIntro
            purpose="Forward-Shadow-Ergebnisse auf unbekannten Live-Daten, je Portfolio ab seinem eigenen Startzeitpunkt — darunter getrennt der historische Replay."
            tone={introVerdict(data).tone}
            verdict={introVerdict(data).verdict}
            detail={introVerdict(data).detail}
          />

          <SectionCard
            title="Aktuelles Regime"
            subtitle="crypto-native-regime-v1 — das Regime, auf dem beide Strategien entscheiden"
          >
            {data.regime === null ? (
              <EmptyState title="Kein crypto-natives Regime gespeichert." />
            ) : (
              <p>
                <strong>{data.regime.cryptoRegime ?? "—"}</strong> · Risk Mode {data.regime.riskMode ?? "—"} · Konfidenz{" "}
                {data.regime.confidence ?? "—"}/100 ·{" "}
                <span className={`badge ${data.regime.regimeGateOpen ? "trading-good" : "trading-neutral"}`}>
                  Regime-Gate {data.regime.regimeGateOpen ? "offen" : "geschlossen"}
                </span>
                <span className="muted small"> · Stand {formatUtcDateTime(data.regime.generatedAt)}</span>
              </p>
            )}
          </SectionCard>

          <div style={{ marginTop: 16 }}>
            <SectionCard
              title="Forward-Test (Shadow, Live-Daten)"
              subtitle={`Nur Trades nach dem jeweiligen Forward-Start · Stand ${formatUtcDateTime(data.asOf)}`}
            >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th />
                      {data.forward.map((entry) => (
                        <th key={entry.portfolioKey}>{ROLE_LABEL[entry.role]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {forwardRows(data.asOf).map((row) => (
                      <tr key={row.label}>
                        <th scope="row" title={row.hint}>
                          {row.label}
                        </th>
                        {data.forward.map((entry) => (
                          <td key={entry.portfolioKey}>{row.cell(entry)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>

          <div style={{ marginTop: 16 }}>
            <SectionCard
              title="Historischer Replay (bekannte Kursdaten — kein Forward-Beleg)"
              subtitle="Dieselbe StrategyVersion über gespeicherte Binance-Historie. Diese Zahlen fließen nie in den Forward-Test ein."
            >
              <p className="muted small">
                Der Challenger wurde nach dem Research auf diesen Daten formuliert; auch sein Testzeitraum ist deshalb
                kein unabhängiger Beleg. Unabhängig ist nur der Forward-Test oben.
              </p>
              {data.replay.length === 0 ? (
                <EmptyState title="Kein gespeicherter Replay mit echten Daten (SPEC, REALISTIC) für diese Strategien." />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Strategie</th>
                        <th>Zeitraum</th>
                        <th>Trades</th>
                        <th>Netto-PnL</th>
                        <th>Rendite</th>
                        <th>Profit Factor</th>
                        <th>Trefferquote</th>
                        <th>Ø R</th>
                        <th>Max. Drawdown</th>
                        <th>Zeit im Markt</th>
                        <th>Kosten</th>
                        <th>Buy &amp; Hold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.replay.flatMap((run) =>
                        run.periods.map((period) => (
                          <tr key={`${run.runId}-${period.label}`}>
                            <td>
                              <strong>{run.strategyKey}</strong>
                              <div className="muted small">
                                {run.costProfile} · {run.regimePolicy} · {run.engineVersion}
                              </div>
                            </td>
                            <td className="nowrap">{period.label}</td>
                            <td>{period.closedTrades ?? "—"}</td>
                            <td style={{ color: toneColor(decimalTone(period.netPnl)) }}>
                              {formatSignedDecimal(period.netPnl)}
                            </td>
                            <td>{formatPercentValue(period.returnPct)}</td>
                            <td>{formatDecimalAmount(period.profitFactor)}</td>
                            <td>{plainPercent(period.winRatePct)}</td>
                            <td>{formatSignedDecimal(period.averageR)}</td>
                            <td>{plainPercent(period.maxDrawdownPct)}</td>
                            <td>{plainPercent(period.exposurePct)}</td>
                            <td>{formatDecimalAmount(period.totalExecutionCost)}</td>
                            <td>{formatPercentValue(period.buyAndHoldReturnPct)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>
        </>
      ) : null}
    </>
  );
}

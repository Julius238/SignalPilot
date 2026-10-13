import Link from "next/link";

import { DebugJsonBlock } from "../../../../components/debug-json-block";
import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { TradingLineChart } from "../../../../components/trading/trading-line-chart";
import { MetricCard, PageHeader, PageIntro, SectionCard } from "../../../../components/ui";
import { formatDateTime } from "../../../../lib/format";
import {
  EXIT_REASON_LABELS,
  REPLAY_COST_LABELS,
  REPLAY_MODE_LABELS,
  formatAmount,
  formatPct,
  formatRatio,
  formatSignedPct,
  type ForwardReturnStats,
  type ReplayPeriodMetrics,
  type ReplayRunDetail
} from "../../../../lib/replay-api";
import { fetchApi } from "../../../../lib/signalpilot-api";

type ReplayDetailPageProps = {
  params: Promise<{ id: string }>;
};

const TRADE_LIMIT = 200;

function topEntries(record: Record<string, number> | undefined, limit: number): [string, number][] {
  return Object.entries(record ?? {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);
}

function PeriodRow({ period }: { period: ReplayPeriodMetrics | null }) {
  if (period === null) return null;
  return (
    <tr>
      <td data-label="Zeitraum">
        <strong>{period.label}</strong>
        <div className="muted small nowrap">
          {formatDateTime(period.from)} – {formatDateTime(period.to)}
        </div>
      </td>
      <td data-label="Trades">{period.closedTrades}</td>
      <td data-label="Trefferquote">{formatPct(period.winRatePct, 1)}</td>
      <td data-label="Profit Factor">{formatRatio(period.profitFactor)}</td>
      <td data-label="Ø R">{formatRatio(period.averageR)}</td>
      <td data-label="Rendite">{formatSignedPct(period.returnPct)}</td>
      <td data-label="Max. Drawdown">{formatPct(period.maxDrawdownPct)}</td>
      <td data-label="Netto-P&L">{formatAmount(period.netPnl)} USDT</td>
    </tr>
  );
}

export default async function ReplayDetailPage({ params }: ReplayDetailPageProps) {
  const { id } = await params;
  const result = await fetchApi<ReplayRunDetail>(`/replays/${encodeURIComponent(id)}`);

  if (result.error || result.data === null) {
    return (
      <>
        <PageHeader eyebrow="Research · Shadow-Replay" title="Replay-Lauf" />
        <ErrorState title="Replay-Lauf nicht abrufbar." message={result.error ?? "Unbekannter Fehler"} />
      </>
    );
  }

  const run = result.data;
  const overall = run.metricsJson.overall;
  const funnel = run.funnelJson;
  const trades = run.tradesJson.slice(-TRADE_LIMIT).reverse();
  const tradeCount = run.tradesJson.length;
  const equityPoints = run.equityCurveJson.map((point) => ({ time: point.at, value: point.equity }));

  const tone = run.isSynthetic ? "warn" : tradeCount === 0 ? "neutral" : tradeCount < 30 ? "warn" : Number(overall.returnPct ?? 0) > 0 ? "good" : "bad";
  const verdict = run.isSynthetic
    ? "Synthetische Testdaten — dieser Lauf prüft nur die Technik, nicht die Strategie."
    : tradeCount === 0
      ? `Kein einziger Trade in ${run.cycles.toLocaleString("de-DE")} Stunden — die Einstiegs- oder Risikoregeln lassen nichts durch.`
      : tradeCount < 30
        ? `${tradeCount} Trades: Ergebnis ${formatSignedPct(overall.returnPct)}, statistisch noch nicht belastbar.`
        : `${tradeCount} Trades, Rendite ${formatSignedPct(overall.returnPct)}, Profit Factor ${formatRatio(overall.profitFactor)}.`;

  return (
    <>
      <PageHeader
        eyebrow="Research · Shadow-Replay"
        title={run.label}
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/replays">
            Alle Läufe
          </Link>
        }
      />

      <PageIntro
        purpose={`${REPLAY_MODE_LABELS[run.mode] ?? run.mode} · ${REPLAY_COST_LABELS[run.costProfile] ?? run.costProfile} · Regime ${run.regimePolicy} · Daten ${run.dataOrigin}`}
        tone={tone}
        verdict={verdict}
        nextStep={
          funnel.candidates === 0
            ? "Unten stehen die Bedingungen, an denen die Strategie am häufigsten scheitert."
            : funnel.riskApproved === 0
              ? "Die Strategie findet Kandidaten, aber die Risk-Engine lehnt alle ab — die Regel-Tabelle zeigt warum."
              : "Training- und Test-Zeitraum vergleichen: Nur ein Ergebnis, das im Testzeitraum hält, ist belastbar."
        }
      />

      <div className="grid metrics">
        <MetricCard label="Endkapital" value={`${formatAmount(run.finalEquity)} USDT`} sub={`Start ${formatAmount(run.startingCash)} USDT`} />
        <MetricCard label="Rendite" value={formatSignedPct(overall.returnPct)} tone={Number(overall.returnPct ?? 0) >= 0 ? "good" : "bad"} />
        <MetricCard label="Trades" value={tradeCount} sub={`${funnel.candidates} Kandidaten`} />
        <MetricCard label="Trefferquote" value={formatPct(overall.winRatePct, 1)} />
        <MetricCard label="Profit Factor" value={formatRatio(overall.profitFactor)} hint="Bruttogewinne geteilt durch Bruttoverluste; über 1 heißt profitabel." />
        <MetricCard label="Max. Drawdown" value={formatPct(overall.maxDrawdownPct)} hint="Größter Rückgang der stündlich bewerteten Equity vom bisherigen Höchststand." />
        <MetricCard label="Ø R je Trade" value={formatRatio(overall.averageR)} hint="Nettoergebnis je Trade in Vielfachen des geplanten Risikos." />
        <MetricCard label="Sharpe (annualisiert)" value={formatRatio(overall.sharpeRatio)} />
      </div>

      <SectionCard title="Training und Test" subtitle="Training = In-Sample-Zeitraum, Test = Out-of-Sample. Parameter dürfen nur auf dem Training angepasst werden.">
        <div className="table-wrap">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Zeitraum</th>
                <th>Trades</th>
                <th>Trefferquote</th>
                <th>Profit Factor</th>
                <th>Ø R</th>
                <th>Rendite</th>
                <th>Max. Drawdown</th>
                <th>Netto-P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              <PeriodRow period={run.metricsJson.overall} />
              <PeriodRow period={run.metricsJson.training} />
              <PeriodRow period={run.metricsJson.test} />
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid two">
        <TradingLineChart points={equityPoints} title="Equity-Kurve (täglich)" emptyLabel="Keine Equity-Punkte gespeichert." />
        <SectionCard title="Trichter" subtitle="Vom Stundenzyklus bis zum gefüllten Trade">
          <ul className="stack-list compact">
            <li className="list-row"><span>Stundenzyklen</span><strong>{funnel.cycles.toLocaleString("de-DE")}</strong></li>
            <li className="list-row"><span>Ungültige Eingaben</span><strong>{funnel.invalidInput}</strong></li>
            <li className="list-row"><span>Kein Kandidat</span><strong>{funnel.noCandidate.toLocaleString("de-DE")}</strong></li>
            <li className="list-row"><span>Kandidaten</span><strong>{funnel.candidates}</strong></li>
            <li className="list-row"><span>Risk freigegeben</span><strong>{funnel.riskApproved}</strong></li>
            <li className="list-row"><span>Risk abgelehnt</span><strong>{funnel.riskRejected}</strong></li>
            <li className="list-row"><span>Übersprungen (Position offen)</span><strong>{funnel.skippedOpenExposure}</strong></li>
            <li className="list-row"><span>Order verfallen</span><strong>{funnel.ordersExpired}</strong></li>
            <li className="list-row"><span>Einstiege gefüllt</span><strong>{funnel.entriesFilled}</strong></li>
          </ul>
        </SectionCard>
      </div>

      <div className="grid two">
        <SectionCard title="Woran die Strategie scheitert" subtitle="Jede nicht erfüllte Bedingung über alle Zyklen (eine Stunde kann mehrere zählen)">
          {topEntries(funnel.failedStrategyChecks ?? funnel.strategyReasons, 14).length === 0 ? (
            <EmptyState title="Keine Ablehnungen erfasst." />
          ) : (
            <ul className="stack-list compact">
              {topEntries(funnel.failedStrategyChecks ?? funnel.strategyReasons, 14).map(([code, count]) => (
                <li className="list-row" key={code}>
                  <span className="mono small">{code}</span>
                  <strong>{count.toLocaleString("de-DE")}</strong>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Risk-Regeln" subtitle="Nicht bestandene Regeln je Kandidat">
          {topEntries(funnel.failedRiskRules, 14).length === 0 ? (
            <EmptyState title={run.mode === "SIGNAL_EDGE" ? "In diesem Modus werden die Risk-Regeln nicht angewendet." : "Keine Regel hat einen Kandidaten abgelehnt."} />
          ) : (
            <ul className="stack-list compact">
              {topEntries(funnel.failedRiskRules, 14).map(([code, count]) => (
                <li className="list-row" key={code}>
                  <span className="mono small">{code}</span>
                  <strong>{count}</strong>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {run.metricsJson.nearMiss ? <NearMissSection nearMiss={run.metricsJson.nearMiss} /> : null}

      <SectionCard title={tradeCount > 0 ? `Simulierte Trades (${tradeCount}${tradeCount > TRADE_LIMIT ? `, neueste ${TRADE_LIMIT}` : ""})` : "Simulierte Trades"}>
        {trades.length === 0 ? (
          <EmptyState title="Keine Trades in diesem Lauf." />
        ) : (
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Zeitraum</th>
                  <th>Eröffnet</th>
                  <th>Geschlossen</th>
                  <th>Exit</th>
                  <th>Entry</th>
                  <th>Exit-Preis</th>
                  <th>Stop / TP</th>
                  <th>Netto-P&amp;L</th>
                  <th>R</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.positionId}>
                    <td data-label="Signal" className="nowrap">{formatDateTime(trade.anchorAt)}</td>
                    <td data-label="Zeitraum">{trade.period === "TEST" ? "Test" : "Training"}</td>
                    <td data-label="Eröffnet" className="nowrap">{formatDateTime(trade.openedAt)}</td>
                    <td data-label="Geschlossen" className="nowrap">{formatDateTime(trade.closedAt)}</td>
                    <td data-label="Exit">{EXIT_REASON_LABELS[trade.exitReason] ?? trade.exitReason}</td>
                    <td data-label="Entry">{formatAmount(trade.entryPrice)}</td>
                    <td data-label="Exit-Preis">{formatAmount(trade.exitPrice)}</td>
                    <td data-label="Stop / TP" className="nowrap">
                      {formatAmount(trade.stopPrice)} / {formatAmount(trade.takeProfitPrice)}
                    </td>
                    <td data-label="Netto-P&L" style={{ color: Number(trade.netPnl) >= 0 ? "var(--good)" : "var(--bad)" }}>
                      {formatAmount(trade.netPnl)}
                    </td>
                    <td data-label="R">{formatRatio(trade.rMultiple)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Hinweise zur Methodik">
        <ul className="stack-list compact">
          {run.notesJson.map((note) => (
            <li className="list-row" key={note}>
              <span>{note}</span>
            </li>
          ))}
        </ul>
        <DebugJsonBlock label="Konfiguration" data={{ ...run.configJson, engineVersion: run.engineVersion, codeVersion: run.codeVersion, outputHash: run.outputHash, durationMs: run.durationMs }} />
      </SectionCard>
    </>
  );
}

function ForwardRow({ label, stats, emphasis }: { label: string; stats: ForwardReturnStats; emphasis?: boolean }) {
  return (
    <tr>
      <td data-label="Gruppe">{emphasis ? <strong>{label}</strong> : <span className="mono small">{label}</span>}</td>
      <td data-label="Stunden">{stats.samples.toLocaleString("de-DE")}</td>
      <td data-label="Ø 24 h">{formatSignedPct(stats.avgReturn24hPct, 3)}</td>
      <td data-label="Ø 72 h">{formatSignedPct(stats.avgReturn72hPct, 3)}</td>
      <td data-label="Positiv 24 h">{formatPct(stats.positive24hPct, 1)}</td>
      <td data-label="Positiv 72 h">{formatPct(stats.positive72hPct, 1)}</td>
    </tr>
  );
}

function NearMissSection({ nearMiss }: { nearMiss: NonNullable<ReplayRunDetail["metricsJson"]["nearMiss"]> }) {
  return (
    <SectionCard
      title="Beinahe-Treffer: Welche Regel blockiert — und was danach geschah"
      subtitle="Stunden, in denen genau eine Einstiegs- oder Preisplan-Bedingung fehlte. Kursentwicklung ab der nächsten Eröffnung, ohne Kosten — liegt eine Gruppe deutlich über der Basis, verhindert die Regel womöglich gute Setups."
    >
      <div className="table-wrap">
        <table className="responsive-table">
          <thead>
            <tr>
              <th>Gruppe</th>
              <th>Stunden</th>
              <th>Ø 24 h</th>
              <th>Ø 72 h</th>
              <th>Positiv 24 h</th>
              <th>Positiv 72 h</th>
            </tr>
          </thead>
          <tbody>
            <ForwardRow label="Basis: alle Stunden" stats={nearMiss.baseline} emphasis />
            <ForwardRow label="Echte Kandidaten" stats={nearMiss.candidates} emphasis />
            {nearMiss.blockers.slice(0, 15).map((group) => (
              <ForwardRow key={group.blocker} label={group.blocker} stats={group} />
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

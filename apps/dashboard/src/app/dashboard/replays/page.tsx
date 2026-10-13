import Link from "next/link";

import { EmptyState, ErrorState } from "../../../components/empty-state";
import { RetryButton } from "../../../components/retry-button";
import { PageHeader, PageIntro, SectionCard } from "../../../components/ui";
import { describeApiError } from "../../../lib/api-error";
import { formatDateTime } from "../../../lib/format";
import {
  REPLAY_COST_LABELS,
  REPLAY_MODE_LABELS,
  formatAmount,
  formatPct,
  formatRatio,
  formatSignedPct,
  type ReplayRunSummary
} from "../../../lib/replay-api";
import { fetchApi } from "../../../lib/signalpilot-api";

export default async function ReplaysPage() {
  const runs = await fetchApi<ReplayRunSummary[]>("/replays?limit=50");
  const list = runs.data ?? [];
  const errorCopy = describeApiError(runs.errorKind, runs.error ?? "", "Die Replay-Läufe");
  const real = list.filter((run) => !run.isSynthetic);

  const tone = runs.error ? "bad" : list.length === 0 ? "neutral" : real.length === 0 ? "warn" : "good";
  const verdict = runs.error
    ? "Replay-Läufe nicht abrufbar."
    : list.length === 0
      ? "Noch kein historisches Replay durchgeführt."
      : real.length === 0
        ? `${list.length} Läufe — alle auf synthetischen Testdaten, ohne Aussage über die echte Strategie.`
        : `${real.length} Läufe auf echten Marktdaten, ${list.length - real.length} auf Testdaten.`;

  return (
    <>
      <PageHeader eyebrow="Research" title="Shadow-Replay" />

      <PageIntro
        purpose="Das Replay spielt die Shadow-Trading-Kette Stunde für Stunde über historische Kerzen ab — mit denselben Strategie-, Risk-, Fill- und Portfolio-Engines wie der Live-Betrieb, ohne Blick in die Zukunft und rein simuliert."
        tone={tone}
        verdict={verdict}
        nextStep={
          list.length === 0
            ? "Replay per Kommandozeile starten: pnpm trading-worker:shadow-replay — Ergebnisse erscheinen anschließend hier."
            : "Einen Lauf öffnen: Kennzahlen, Training/Test-Aufteilung, Ablehnungsgründe und alle simulierten Trades."
        }
      />

      {runs.error ? (
        <ErrorState
          title={errorCopy.title}
          message={errorCopy.message}
          hint={errorCopy.hint}
          action={errorCopy.retryable ? <RetryButton /> : null}
        />
      ) : null}

      {list.length > 1 ? <VariantComparison runs={real.length > 0 ? real : list} synthetic={real.length === 0} /> : null}

      <SectionCard title={list.length > 0 ? `${list.length} Läufe` : undefined}>
        {list.length === 0 ? (
          <EmptyState
            title="Noch kein Replay vorhanden."
            description="Das Replay liest gespeicherte Kerzen nur lesend und schreibt ausschließlich seine Ergebnisse."
          />
        ) : (
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Lauf</th>
                  <th>Modus</th>
                  <th>Kosten</th>
                  <th>Zeitraum</th>
                  <th>Kandidaten</th>
                  <th>Trades</th>
                  <th>Rendite</th>
                  <th>Trefferquote</th>
                  <th>Profit Factor</th>
                  <th>Max. Drawdown</th>
                  <th>Endkapital</th>
                </tr>
              </thead>
              <tbody>
                {list.map((run) => {
                  const overall = run.metricsJson.overall;
                  return (
                    <tr key={run.id}>
                      <td data-label="Lauf">
                        <Link href={`/dashboard/replays/${encodeURIComponent(run.id)}`}>{run.symbol}</Link>
                        {run.isSynthetic ? <span className="badge trading-warn" style={{ marginLeft: 6 }}>Testdaten</span> : null}
                        <div className="muted small">{formatDateTime(run.createdAt)}</div>
                      </td>
                      <td data-label="Modus">{REPLAY_MODE_LABELS[run.mode] ?? run.mode}</td>
                      <td data-label="Kosten">{REPLAY_COST_LABELS[run.costProfile] ?? run.costProfile}</td>
                      <td data-label="Zeitraum" className="nowrap">
                        {formatDateTime(run.firstAnchorAt)} – {formatDateTime(run.lastAnchorAt)}
                        <div className="muted small">{run.cycles.toLocaleString("de-DE")} Stunden</div>
                      </td>
                      <td data-label="Kandidaten">{run.candidates}</td>
                      <td data-label="Trades">{run.closedTrades}</td>
                      <td data-label="Rendite">{formatSignedPct(overall.returnPct)}</td>
                      <td data-label="Trefferquote">{formatPct(overall.winRatePct, 1)}</td>
                      <td data-label="Profit Factor">{formatRatio(overall.profitFactor)}</td>
                      <td data-label="Max. Drawdown">{formatPct(overall.maxDrawdownPct)}</td>
                      <td data-label="Endkapital">{formatAmount(run.finalEquity)} USDT</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}

/**
 * Strategy variants and cost profiles side by side. Sorted by the TRAINING
 * result only: the test columns are the out-of-sample check, never the
 * selection criterion.
 */
function VariantComparison({ runs, synthetic }: { runs: readonly ReplayRunSummary[]; synthetic: boolean }) {
  const rows = runs
    .filter((run) => run.metricsJson.training && run.metricsJson.test)
    .sort(
      (left, right) =>
        Number(right.metricsJson.training?.returnPct ?? -Infinity) - Number(left.metricsJson.training?.returnPct ?? -Infinity)
    );
  if (rows.length === 0) return null;
  return (
    <SectionCard
      title="Varianten- und Kostenvergleich"
      subtitle={`Sortiert nach dem Trainingszeitraum; der Testzeitraum (Out-of-Sample) dient nur zur Kontrolle.${
        synthetic ? " Achtung: synthetische Testdaten." : ""
      }`}
    >
      <div className="table-wrap">
        <table className="responsive-table">
          <thead>
            <tr>
              <th>Lauf</th>
              <th>Training: Trades</th>
              <th>Training: Rendite</th>
              <th>Training: PF</th>
              <th>Test: Trades</th>
              <th>Test: Rendite</th>
              <th>Test: PF</th>
              <th>Test: Max. DD</th>
              <th>Test: Buy &amp; Hold</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((run) => {
              const training = run.metricsJson.training!;
              const test = run.metricsJson.test!;
              return (
                <tr key={run.id}>
                  <td data-label="Lauf">
                    <Link href={`/dashboard/replays/${encodeURIComponent(run.id)}`}>{run.label}</Link>
                  </td>
                  <td data-label="Training: Trades">{training.closedTrades}</td>
                  <td data-label="Training: Rendite">{formatSignedPct(training.returnPct)}</td>
                  <td data-label="Training: PF">{formatRatio(training.profitFactor)}</td>
                  <td data-label="Test: Trades">{test.closedTrades}</td>
                  <td data-label="Test: Rendite">{formatSignedPct(test.returnPct)}</td>
                  <td data-label="Test: PF">{formatRatio(test.profitFactor)}</td>
                  <td data-label="Test: Max. DD">{formatPct(test.maxDrawdownPct)}</td>
                  <td data-label="Test: Buy & Hold">{formatSignedPct(test.buyAndHoldReturnPct ?? null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

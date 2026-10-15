import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState, ErrorState } from "../../../../../components/empty-state";
import { MetricCard, PageHeader, PageIntro, SectionCard, TechnicalDetails } from "../../../../../components/ui";
import { TradingDisabled } from "../../../../../components/trading/trading-disabled";
import { fetchEvolutionCandidate, type EvolutionCandidateDetail, type EvolutionMetrics } from "../../../../../lib/evolution-api";
import { EVIDENCE_LABEL, FAMILY_LABEL, GATE_LABEL, GATES_VERSION_LABEL, PROVIDER_LABEL, WINDOW_LABEL, candidateStatus, fmt, fmtPct, fmtR, fmtSigned, toneOf } from "../../../../../lib/evolution-labels";
import { TRADING_DASHBOARD_ENABLED } from "../../../../../lib/trading-flag";
import { formatUtcDateTime, toneColor } from "../../../../../lib/trading-format";

type Detail = Extract<EvolutionCandidateDetail, { available: true }>;

const ROWS: [string, (m: EvolutionMetrics) => ReactNode][] = [
  ["Trades", (m) => m.trades],
  ["Trefferquote", (m) => fmtPct(m.winRatePct, 1)],
  ["Profit Factor", (m) => fmt(m.profitFactor)],
  ["Ø R je Trade", (m) => <span style={{ color: toneColor(toneOf(m.averageR)) }}>{fmtR(m.averageR)}</span>],
  ["Erwartungswert je Trade", (m) => `${fmtSigned(m.expectancy)} USDT`],
  ["Nettorendite", (m) => fmtPct(m.netReturnPct)],
  ["Rendite p. a.", (m) => fmtPct(m.annualizedReturnPct)],
  ["Max. Drawdown", (m) => fmtPct(m.maxDrawdownPct)],
  ["Sharpe", (m) => fmt(m.sharpe)],
  ["Sortino", (m) => fmt(m.sortino)],
  ["Calmar", (m) => fmt(m.calmar)],
  ["Marktexposition (Kapitalbindung)", (m) => fmtPct(m.exposurePct, 1)],
  ["Ø Haltedauer", (m) => (m.averageHoldHours === null ? "—" : `${fmt(m.averageHoldHours, 1)} h`)],
  ["Trades pro Jahr", (m) => fmt(m.tradesPerYear, 1)],
  ["Kosten / Bruttogewinn", (m) => fmtPct(m.costShareOfGrossProfitPct, 1)],
  ["Ø R bei 2× Kosten", (m) => fmtR(m.stressedAverageR)],
  ["t-Wert Ø R", (m) => fmt(m.tStatR)],
  ["Buy & Hold", (m) => fmtPct(m.buyAndHoldReturnPct)],
  ["Buy & Hold Drawdown", (m) => fmtPct(m.buyAndHoldMaxDrawdownPct)]
];

function MetricsTable({ columns }: { columns: { label: string; note?: string; metrics: EvolutionMetrics | null }[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Kennzahl</th>
            {columns.map((column) => (
              <th key={column.label}>
                {column.label}
                {column.note ? <div className="muted small">{column.note}</div> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([label, render]) => (
            <tr key={label}>
              <td>{label}</td>
              {columns.map((column) => (
                <td key={column.label}>{column.metrics === null ? "—" : render(column.metrics)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function EvolutionCandidatePage({ params }: { params: Promise<{ key: string }> }) {
  if (!TRADING_DASHBOARD_ENABLED) return <TradingDisabled />;
  const { key } = await params;
  const result = await fetchEvolutionCandidate(key);
  const data = result.data;
  return (
    <>
      <PageHeader eyebrow="Trading · Evolution" title={key} subtitle="Forschungsbericht eines Strategiekandidaten — historische Simulation, kein Forward-Ergebnis." />
      <p className="small">
        <Link href="/dashboard/trading/evolution">← Zurück zur Evolution-Übersicht</Link>
      </p>
      {result.error ? <ErrorState title="Kandidat konnte nicht geladen werden" message={result.error} /> : null}
      {data && !data.available ? <EmptyState title="Evolution Engine hier nicht eingerichtet." /> : null}
      {data && data.available ? <CandidateBody data={data} /> : null}
    </>
  );
}

function CandidateBody({ data }: { data: Detail }) {
  const status = candidateStatus(data.status);
  const failed = data.gates.filter((gate) => !gate.passed);
  const champion = Object.entries(data.benchmarks).find(([benchmark]) => benchmark.includes("TREND_CORE"))?.[1];
  const challenger = Object.entries(data.benchmarks).find(([benchmark]) => benchmark.includes("REGIME_LONG"))?.[1];
  return (
    <>
      <PageIntro
        purpose={data.notice}
        tone={data.status === "PROPOSED" || data.status === "APPROVED_FOR_FORWARD_TEST" ? "good" : failed.length > 0 ? "bad" : "neutral"}
        verdict={`${status.label}${failed.length > 0 ? ` — ${failed.length} Prüfung${failed.length === 1 ? "" : "en"} nicht bestanden` : ""}`}
        detail={failed[0]?.message}
        nextStep={
          data.status === "PROPOSED"
            ? `Bericht prüfen; Freigabe per evolution approve --candidate=${data.key} --actor=<name>. Danach Registrierung und eigener Shadow-Forward-Test.`
            : undefined
        }
      />

      <div className="grid metrics">
        <MetricCard label="Status" value={<span className={`badge ${status.tone}`}>{status.label}</span>} sub={data.decision.decidedAt ? `entschieden von ${data.decision.decidedBy} am ${formatUtcDateTime(data.decision.decidedAt)}` : undefined} />
        <MetricCard label="Familie / Generation" value={`${FAMILY_LABEL[data.family] ?? data.family} · G${data.generation}`} sub={`Eltern ${data.parentKey.replace(/^ROOT:/, "")}`} />
        <MetricCard label="Forschungs-Score" value={fmt(data.researchScore, 1)} sub="0–100, neutral 50, nur historisch" hint="Gewichtete Robustheit: Validierung, Risikobereinigung, Kostenstress, Marktphasen, Drawdown, Stichprobe, Diversifikation; Abzug für viele geänderte Parameter." />
        <MetricCard
          label="Evidenz nach Mehrfachtest"
          value={data.evidence ? EVIDENCE_LABEL[data.evidence.grade]?.label ?? data.evidence.grade : "—"}
          sub={data.evidence ? `t = ${fmt(data.evidence.tStat)} · Schwelle ${fmt(data.evidence.threshold)} bei ${data.evidence.trials} Konfigurationen` : undefined}
          hint="Unter der Nullhypothese erreicht die beste von N getesteten Konfigurationen allein durch Zufall etwa t = √(2·ln N)."
        />
        <MetricCard label="Gesehene Daten" value={data.windowsSeen.map((window) => WINDOW_LABEL[window] ?? window).join(", ") || "—"} sub={data.holdoutEvaluated ? "Holdout bereits früher analysiert" : "Holdout nicht angefasst"} />
        <MetricCard label="Forschungsdurchlauf" value={data.run.runKey} sub={`${PROVIDER_LABEL[data.run.provider] ?? data.run.provider} · ${formatUtcDateTime(data.run.startedAt)}`} />
      </div>

      {data.successor ? (
        <div style={{ marginBottom: 16 }}>
          <SectionCard
            title={`Nachfolger-Prüfung gegen ${data.successor.rootKey.replace(/^ROOT:/, "")}`}
            subtitle="Gates v2: eine Fast-Kopie der eigenen Wurzel muss sie deutlich, in beiden Zeiträumen, gepaart signifikant und ohne Verschlechterung übertreffen. Historische Simulation, kein Forward-Nachweis."
          >
            <ul className="small">
              <li>
                Korrelation der Tagesrenditen {fmt(data.successor.correlation)} · Sharpe {fmt(data.successor.candidateSharpe)} gegenüber {fmt(data.successor.referenceSharpe)} (Δ{" "}
                {fmtSigned(data.successor.candidateSharpe !== null && data.successor.referenceSharpe !== null ? data.successor.candidateSharpe - data.successor.referenceSharpe : null)})
              </li>
              <li>
                Gepaarter Monatsvergleich: {data.successor.paired.months} Monate ({data.successor.paired.informativeMonths} mit Unterschied), t = {fmt(data.successor.paired.tStat)} mit
                Newey–West-Korrektur (Lag {data.successor.paired.lag ?? "—"}; ohne Korrektur {fmt(data.successor.paired.naiveTStat)}), Schwelle {fmt(data.successor.threshold)} bei{" "}
                {data.successor.trials} geprüften Konfigurationen
              </li>
              <li>
                Nachfolger-Prüfung {data.successor.screeningsThisMonth} in diesem Monat für diese Wurzel
              </li>
            </ul>
          </SectionCard>
        </div>
      ) : null}

      <SectionCard title="Abstammung" subtitle={data.gateVersion ? `Entschieden nach ${GATES_VERSION_LABEL[data.gateVersion] ?? data.gateVersion}` : undefined}>
        <p>
          {data.lineage.map((entry, index) => (
            <span key={entry}>
              {index > 0 ? " → " : ""}
              {entry.startsWith("EVO-") && entry !== data.key ? <Link href={`/dashboard/trading/evolution/${entry}`}>{entry}</Link> : <strong>{entry}</strong>}
            </span>
          ))}
        </p>
      </SectionCard>

      {data.hypothesis ? (
        <div style={{ marginTop: 16 }}>
          <SectionCard title={`Hypothese: ${data.hypothesis.title}`}>
            <ul className="small">
              <li>
                <strong>Beobachtung:</strong> {data.hypothesis.marketObservation}
              </li>
              <li>
                <strong>Begründung:</strong> {data.hypothesis.rationale}
              </li>
              <li>
                <strong>Erwartete Wirkung:</strong> {data.hypothesis.expectedEffect}
              </li>
              <li>
                <strong>Scheitert, wenn:</strong> {data.hypothesis.falsificationCriterion}
              </li>
            </ul>
          </SectionCard>
        </div>
      ) : null}

      <div className="grid two" style={{ marginTop: 16 }}>
        <SectionCard title="Parameter" subtitle={`Genom ${data.genomeHash.slice(0, 12)}… — geändert gegenüber der Elternstrategie hervorgehoben.`}>
          <div className="table-wrap">
            <table>
              <tbody>
                {Object.entries(data.genome.parameters).map(([name, value]) => {
                  const change = data.changes.find((entry) => entry.parameter === name);
                  return (
                    <tr key={name}>
                      <td className="small">{name}</td>
                      <td>{change ? <strong>{String(value)}</strong> : String(value)}</td>
                      <td className="muted small">{change ? `vorher ${String(change.from)}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
        <SectionCard title="Prüfungen" subtitle={`${data.gates.filter((gate) => gate.passed).length} von ${data.gates.length} bestanden`}>
          {data.gates.length === 0 ? (
            <EmptyState title="Keine Prüfung erreicht." description={data.statusReasons.join(" · ")} />
          ) : (
            <ul className="small">
              {data.gates.map((gate) => (
                <li key={`${gate.stage}-${gate.gate}`} style={{ marginBottom: 6 }}>
                  <span className={`badge ${gate.passed ? "trading-good" : "trading-bad"}`}>{gate.passed ? "bestanden" : "nicht bestanden"}</span>{" "}
                  <strong>{GATE_LABEL[gate.gate] ?? gate.gate}</strong> <span className="muted">({gate.stage === "FINAL" ? "Finale" : "Screening"})</span> — {gate.message}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionCard title="Backtest-Ergebnisse (BTC + ETH, je 10 000 USDT)" subtitle="Entdeckung 2018-04 – 2022-06, Validierung 2022-07 – 2023-12, Holdout 2024-01 – 2026-10-14 (bereits analysiert). Kosten wie im offiziellen Forward-Test.">
          <MetricsTable
            columns={[
              { label: "Entdeckung", metrics: data.metrics.discovery },
              { label: "Validierung", metrics: data.metrics.validation },
              { label: "Holdout", note: "bereits analysiert", metrics: data.metrics.holdout },
              { label: "Champion E+V", note: "eingefroren", metrics: champion?.inSample ?? null },
              { label: "Challenger E+V", note: "eingefroren", metrics: challenger?.inSample ?? null }
            ]}
          />
        </SectionCard>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <SectionCard title="Marktphasen (Walk-Forward-Segmente)">
          {data.folds.length === 0 ? (
            <EmptyState title="Keine Segmente." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Segment</th>
                    <th>Fenster</th>
                    <th>Trades</th>
                    <th>Ø R</th>
                    <th>PF</th>
                    <th>Netto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.folds.map((fold) => (
                    <tr key={fold.key}>
                      <td>{fold.key}</td>
                      <td className="small">{WINDOW_LABEL[fold.window] ?? fold.window}</td>
                      <td>{fold.trades}</td>
                      <td style={{ color: toneColor(toneOf(fold.averageR)) }}>{fmtR(fold.averageR)}</td>
                      <td>{fmt(fold.profitFactor)}</td>
                      <td style={{ color: toneColor(toneOf(fold.netPnl)) }}>{fmtSigned(fold.netPnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
        <SectionCard title="Robustheit" subtitle="Nachbarvarianten (ein Rasterschritt), rollierender Walk-Forward und Korrelation.">
          {data.walkForward ? (
            <p className="small">
              Walk-Forward: außerhalb der Stichprobe <strong>{fmtR(data.walkForward.outOfSampleAverageR)}</strong> über {data.walkForward.outOfSampleTrades} Trades, in der Stichprobe {fmtR(data.walkForward.inSampleAverageR)}, Effizienz{" "}
              {fmt(data.walkForward.efficiency)}.
            </p>
          ) : (
            <p className="muted small">Kein Walk-Forward (nur für Finalisten).</p>
          )}
          {data.neighbours.length > 0 ? (
            <ul className="small">
              {data.neighbours.map((neighbour) => (
                <li key={neighbour.key}>
                  {neighbour.key}: {fmtR(neighbour.inSample?.averageR)}, Sharpe {fmt(neighbour.inSample?.sharpe)}
                </li>
              ))}
            </ul>
          ) : null}
          {data.correlations.length > 0 ? (
            <p className="small">
              Korrelation (tägliche Renditen): {data.correlations.map((entry) => `${entry.key.replace(/^ROOT:/, "")} ${fmt(entry.value)}`).join(" · ")}
            </p>
          ) : null}
        </SectionCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <TechnicalDetails summary="Vollständiger Forschungsbericht und Backtest-Nachweise" count={data.backtests.length}>
          <ul className="small">
            {data.backtests.map((backtest) => (
              <li key={`${backtest.subjectKey}-${backtest.symbol}-${backtest.windowKey}`}>
                {backtest.subjectKey} · {backtest.role} · {backtest.symbol} · {backtest.windowKey} · {backtest.tradeCount} Trades · {Math.round(backtest.durationMs / 1000)} s · Hash {backtest.outputHash.slice(0, 12)}…
              </li>
            ))}
          </ul>
          {data.reportMarkdown ? <pre style={{ whiteSpace: "pre-wrap" }}>{data.reportMarkdown}</pre> : null}
        </TechnicalDetails>
      </div>
    </>
  );
}

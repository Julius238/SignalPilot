import type { ReactNode } from "react";

import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { MetricCard, PageHeader, PageIntro, SectionCard } from "../../../../components/ui";
import { OpsHealthCard } from "../../../../components/trading/ops-health-card";
import { TradingDisabled } from "../../../../components/trading/trading-disabled";
import {
  fetchArenaOverview,
  fetchOpsHealth,
  type ArenaEvaluation,
  type ArenaOverview,
  type ArenaParticipant,
  type ArenaPolicy
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

const STATUS_TONE: Record<ArenaParticipant["status"], string> = {
  CHAMPION: "trading-good",
  PROVEN: "trading-good",
  ACTIVE: "trading-neutral",
  CANDIDATE: "trading-neutral",
  PROBATION: "trading-warn",
  RETIRED: "trading-bad"
};

const RECOMMENDATION_LABEL: Record<string, string> = {
  HOLD: "Halten",
  PROBATION: "Auf Probation setzen",
  RETIRE: "Retiren",
  REINSTATE: "Zurück auf ACTIVE",
  PROMOTE_PROVEN: "Zu PROVEN befördern",
  PROMOTE_CHAMPION: "Zum Champion befördern",
  DEMOTE_CHAMPION: "Champion abstufen"
};

const COMPONENT_LABEL: Record<string, string> = {
  growth: "Kapitalwachstum (log, annualisiert)",
  riskAdjustedGrowth: "Wachstum je Drawdown",
  drawdown: "Max. Drawdown",
  profitFactor: "Profit Factor",
  averageR: "Ø R",
  hitRate: "Trefferquote vs. Break-even",
  lossStreak: "Größte Verlustserie",
  costs: "Kostenanteil am Vorkosten-Ertrag",
  capitalEfficiency: "Wachstum je Zeit im Markt"
};

const plainPercent = (value: string | null | undefined) =>
  value === null || value === undefined ? "—" : `${formatDecimalAmount(value)} %`;

function statusBadge(status: ArenaParticipant["status"]) {
  return <span className={`badge ${STATUS_TONE[status]}`}>{status}</span>;
}

function evidenceCell(evaluation: ArenaEvaluation | null): ReactNode {
  if (evaluation === null) return <span className="muted">—</span>;
  const progress = Math.round(Number(evaluation.evidenceProgress) * 100);
  return (
    <div className="progress-cell">
      <span>
        <span className={`badge ${evaluation.evidenceStatus === "SUFFICIENT" ? "trading-good" : "trading-warn"}`}>
          {evaluation.evidenceStatus}
        </span>{" "}
        <span className="muted small">{progress} %</span>
      </span>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.min(100, progress)}%` }} />
      </div>
    </div>
  );
}

function fitnessCell(evaluation: ArenaEvaluation | null): ReactNode {
  if (evaluation === null) return <span className="muted">noch nicht bewertet</span>;
  return (
    <>
      <strong>{formatDecimalAmount(evaluation.fitness, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}</strong>
      <div className="muted small">
        roh {formatDecimalAmount(evaluation.rawFitness, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}
        {evaluation.evidenceStatus === "PROVISIONAL" ? " · vorläufig" : ""}
      </div>
    </>
  );
}

function recommendationCell(evaluation: ArenaEvaluation | null): ReactNode {
  if (evaluation === null) return <span className="muted">—</span>;
  const tone =
    evaluation.recommendation === "HOLD"
      ? "trading-neutral"
      : ["PROBATION", "RETIRE", "DEMOTE_CHAMPION"].includes(evaluation.recommendation)
        ? "trading-warn"
        : "trading-good";
  return (
    <>
      <span className={`badge ${tone}`}>{RECOMMENDATION_LABEL[evaluation.recommendation] ?? evaluation.recommendation}</span>
      {evaluation.hardStop ? <span className="badge trading-bad"> Harter Stopp</span> : null}
      <div className="muted small">{evaluation.reasonCodes.join(" · ")}</div>
    </>
  );
}

function PolicyCard({ policy, policyHash }: { policy: ArenaPolicy; policyHash: string }) {
  const { evidence, survival, lifecycle } = policy;
  return (
    <SectionCard title="Regeln dieser Kohorte" subtitle={`${policy.version} · Hash ${policyHash.slice(0, 12)}…`}>
      <ul className="muted small">
        <li>
          <strong>Evidence Gate:</strong> ≥ {evidence.minClosedTrades} geschlossene Trades und ≥ {evidence.minForwardDays}{" "}
          Tage — oder ≥ {evidence.longRunForwardDays} Tage und ≥ {evidence.longRunMinClosedTrades} Trades. Davor ist jede
          Fitness vorläufig (zur neutralen 50 geschrumpft) und es gibt keine Leistungsentscheidung.
        </li>
        <li>
          <strong>Survival Floor:</strong> {Math.round(survival.floorFraction * 100)} % des eigenen Startkapitals. Darunter
          zuerst Probation, nach ausreichender Evidenz Retirement.
        </li>
        <li>
          <strong>Bänder:</strong> Probation &lt; {lifecycle.probationFitness}, Retirement &lt; {lifecycle.retireFitness}{" "}
          (auf Probation), zurück ab {lifecycle.reinstateFitness}, PROVEN ab {lifecycle.provenFitness} mit Gewinn, Champion
          bei +{lifecycle.championMargin} gegenüber dem amtierenden Champion.
        </li>
        <li>
          <strong>Risiko-Obergrenze:</strong> Fitness ≤ 50 + 50 × Drawdown-Score — ein Drawdown ab{" "}
          {Math.round(policy.fitness.drawdownReference * 100)} % bleibt höchstens neutral, egal wie hoch der Gewinn.
        </li>
        <li>
          <strong>Arena V1 empfiehlt nur.</strong> Statuswechsel sind Operator-Kommandos; kein Kapitaltransfer, kein
          Nachschuss, keine Änderung an Risk-Limits oder Strategien.
        </li>
      </ul>
    </SectionCard>
  );
}

function ParticipantDetail({ participant }: { participant: ArenaParticipant }) {
  const evaluation = participant.evaluation;
  const days = evaluation ? Number(evaluation.forwardDays) : null;
  return (
    <SectionCard
      title={`${evaluation?.rank ? `#${evaluation.rank} · ` : ""}${participant.strategyKey} v${participant.strategyVersion}`}
      subtitle={`${participant.participantKey} · Portfolio ${participant.portfolioKey} · Hash ${participant.specificationHash.slice(0, 12)}…`}
      action={statusBadge(participant.status)}
    >
      {evaluation === null ? (
        <EmptyState title="Noch keine Arena-Evaluation — sie läuft stündlich zur Minute 20." />
      ) : (
        <>
          <div className="grid metrics">
            <MetricCard label="Startkapital" value={`${formatDecimalAmount(participant.initialCapital)} USDT`} sub="nie aufgefüllt" />
            <MetricCard
              label="Aktuelle Equity"
              value={`${formatDecimalAmount(evaluation.equity)} USDT`}
              sub={`Floor ${formatDecimalAmount(evaluation.survivalFloor)} USDT${evaluation.survivalFloorBreached ? " — unterschritten" : ""}`}
              tone={evaluation.survivalFloorBreached ? "bad" : undefined}
            />
            <MetricCard
              label="Gesamtrendite / P&L"
              value={<span style={{ color: toneColor(decimalTone(evaluation.netPnl)) }}>{formatPercentValue(evaluation.returnPct)}</span>}
              sub={`${formatSignedDecimal(evaluation.netPnl)} USDT nach allen Kosten`}
            />
            <MetricCard
              label="Log. Wachstum"
              value={evaluation.logGrowth === null ? "—" : formatSignedDecimal(evaluation.logGrowth, { maximumFractionDigits: 5, minimumFractionDigits: 5 })}
              sub="ln(Equity / Startkapital)"
            />
            <MetricCard label="Trades" value={String(evaluation.closedTrades)} sub="geschlossen seit Forward-Start" />
            <MetricCard label="Profit Factor" value={formatDecimalAmount(evaluation.profitFactor)} />
            <MetricCard label="Ø R" value={formatSignedDecimal(evaluation.averageR)} />
            <MetricCard label="Trefferquote" value={plainPercent(evaluation.winRatePct)} />
            <MetricCard label="Max. Drawdown" value={plainPercent(evaluation.maxDrawdownPct)} sub="stündliche Kapitalkurve" />
            <MetricCard label="Größte Verlustserie" value={String(evaluation.maxLossStreak)} />
            <MetricCard label="Kosten" value={`${formatDecimalAmount(evaluation.costs)} USDT`} sub="Gebühren + Spread/Slippage" />
            <MetricCard label="Zeit im Markt" value={plainPercent(evaluation.exposurePct)} />
            <MetricCard
              label="Forward-Laufzeit"
              value={days === null ? "—" : `${days.toFixed(1)} Tage`}
              sub={`seit ${formatUtcDateTime(participant.forwardStartAt)}`}
            />
            <MetricCard
              label="Evidenz"
              value={`${Math.round(Number(evaluation.evidenceProgress) * 100)} %`}
              sub={evaluation.evidenceStatus === "SUFFICIENT" ? "Evidence Gate erreicht" : "PROVISIONAL — keine Leistungsentscheidung"}
              tone={evaluation.evidenceStatus === "SUFFICIENT" ? "good" : "quiet"}
            />
            <MetricCard
              label="Fitness"
              value={formatDecimalAmount(evaluation.fitness, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}
              sub={`roh ${formatDecimalAmount(evaluation.rawFitness, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} · Risiko-Obergrenze ${evaluation.riskCeiling?.toFixed(1) ?? "—"}`}
            />
            <MetricCard
              label="Empfehlung"
              value={RECOMMENDATION_LABEL[evaluation.recommendation] ?? evaluation.recommendation}
              sub={`${evaluation.hardStop ? "Harter Stopp · " : ""}${evaluation.reasonCodes.join(" · ")}`}
              tone={evaluation.hardStop ? "bad" : evaluation.recommendation === "HOLD" ? undefined : "warn"}
            />
          </div>

          <div className="grid two">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fitness-Komponente</th>
                    <th>Gewicht</th>
                    <th>Messwert</th>
                    <th>Score</th>
                    <th>Beitrag</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluation.components.map((component) => (
                    <tr key={component.key}>
                      <td>{COMPONENT_LABEL[component.key] ?? component.key}</td>
                      <td>{component.weight}</td>
                      <td className="muted small">
                        {component.measure === null ? "—" : component.measure.toPrecision(4)}
                        {component.neutralReason ? ` (${component.neutralReason})` : ""}
                      </td>
                      <td>{component.score.toFixed(2)}</td>
                      <td>{component.contribution.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p>
                <strong>Offene Position:</strong>{" "}
                {participant.openPosition === null
                  ? "keine"
                  : `${participant.openPosition.symbol} ${formatDecimalAmount(participant.openPosition.quantity, { maximumFractionDigits: 6 })} @ ${formatDecimalAmount(participant.openPosition.averageEntryPrice)} · Stop ${formatDecimalAmount(participant.openPosition.stopPrice)} · Ziel ${formatDecimalAmount(participant.openPosition.takeProfitPrice)}`}
              </p>
              <p>
                <strong>Letzter Trade:</strong>{" "}
                {participant.lastTrade === null ? (
                  "noch keiner"
                ) : (
                  <span style={{ color: toneColor(decimalTone(participant.lastTrade.netPnl)) }}>
                    {formatSignedDecimal(participant.lastTrade.netPnl)} USDT · {participant.lastTrade.status} ·{" "}
                    {formatUtcDateTime(participant.lastTrade.closedAt)}
                  </span>
                )}
              </p>
              <p>
                <strong>Letzte Strategie-Bewertung:</strong>{" "}
                {participant.lastStrategyEvaluation === null ? (
                  "noch keine"
                ) : (
                  <>
                    {participant.lastStrategyEvaluation.outcome === "CANDIDATE" ? "Kandidat" : "kein Kandidat"} ·{" "}
                    <code>{participant.lastStrategyEvaluation.reasonCode}</code> ·{" "}
                    {formatUtcDateTime(participant.lastStrategyEvaluation.occurredAt)}
                  </>
                )}
              </p>
              <p className="muted small">
                Arena-Evaluation {formatUtcDateTime(evaluation.asOf)} · Kette {evaluation.outputHash.slice(0, 12)}…
                {participant.parentParticipantKey ? ` · Nachfolger von ${participant.parentParticipantKey}` : ""}
              </p>
            </div>
          </div>
        </>
      )}

      <div className="grid two" style={{ marginTop: 12 }}>
        <div>
          <strong>Lifecycle</strong>
          <ul className="muted small">
            {participant.lifecycle.map((event) => (
              <li key={`${event.occurredAt}-${event.toStatus}`}>
                {formatUtcDateTime(event.occurredAt)}: {event.fromStatus ?? "—"} → {event.toStatus} ({event.reasonCode}, {event.actorId})
                {event.note ? ` — ${event.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <strong>Post-Mortems</strong>
          {participant.postMortems.length === 0 ? (
            <p className="muted small">Keine — ein Fall wird bei PROBATION oder RETIRED mit eingefrorenem Dossier angelegt.</p>
          ) : (
            <ul className="muted small">
              {participant.postMortems.map((postMortem) => (
                <li key={postMortem.id}>
                  {formatUtcDateTime(postMortem.createdAt)} · {postMortem.triggerStatus} · {postMortem.status} · Dossier{" "}
                  {postMortem.dossierHash.slice(0, 12)}…{postMortem.hypothesis ? ` — ${postMortem.hypothesis}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function introFor(data: ArenaOverview) {
  const participants = data.cohorts.flatMap((cohort) => cohort.participants);
  const actionable = participants.filter(
    (participant) => participant.evaluation !== null && participant.evaluation.recommendation !== "HOLD"
  );
  const hardStops = participants.filter((participant) => participant.evaluation?.hardStop);
  if (hardStops.length > 0) {
    return {
      tone: "bad" as const,
      verdict: `Harter Stopp bei ${hardStops.map((participant) => participant.strategyKey).join(", ")}`,
      detail: "Technischer oder Risk-Verstoß — unabhängig von der Evidenz. Empfehlung prüfen."
    };
  }
  if (actionable.length > 0) {
    return {
      tone: "warn" as const,
      verdict: `${actionable.length} Empfehlung(en) zur Prüfung`,
      detail: "Arena V1 führt nichts selbst aus; Statuswechsel sind Operator-Kommandos."
    };
  }
  const provisional = participants.filter((participant) => participant.evaluation?.evidenceStatus !== "SUFFICIENT");
  return {
    tone: "neutral" as const,
    verdict:
      provisional.length === participants.length
        ? `${participants.length} Teilnehmer, alle Fitness-Werte noch vorläufig`
        : `${participants.length} Teilnehmer, keine Statusänderung empfohlen`,
    detail: "Rangliste nach Fitness: langfristiges, risikobereinigtes Kapitalwachstum nach allen Kosten."
  };
}

export default async function ArenaPage() {
  if (!TRADING_DASHBOARD_ENABLED) {
    return <TradingDisabled />;
  }

  const [result, healthResult] = await Promise.all([fetchArenaOverview(), fetchOpsHealth()]);
  const data = result.data;

  return (
    <>
      <PageHeader
        eyebrow="Shadow Trading"
        title="SignalPilot Arena"
        subtitle="Jede Strategie lebt nur von ihrem eigenen virtuellen Kapital — nach allen Kosten, unter festen Risk-Limits"
      />
      {result.error ? <ErrorState title="Arena konnte nicht geladen werden" message={result.error} /> : null}

      {data ? (
        <>
          <PageIntro
            purpose="Forward-Ergebnisse jedes Teilnehmers ab seinem eigenen Startzeitpunkt, bewertet nach Fitness, Evidenz und Survival Floor. Darunter getrennt der historische Replay."
            {...introFor(data)}
          />

          <SectionCard title="Aktuelles Regime" subtitle="crypto-native-regime-v1 — für alle Teilnehmer dasselbe">
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

          {healthResult.data ? (
            <div style={{ marginTop: 16 }}>
              <OpsHealthCard health={healthResult.data} />
            </div>
          ) : null}

          {data.cohorts.length === 0 ? (
            <EmptyState title="Noch keine Arena-Kohorte registriert." />
          ) : (
            data.cohorts.map((cohort) => (
              <div key={cohort.key} style={{ marginTop: 16 }}>
                {cohort.phase !== "OFFICIAL" ? (
                  <PageIntro
                    purpose={`Kohorte ${cohort.key}`}
                    tone="warn"
                    verdict={
                      cohort.phase === "LOCAL_SHAKEDOWN"
                        ? "LOCAL_SHAKEDOWN — Systemtest, keine offiziellen Forward-Ergebnisse"
                        : "Kohorte ohne Phasen-Kennzeichnung"
                    }
                    detail="Diese Zahlen werden nie mit dem offiziellen Forward-Test verglichen oder zusammengeführt."
                  />
                ) : null}
                <SectionCard
                  title={`Rangliste · ${cohort.name}`}
                  subtitle={`${cohort.phase} · Forward-Daten (Shadow, Live) · Stand ${formatUtcDateTime(data.asOf)}`}
                  action={
                    <span className={`badge ${cohort.phase === "OFFICIAL" ? "trading-good" : "trading-warn"}`}>{cohort.phase}</span>
                  }
                >
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Rang</th>
                          <th>Teilnehmer</th>
                          <th>Status</th>
                          <th>Fitness</th>
                          <th>Evidenz</th>
                          <th>Equity</th>
                          <th>Rendite</th>
                          <th>Max. DD</th>
                          <th>Trades</th>
                          <th>Laufzeit</th>
                          <th>Empfehlung</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cohort.participants.map((participant) => {
                          const evaluation = participant.evaluation;
                          return (
                            <tr key={participant.id}>
                              <td>
                                <strong>{evaluation?.rank ?? "—"}</strong>
                              </td>
                              <td>
                                <strong>{participant.strategyKey}</strong> v{participant.strategyVersion}
                                <div className="muted small">{participant.portfolioKey}</div>
                              </td>
                              <td>{statusBadge(participant.status)}</td>
                              <td>{fitnessCell(evaluation)}</td>
                              <td>{evidenceCell(evaluation)}</td>
                              <td>{evaluation ? `${formatDecimalAmount(evaluation.equity)} USDT` : "—"}</td>
                              <td style={{ color: toneColor(decimalTone(evaluation?.netPnl)) }}>
                                {evaluation ? formatPercentValue(evaluation.returnPct) : "—"}
                              </td>
                              <td>{plainPercent(evaluation?.maxDrawdownPct)}</td>
                              <td>{evaluation?.closedTrades ?? "—"}</td>
                              <td>{evaluation ? `${Number(evaluation.forwardDays).toFixed(1)} T` : "—"}</td>
                              <td>{recommendationCell(evaluation)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>

                <div style={{ marginTop: 16 }}>
                  <PolicyCard policy={cohort.policy} policyHash={cohort.policyHash} />
                </div>

                {cohort.participants.map((participant) => (
                  <div key={participant.id} style={{ marginTop: 16 }}>
                    <ParticipantDetail participant={participant} />
                  </div>
                ))}
              </div>
            ))
          )}

          <div style={{ marginTop: 24 }}>
            <SectionCard
              className="arena-replay"
              title="Historischer Replay — bekannte Kursdaten, kein Forward-Beleg"
              subtitle="Dieselben StrategyVersions über gespeicherte Binance-Historie. Diese Zahlen fließen in keine Fitness, keinen Rang und keine Empfehlung ein."
            >
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
                            <td style={{ color: toneColor(decimalTone(period.netPnl)) }}>{formatSignedDecimal(period.netPnl)}</td>
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

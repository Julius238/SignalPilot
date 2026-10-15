import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { MetricCard, PageHeader, PageIntro, SectionCard, TechnicalDetails } from "../../../../components/ui";
import { TradingDisabled } from "../../../../components/trading/trading-disabled";
import { fetchEvolutionOverview, type EvolutionCandidateItem, type EvolutionMetrics, type EvolutionOverviewAvailable } from "../../../../lib/evolution-api";
import {
  AGENT_STATUS,
  EVIDENCE_LABEL,
  FAMILY_LABEL,
  GATE_LABEL,
  HYPOTHESIS_OUTCOME,
  PROVIDER_LABEL,
  PURPOSE_LABEL,
  RUN_STATUS,
  VISIBILITY_LABEL,
  WINDOW_LABEL,
  buildLineageTrees,
  candidateStatus,
  fmt,
  fmtDuration,
  fmtPct,
  fmtR,
  fmtSigned,
  fmtUsd,
  rootLabel,
  toneOf,
  type LineageNode
} from "../../../../lib/evolution-labels";
import { TRADING_DASHBOARD_ENABLED } from "../../../../lib/trading-flag";
import { formatUtcDateTime, toneColor } from "../../../../lib/trading-format";

const WINDOW_ORDER = ["DISCOVERY", "VALIDATION", "HOLDOUT"] as const;
const SCREENED: ReadonlySet<string> = new Set(["REJECTED", "RESERVE", "PROPOSED", "APPROVED_FOR_FORWARD_TEST", "REJECTED_BY_OPERATOR"]);

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const entry = candidateStatus(status);
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

function reasonOf(candidate: EvolutionCandidateItem): string {
  if (candidate.status === "PROPOSED" || candidate.status === "APPROVED_FOR_FORWARD_TEST") return `Alle ${candidate.gatesTotal} Prüfungen bestanden.`;
  if (candidate.failedGates.length > 0) return candidate.failedGates[0]!.message;
  if (candidate.status === "RESERVE") return "Besteht das Screening, war in diesem Durchlauf aber nicht unter den Finalisten.";
  return candidate.statusReasons.join(" · ") || "—";
}

function MetricsRow({ label, sub, metrics, emphasis }: { label: ReactNode; sub?: string; metrics: EvolutionMetrics | null; emphasis?: boolean }) {
  return (
    <tr className={emphasis ? undefined : "muted"}>
      <td>
        {label}
        {sub ? <div className="muted small">{sub}</div> : null}
      </td>
      <td>{metrics?.trades ?? "—"}</td>
      <td style={{ color: toneColor(toneOf(metrics?.averageR)) }}>{fmtR(metrics?.averageR)}</td>
      <td>{fmt(metrics?.profitFactor)}</td>
      <td style={{ color: toneColor(toneOf(metrics?.netReturnPct)) }}>{fmtPct(metrics?.netReturnPct)}</td>
      <td>{fmtPct(metrics?.maxDrawdownPct)}</td>
      <td>{fmt(metrics?.sharpe)}</td>
      <td>{fmtPct(metrics?.exposurePct, 1)}</td>
      <td>{fmtR(metrics?.stressedAverageR)}</td>
      <td>{fmtPct(metrics?.buyAndHoldReturnPct)}</td>
    </tr>
  );
}

function LineageTree({ node, depth = 0 }: { node: LineageNode; depth?: number }) {
  return (
    <li>
      {node.status === "ROOT" ? (
        <strong>{rootLabel(node.key)}</strong>
      ) : (
        <>
          <Link href={`/dashboard/trading/evolution/${node.key}`}>{node.key}</Link> <span className="muted small">G{node.generation}</span> <StatusBadge status={node.status} />
        </>
      )}
      {node.children.length > 0 ? (
        <ul style={{ marginLeft: depth === 0 ? 8 : 18, borderLeft: "1px solid var(--line)", paddingLeft: 12 }}>
          {node.children.map((child) => (
            <LineageTree key={child.key} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function introFor(data: EvolutionOverviewAvailable) {
  const agent = AGENT_STATUS[data.agent.status] ?? AGENT_STATUS.NOT_INITIALISED!;
  const waiting = data.awaitingApproval.length;
  return {
    tone: (waiting > 0 ? "good" : agent.tone === "trading-good" ? "neutral" : "warn") as "good" | "neutral" | "warn",
    verdict: `Forschungs-Agent ${agent.label.toLowerCase()}${waiting > 0 ? ` · ${waiting} Kandidat${waiting === 1 ? "" : "en"} wartet auf Freigabe` : ""}`,
    detail: data.agent.statusReason ?? agent.explanation,
    nextStep:
      waiting > 0
        ? "Forschungsbericht des vorgeschlagenen Kandidaten prüfen; erst nach Freigabe kann er einen eigenen Shadow-Forward-Test bekommen."
        : data.runs.length === 0
          ? "Ersten Forschungsdurchlauf lokal starten: corepack pnpm --filter @signalpilot/evolution-worker evolution run-cycle --force"
          : "Nächsten Durchlauf abwarten; verworfene Kandidaten zeigen unten ihre konkreten Gründe."
  };
}

export default async function EvolutionPage() {
  if (!TRADING_DASHBOARD_ENABLED) return <TradingDisabled />;
  const result = await fetchEvolutionOverview();
  const data = result.data;

  return (
    <>
      <PageHeader
        eyebrow="Shadow Trading"
        title="Evolution"
        subtitle="KI-gestützte Strategieforschung auf historischen Daten. Getrennt von den offiziellen Forward-Ergebnissen der Arena."
      />
      {result.error ? <ErrorState title="Evolution-Daten konnten nicht geladen werden" message={result.error} /> : null}
      {data && !data.available ? (
        <EmptyState title="Evolution Engine hier nicht eingerichtet." description={data.reason} />
      ) : null}
      {data && data.available ? <EvolutionBody data={data} /> : null}
    </>
  );
}

function EvolutionBody({ data }: { data: EvolutionOverviewAvailable }) {
  const intro = introFor(data);
  const agent = AGENT_STATUS[data.agent.status] ?? AGENT_STATUS.NOT_INITIALISED!;
  const screened = data.candidates.filter((candidate) => SCREENED.has(candidate.status));
  const ranking = [...screened].sort((a, b) => (b.researchScore ?? -1) - (a.researchScore ?? -1));
  const passed = data.candidates.filter((candidate) => ["PROPOSED", "APPROVED_FOR_FORWARD_TEST", "RESERVE"].includes(candidate.status));
  const failed = data.candidates.filter((candidate) => ["REJECTED", "TECHNICAL_FAILED"].includes(candidate.status));
  const proposed = data.candidates.filter((candidate) => candidate.status === "PROPOSED");
  const approved = data.candidates.filter((candidate) => candidate.status === "APPROVED_FOR_FORWARD_TEST");
  const champion = Object.values(data.benchmarks).find((entry) => entry.role === "CHAMPION");
  const challenger = Object.values(data.benchmarks).find((entry) => entry.role === "CHALLENGER");
  const budgetShare = data.budget.monthlyBudgetUsd > 0 ? Math.min(100, (data.budget.spentUsd / data.budget.monthlyBudgetUsd) * 100) : 0;
  const latestRun = data.runs[0] ?? null;
  const trees = buildLineageTrees(data.lineage);

  return (
    <>
      <PageIntro purpose={data.notice} tone={intro.tone} verdict={intro.verdict} detail={intro.detail} nextStep={intro.nextStep} />

      <div className="grid metrics">
        <MetricCard label="Forschungs-Agent" value={<Badge tone={agent.tone}>{agent.label}</Badge>} sub={data.agent.runInProgress ? "Durchlauf läuft gerade" : agent.explanation} />
        <MetricCard label="Letzter Durchlauf" value={formatUtcDateTime(data.agent.lastRunAt)} sub={latestRun ? `${RUN_STATUS[latestRun.status]?.label ?? latestRun.status} · ${PROVIDER_LABEL[latestRun.provider] ?? latestRun.provider}` : "noch keiner"} />
        <MetricCard label="Nächster Durchlauf" value={formatUtcDateTime(data.agent.nextRunAt)} sub={data.agent.status === "ACTIVE" ? "laut Zeitplan" : "erst nach Fortsetzen"} />
        <MetricCard
          label={`KI-Budget ${data.budget.month}`}
          value={`${fmtUsd(data.budget.spentUsd)} / ${fmtUsd(data.budget.monthlyBudgetUsd, 0)}`}
          sub={`verbleibend ${fmtUsd(data.budget.remainingUsd)} · je Durchlauf max. ${fmtUsd(data.budget.perRunBudgetUsd)}`}
          hint="Tatsächliche API-Kosten aus den gemeldeten Tokens. Ein Aufruf startet nur, wenn sein schlechtester Fall in Monats- und Durchlaufbudget passt. Kein automatisches Aufladen."
          tone={budgetShare >= 90 ? "warn" : undefined}
        />
        <MetricCard label="API-Kosten gesamt" value={fmtUsd(data.budget.totalSpentUsd, 4)} sub={`${data.budget.totalBillableCalls} abgerechnete Aufrufe · Mock-Simulation ${fmtUsd(data.budget.simulatedUsdThisMonth, 4)} (nicht abgerechnet)`} />
        <MetricCard label="Kandidaten" value={`${screened.length} geprüft`} sub={`${proposed.length} vorgeschlagen · ${failed.length} verworfen · ${data.candidates.filter((candidate) => !SCREENED.has(candidate.status)).length} ohne vollständigen Backtest`} />
      </div>
      <div className="progress-track" style={{ marginBottom: 20 }} aria-label={`Budget verbraucht: ${fmt(budgetShare, 0)} %`}>
        <div className="progress-fill" style={{ width: `${budgetShare}%` }} />
      </div>

      <SectionCard
        title="Freizugebende Challenger"
        subtitle="Nur diese Kandidaten haben alle technischen Tests und historischen Prüfungen bestanden. Eine Freigabe registriert noch nichts: Strategieversion, Portfolio und Arena-Eintrag bleiben ein bewusster, eigener Schritt."
      >
        {proposed.length === 0 && approved.length === 0 ? (
          <EmptyState title="Kein Kandidat wartet auf Freigabe." description="Ein Kandidat erscheint hier erst, wenn er Screening, Nachbar-Robustheit, Walk-Forward und Holdout besteht." />
        ) : (
          <div className="stack-list">
            {proposed.map((candidate) => (
              <div key={candidate.key} className="list-row" style={{ flexWrap: "wrap" }}>
                <div>
                  <Link href={`/dashboard/trading/evolution/${candidate.key}`}>
                    <strong>{candidate.key}</strong>
                  </Link>{" "}
                  <StatusBadge status={candidate.status} />
                  <div className="muted small">
                    {candidate.hypothesisTitle} · {FAMILY_LABEL[candidate.family] ?? candidate.family} G{candidate.generation} · Score {fmt(candidate.researchScore, 1)} · Evidenz{" "}
                    {EVIDENCE_LABEL[candidate.evidenceGrade ?? ""]?.label ?? "—"}
                  </div>
                </div>
                <code className="small" style={{ overflowWrap: "anywhere" }}>
                  corepack pnpm evolution approve --candidate={candidate.key} --actor=julius
                </code>
              </div>
            ))}
            {approved.map((candidate) => (
              <div key={candidate.key} className="list-row">
                <div>
                  <Link href={`/dashboard/trading/evolution/${candidate.key}`}>
                    <strong>{candidate.key}</strong>
                  </Link>{" "}
                  <StatusBadge status={candidate.status} />
                  <div className="muted small">
                    Freigegeben von {candidate.decidedBy ?? "—"} am {formatUtcDateTime(candidate.decidedAt)} · wartet auf Registrierung und eigenen Shadow-Forward-Test
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <div style={{ marginTop: 16 }}>
        <SectionCard
          title="Rangliste der geprüften Kandidaten"
          subtitle="Entdeckung + Validierung, BTC und ETH mit je 10 000 USDT, Kosten wie im offiziellen Forward-Test. Referenzzeilen: eingefrorener Champion und Challenger auf denselben Daten."
        >
          {ranking.length === 0 ? (
            <EmptyState title="Noch kein Kandidat gebacktestet." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kandidat</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Evidenz</th>
                    <th>Ø R Valid.</th>
                    <th>Ø R E+V</th>
                    <th>PF E+V</th>
                    <th>Sharpe E+V</th>
                    <th>Δ Sharpe Champion</th>
                    <th>Max. DD</th>
                    <th>Trades</th>
                    <th>Begründung</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((candidate) => (
                    <tr key={candidate.key}>
                      <td className="nowrap">
                        <Link href={`/dashboard/trading/evolution/${candidate.key}`}>
                          <strong>{candidate.key}</strong>
                        </Link>
                        <div className="muted small">
                          {FAMILY_LABEL[candidate.family] ?? candidate.family} · G{candidate.generation}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={candidate.status} />
                      </td>
                      <td>{fmt(candidate.researchScore, 1)}</td>
                      <td>{candidate.evidenceGrade ? <Badge tone={EVIDENCE_LABEL[candidate.evidenceGrade]?.tone ?? "trading-neutral"}>{EVIDENCE_LABEL[candidate.evidenceGrade]?.label ?? candidate.evidenceGrade}</Badge> : "—"}</td>
                      <td style={{ color: toneColor(toneOf(candidate.validation?.averageR)) }}>{fmtR(candidate.validation?.averageR)}</td>
                      <td style={{ color: toneColor(toneOf(candidate.inSample?.averageR)) }}>{fmtR(candidate.inSample?.averageR)}</td>
                      <td>{fmt(candidate.inSample?.profitFactor)}</td>
                      <td>{fmt(candidate.inSample?.sharpe)}</td>
                      <td style={{ color: toneColor(toneOf(candidate.versusChampion?.sharpeDelta)) }}>{fmtSigned(candidate.versusChampion?.sharpeDelta)}</td>
                      <td>{fmtPct(candidate.inSample?.maxDrawdownPct)}</td>
                      <td>{candidate.inSample?.trades ?? "—"}</td>
                      <td className="small">{reasonOf(candidate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {champion || challenger ? (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Referenz (E+V)</th>
                    <th>Trades</th>
                    <th>Ø R</th>
                    <th>PF</th>
                    <th>Rendite</th>
                    <th>Max. DD</th>
                    <th>Sharpe</th>
                    <th>Exposition</th>
                    <th>Ø R 2× Kosten</th>
                    <th>Buy &amp; Hold</th>
                  </tr>
                </thead>
                <tbody>
                  {champion ? <MetricsRow label={<strong>{champion.strategyKey}</strong>} sub="Champion, eingefroren" metrics={champion.inSample} emphasis /> : null}
                  {challenger ? <MetricsRow label={<strong>{challenger.strategyKey}</strong>} sub="Challenger, eingefroren" metrics={challenger.inSample} emphasis /> : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </SectionCard>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <SectionCard title="Bestanden" subtitle="Vorgeschlagen, freigegeben oder als Reserve gehalten.">
          {passed.length === 0 ? (
            <EmptyState title="Noch kein Kandidat hat das Screening bestanden." />
          ) : (
            <ul className="small">
              {passed.map((candidate) => (
                <li key={candidate.key} style={{ marginBottom: 8 }}>
                  <Link href={`/dashboard/trading/evolution/${candidate.key}`}>{candidate.key}</Link> <StatusBadge status={candidate.status} /> — {reasonOf(candidate)}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Gescheitert" subtitle="Automatisch verworfen, mit der ersten nicht bestandenen Prüfung.">
          {failed.length === 0 ? (
            <EmptyState title="Noch kein Kandidat verworfen." />
          ) : (
            <ul className="small">
              {failed.map((candidate) => (
                <li key={candidate.key} style={{ marginBottom: 8 }}>
                  <Link href={`/dashboard/trading/evolution/${candidate.key}`}>{candidate.key}</Link>{" "}
                  <span className="muted">
                    {candidate.failedGates.length > 0 ? candidate.failedGates.map((gate) => GATE_LABEL[gate.gate] ?? gate.gate).join(", ") : candidateStatus(candidate.status).label}
                  </span>{" "}
                  — {reasonOf(candidate)}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionCard title="Aktuelle Forschungs-Hypothesen" subtitle="Von der KI aus Entdeckungsdaten abgeleitet, automatisch in Parameter-Kandidaten übersetzt oder begründet verworfen.">
          {data.hypotheses.length === 0 ? (
            <EmptyState title="Noch keine Hypothese." />
          ) : (
            <div className="stack-list">
              {data.hypotheses.slice(0, 8).map((hypothesis) => (
                <div key={hypothesis.key} className="card" style={{ padding: 14 }}>
                  <div>
                    <strong>{hypothesis.title}</strong>{" "}
                    <Badge tone={HYPOTHESIS_OUTCOME[hypothesis.outcome]?.tone ?? "trading-neutral"}>{HYPOTHESIS_OUTCOME[hypothesis.outcome]?.label ?? hypothesis.outcome}</Badge>{" "}
                    {hypothesis.candidateKey ? (
                      <>
                        → <Link href={`/dashboard/trading/evolution/${hypothesis.candidateKey}`}>{hypothesis.candidateKey}</Link>{" "}
                        {hypothesis.candidateStatus ? <StatusBadge status={hypothesis.candidateStatus} /> : null}
                      </>
                    ) : null}
                  </div>
                  <div className="muted small">
                    {FAMILY_LABEL[hypothesis.family] ?? hypothesis.family} · Eltern {rootLabel(hypothesis.parentKey)} · Änderungen{" "}
                    {hypothesis.changes.map((change) => `${change.parameter} = ${change.value}`).join(", ")} · {hypothesis.runKey}
                  </div>
                  <ul className="small" style={{ marginTop: 6 }}>
                    <li>
                      <strong>Beobachtung:</strong> {hypothesis.marketObservation}
                    </li>
                    <li>
                      <strong>Begründung:</strong> {hypothesis.rationale}
                    </li>
                    <li>
                      <strong>Erwartete Wirkung:</strong> {hypothesis.expectedEffect}
                    </li>
                    <li>
                      <strong>Scheitert, wenn:</strong> {hypothesis.falsificationCriterion}
                    </li>
                    {hypothesis.outcomeReasons.length > 0 ? (
                      <li className="muted">
                        <strong>Verworfen, weil:</strong> {hypothesis.outcomeReasons.join(" · ")}
                      </li>
                    ) : null}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <SectionCard title="Strategie-Abstammung" subtitle="Jede Generation hat genau eine Elternstrategie. Champion und Challenger bleiben eingefroren (Generation 0).">
          {trees.length === 0 ? (
            <EmptyState title="Noch keine Abstammung." />
          ) : (
            <ul className="small" style={{ listStyle: "none", paddingLeft: 0 }}>
              {trees.map((tree) => (
                <LineageTree key={tree.key} node={tree} />
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Daten und Überanpassungsschutz" subtitle="Vorregistrierter Split. Forward-Daten ab dem Start des offiziellen Forward-Tests werden nie geladen.">
          {data.split === null ? (
            <EmptyState title="Noch kein Durchlauf mit Datenmanifest." />
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fenster</th>
                      <th>Zeitraum</th>
                      <th>Sicht der KI</th>
                      <th>Zugriffe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Fixed order: Postgres JSONB does not keep the key order of the manifest. */}
                    {WINDOW_ORDER.map((key) => data.split!.windows[key]).filter((window) => window !== undefined).map((window) => (
                      <tr key={window.key}>
                        <td>
                          <strong>{WINDOW_LABEL[window.key] ?? window.key}</strong>
                          {window.integrity === "PREVIOUSLY_ANALYZED" ? <div className="muted small">bereits früher analysiert — kein unberührter Beweis</div> : null}
                        </td>
                        <td className="nowrap small">
                          {window.from.slice(0, 10)} – {window.to.slice(0, 10)}
                        </td>
                        <td className="small">{VISIBILITY_LABEL[window.aiVisibility] ?? window.aiVisibility}</td>
                        <td className="small">
                          {Object.entries(data.exposure[window.key] ?? {})
                            .map(([purpose, count]) => `${PURPOSE_LABEL[purpose] ?? purpose} ${count}`)
                            .join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <strong>Forward</strong>
                      </td>
                      <td className="nowrap small">ab {data.split.forwardFrom.slice(0, 10)}</td>
                      <td className="small">nie geladen</td>
                      <td className="small">nur Arena</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                Split {data.split.key} · Hash {data.split.hash.slice(0, 12)}… · Frühere Forschung:{" "}
                {(data.split.priorExposure ?? []).map((entry) => `${entry.role === "TRAINING" ? "Training" : "Test"} ${entry.from.slice(0, 7)}–${entry.to.slice(0, 7)} (${entry.configurationsTried} Konfigurationen)`).join(", ") || "—"}
              </p>
            </>
          )}
        </SectionCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionCard title="Forschungsdurchläufe" subtitle="Tokens und Kosten je Durchlauf, wie von der API gemeldet. Mock-Durchläufe werden nie abgerechnet.">
          {data.runs.length === 0 ? (
            <EmptyState title="Noch kein Forschungsdurchlauf." />
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Durchlauf</th>
                      <th>Status</th>
                      <th>KI</th>
                      <th>Dauer</th>
                      <th>Hypothesen</th>
                      <th>Kandidaten</th>
                      <th>Backtests</th>
                      <th>Tokens (ein/aus)</th>
                      <th>Kosten</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((run) => (
                      <tr key={run.runKey}>
                        <td className="nowrap">
                          <strong>{run.runKey}</strong>
                          <div className="muted small">
                            {formatUtcDateTime(run.startedAt)} · {run.trigger === "SCHEDULED" ? "geplant" : "manuell"}
                          </div>
                        </td>
                        <td>
                          <Badge tone={RUN_STATUS[run.status]?.tone ?? "trading-neutral"}>{RUN_STATUS[run.status]?.label ?? run.status}</Badge>
                          {run.errorMessage ? <div className="muted small">{run.errorMessage}</div> : null}
                        </td>
                        <td className="small">{PROVIDER_LABEL[run.provider] ?? run.provider}</td>
                        <td>{fmtDuration(run.durationMs)}</td>
                        <td>{run.hypothesesRequested}</td>
                        <td className="small">
                          {run.candidatesGenerated} erzeugt · {run.candidatesProposed} vorgeschlagen · {run.candidatesRejected} verworfen
                        </td>
                        <td>
                          {run.backtestCount}
                          <div className="muted small">{fmtDuration(run.backtestMs)}</div>
                        </td>
                        <td className="nowrap">
                          {run.aiInputTokens.toLocaleString("de-DE")} / {run.aiOutputTokens.toLocaleString("de-DE")}
                        </td>
                        <td>{run.billable ? fmtUsd(run.aiCostUsd, 4) : <span className="muted">simuliert</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {latestRun && latestRun.findings.length > 0 ? (
                <TechnicalDetails summary="Marktbedingungen des letzten Durchlaufs (nur Entdeckungsdaten)" count={latestRun.findings.length}>
                  <ul className="small">
                    {latestRun.findings.map((finding) => (
                      <li key={finding}>{finding}</li>
                    ))}
                  </ul>
                  {latestRun.aiSummary ? <p className="small">{latestRun.aiSummary}</p> : null}
                </TechnicalDetails>
              ) : null}
            </>
          )}
        </SectionCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <PageIntro
          purpose="Offizielle Forward-Ergebnisse"
          tone="neutral"
          verdict="Stehen ausschließlich in der Arena und werden hier nie mit historischer Forschung gemischt."
          detail="Die Evolution Engine liest keine Forward-Daten und optimiert keine laufende Strategie rückwirkend. Über die Leistung eines freigegebenen Kandidaten entscheidet allein sein eigener Shadow-Forward-Test."
          action={<Link href="/dashboard/trading/arena">Zur Arena</Link>}
        />
      </div>
    </>
  );
}

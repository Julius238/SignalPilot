import { SectionCard } from "../ui";
import type { OpsHealth } from "../../lib/trading-api";
import { formatUtcDateTime } from "../../lib/trading-format";

function stateBadge(ok: boolean, label?: string) {
  return <span className={`badge ${ok ? "trading-good" : "trading-bad"}`}>{label ?? (ok ? "OK" : "Problem")}</span>;
}

/** 24/7-Betriebszustand: Marktdaten, Job-Läufe, Worker-Starts, Sessions. */
export function OpsHealthCard({ health }: { health: OpsHealth }) {
  return (
    <SectionCard
      title="Betrieb (24/7)"
      subtitle={`Stand ${formatUtcDateTime(health.asOf)} · letzter Trading-Worker-Start ${formatUtcDateTime(health.lastWorkerStartAt)} · ${health.workerStartsLast24h} Start(s) in 24 h`}
      action={stateBadge(health.ok, health.ok ? "Alles im Takt" : "Prüfen")}
    >
      <div className="grid two">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Marktdaten (1h)</th>
                <th>Letzte Kerze</th>
                <th>Alter</th>
                <th>Quelle</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {health.marketData.map((entry) => (
                <tr key={entry.symbol}>
                  <td>{entry.symbol}</td>
                  <td className="nowrap">{formatUtcDateTime(entry.latestCloseTime)}</td>
                  <td>{entry.ageMinutes === null ? "—" : `${entry.ageMinutes} min`}</td>
                  <td>{entry.source ?? "—"}</td>
                  <td>{stateBadge(entry.ok, entry.problem ?? "OK")}</td>
                </tr>
              ))}
              {health.sessions.map((session) => (
                <tr key={session.portfolioKey}>
                  <td>{session.portfolioKey}</td>
                  <td>{session.sessionStatus ?? "keine Session"}</td>
                  <td>{session.killSwitchEngaged ? `Kill Switch${session.killReasonCode ? ` (${session.killReasonCode})` : ""}` : "Kill Switch aus"}</td>
                  <td>{session.unacknowledgedCriticalRiskEvents} krit. Events</td>
                  <td>
                    {stateBadge(
                      session.unacknowledgedCriticalRiskEvents === 0 &&
                        !(session.killSwitchEngaged === true && session.killReasonCode !== null) &&
                        session.sessionStatus !== "ERROR_LOCKED" &&
                        session.sessionStatus !== "KILLED"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Letzter Erfolg</th>
                <th>Alter / max.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {health.jobs.map((job) => (
                <tr key={job.jobName}>
                  <td>{job.label}</td>
                  <td className="nowrap">{formatUtcDateTime(job.lastSuccessAt)}</td>
                  <td>{job.ageMinutes === null ? "—" : `${job.ageMinutes} / ${job.maxAgeMinutes} min`}</td>
                  <td>{job.neverRan ? <span className="badge trading-neutral">noch nie</span> : stateBadge(job.ok)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}

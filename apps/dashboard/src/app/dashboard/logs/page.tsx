import { AlertsList } from "../../../components/alerts-list";
import { ErrorState, EmptyState } from "../../../components/empty-state";
import { formatDateTime, formatJson } from "../../../lib/format";
import { fetchApi, type Alert, type BotLog, type BotRun } from "../../../lib/signalpilot-api";

export default async function LogsPage() {
  const [botRuns, botLogs, alerts] = await Promise.all([
    fetchApi<BotRun[]>("/bot-runs?limit=50"),
    fetchApi<BotLog[]>("/logs?limit=100"),
    fetchApi<Alert[]>("/alerts?limit=50")
  ]);

  return (
    <>
      <div className="page-header">
        <h1>Operations</h1>
        <p>Recent BotRuns, BotLogs and alert dispatch records.</p>
      </div>

      {botRuns.error ? <ErrorState title="Could not load bot runs" message={botRuns.error} /> : null}
      {botLogs.error ? <ErrorState title="Could not load logs" message={botLogs.error} /> : null}
      {alerts.error ? <ErrorState title="Could not load alerts" message={alerts.error} /> : null}

      <section className="grid two">
        <div className="card">
          <h2>BotRuns</h2>
          {botRuns.data && botRuns.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Finished</th>
                  </tr>
                </thead>
                <tbody>
                  {botRuns.data.map((run) => (
                    <tr key={run.id}>
                      <td>{formatDateTime(run.startedAt)}</td>
                      <td>{run.jobName}</td>
                      <td>{run.status}</td>
                      <td>{formatDateTime(run.finishedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Keine BotRuns gefunden." />
          )}
        </div>

        <div className="card">
          <h2>Alerts</h2>
          <AlertsList alerts={alerts.data ?? []} />
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>BotLogs</h2>
        {botLogs.data && botLogs.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Level</th>
                  <th>Service</th>
                  <th>Message</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {botLogs.data.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>{log.level}</td>
                    <td>{log.service}</td>
                    <td>{log.message}</td>
                    <td className="wide-cell">
                      <pre>{formatJson(log.metadataJson)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Keine BotLogs gefunden." />
        )}
      </section>
    </>
  );
}

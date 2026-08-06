import Link from "next/link";

import { ErrorState, EmptyState } from "../../../components/empty-state";
import { RetryButton } from "../../../components/retry-button";
import { PageHeader, PageIntro, SectionCard, TechnicalDetails } from "../../../components/ui";
import { describeApiError } from "../../../lib/api-error";
import { formatDateTime, formatRelativeTime } from "../../../lib/format";
import { logLevelLabel, logLevelTone, type LogTone } from "../../../lib/labels";
import { fetchApi, type BotLog } from "../../../lib/signalpilot-api";

const TONE_CLASS: Record<LogTone, string> = {
  error: "alert-failed",
  warn: "alert-pending",
  info: "alert-sent",
  neutral: "status-no_edge"
};

function LevelBadge({ level }: { level: string }) {
  return (
    <span className={`badge ${TONE_CLASS[logLevelTone(level)]}`}>{logLevelLabel(level)}</span>
  );
}

function MetaCell({ value }: { value: unknown }) {
  if (!value || (typeof value === "object" && Object.keys(value as object).length === 0)) {
    return <span className="muted">—</span>;
  }
  try {
    const str = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return (
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: 11
        }}
      >
        {str}
      </pre>
    );
  } catch {
    return <span className="muted">—</span>;
  }
}

export default async function LogsPage() {
  const botLogs = await fetchApi<BotLog[]>("/logs?limit=200");
  const logs = botLogs.data ?? [];
  const errorCopy = describeApiError(
    botLogs.errorKind,
    botLogs.error ?? "",
    "Das Ausführungsprotokoll"
  );

  const errors = logs.filter((log) => logLevelTone(log.level) === "error");
  const warnings = logs.filter((log) => logLevelTone(log.level) === "warn");
  const newest = logs[0];

  // Testläufe schreiben in dieselbe Datenbank. Sie als Betriebsfehler zu zählen
  // würde den Zustand der Seite dauerhaft falsch darstellen.
  const fromTestRun = (log: BotLog) =>
    log.message.startsWith("test:") ||
    JSON.stringify(log.metadataJson ?? {}).includes("simulated database failure");
  const realErrors = errors.filter((log) => !fromTestRun(log));
  const testErrors = errors.length - realErrors.length;

  const tone = botLogs.error
    ? "bad"
    : realErrors.length > 0
      ? "bad"
      : warnings.length > 0
        ? "warn"
        : "good";
  const verdict = botLogs.error
    ? "Protokoll nicht abrufbar."
    : logs.length === 0
      ? "Noch keine Einträge vorhanden."
      : realErrors.length > 0
        ? `${realErrors.length} Fehler in den letzten Läufen.`
        : warnings.length > 0
          ? `Keine Fehler, aber ${warnings.length} Warnung${warnings.length !== 1 ? "en" : ""}.`
          : "Alle protokollierten Läufe sind ohne Fehler durchgelaufen.";
  const detail = newest
    ? `Neuester Eintrag: ${formatRelativeTime(newest.createdAt)}`
    : undefined;
  const nextStep = botLogs.error
    ? undefined
    : realErrors.length > 0
      ? "Den obersten Fehler unten aufklappen — die Meldung nennt den betroffenen Job."
      : warnings.length > 0
        ? "Warnungen deuten meist auf Datenlücken hin; die Datenqualität gibt darüber Auskunft."
        : "Nichts zu tun.";

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Ausführungsprotokoll"
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/operations">
            Zur Systemübersicht
          </Link>
        }
      />

      <PageIntro
        purpose="Diese Seite protokolliert, was die Hintergrund-Jobs zuletzt getan haben — Datenabrufe, Analysen und Zustellungen."
        tone={tone}
        verdict={verdict}
        detail={detail}
        nextStep={nextStep}
      />

      {botLogs.error ? (
        <ErrorState
          title={errorCopy.title}
          message={errorCopy.message}
          hint={errorCopy.hint}
          action={errorCopy.retryable ? <RetryButton /> : null}
        />
      ) : null}

      {testErrors > 0 ? (
        <p className="muted small" style={{ marginBottom: 14 }}>
          {testErrors} weitere Fehlermeldung{testErrors !== 1 ? "en" : ""} stammen aus
          automatisierten Testläufen und sind kein Betriebsproblem.
        </p>
      ) : null}

      {/* Fehler zuerst — sie sind der Grund, warum jemand diese Seite öffnet. */}
      {realErrors.length > 0 ? (
        <SectionCard
          title="Fehler zuerst"
          subtitle="Diese Läufe sind abgebrochen oder unvollständig geblieben."
        >
          <div className="finding-list">
            {realErrors.slice(0, 5).map((log) => (
              <div className="finding finding--bad" key={log.id}>
                <span className="finding-icon">✕</span>
                <span className="finding-text">{log.message}</span>
                <span className="finding-action">
                  {log.service} · {formatDateTime(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
          {realErrors.length > 5 ? (
            <p className="muted small" style={{ marginTop: 10 }}>
              {realErrors.length - 5} weitere Fehler stehen in der vollständigen Liste.
            </p>
          ) : null}
        </SectionCard>
      ) : null}

      <TechnicalDetails summary="Vollständiges Protokoll" count={logs.length}>
        {logs.length > 0 ? (
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Zeit</th>
                  <th>Einstufung</th>
                  <th>Dienst</th>
                  <th>Meldung</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td data-label="Zeit" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td data-label="Einstufung">
                      <LevelBadge level={log.level} />
                    </td>
                    <td data-label="Dienst">
                      <span className="muted small">{log.service}</span>
                    </td>
                    <td data-label="Meldung">{log.message}</td>
                    <td data-label="Details" className="wide-cell">
                      <MetaCell value={log.metadataJson} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Noch keine Protokolleinträge."
            description="Sie entstehen, sobald ein Hintergrund-Job gelaufen ist."
          />
        )}
      </TechnicalDetails>
    </>
  );
}

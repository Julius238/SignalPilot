import { ErrorState, EmptyState } from "../../../components/empty-state";
import { RetryButton } from "../../../components/retry-button";
import { PageHeader, PageIntro, SectionCard, TechnicalDetails } from "../../../components/ui";
import { describeApiError } from "../../../lib/api-error";
import { formatDateTime, formatRelativeTime } from "../../../lib/format";
import { auditActionLabel, auditActionTone, type AuditTone } from "../../../lib/labels";
import { fetchApi, type AuditLog } from "../../../lib/signalpilot-api";

const AUDIT_LIMIT = 200;

const TONE_CLASS: Record<AuditTone, string> = {
  success: "alert-sent",
  warn: "alert-pending",
  error: "alert-failed",
  neutral: "badge-info"
};

function MetaDetail({ value }: { value: unknown }) {
  if (!value || (typeof value === "object" && Object.keys(value as object).length === 0)) {
    return null;
  }
  try {
    const str = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return (
      <pre
        style={{
          margin: "6px 0 0",
          padding: "6px 8px",
          background: "rgba(255,255,255,0.04)",
          borderRadius: 4,
          fontSize: 11,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: "var(--muted)"
        }}
      >
        {str}
      </pre>
    );
  } catch {
    return null;
  }
}

export default async function AuditLogsPage() {
  const result = await fetchApi<AuditLog[]>(`/audit-logs?limit=${AUDIT_LIMIT}`);
  const logs = result.data ?? [];
  const errorCopy = describeApiError(result.errorKind, result.error ?? "", "Das Audit-Protokoll");

  const failedLogins = logs.filter((log) => log.action.toLowerCase().includes("failed"));
  const newest = logs[0];
  const reachedLimit = logs.length >= AUDIT_LIMIT;

  const tone = result.error ? "bad" : failedLogins.length > 0 ? "warn" : "good";
  const verdict = result.error
    ? "Audit-Protokoll nicht abrufbar."
    : logs.length === 0
      ? "Noch keine administrativen Änderungen protokolliert."
      : failedLogins.length > 0
        ? `${failedLogins.length} fehlgeschlagene Anmeldeversuche im Protokoll.`
        : "Keine auffälligen Zugriffe im Protokoll.";
  const detail = newest
    ? `Letzte Aktion: ${formatRelativeTime(newest.createdAt)} durch ${newest.actor}`
    : undefined;
  const nextStep = result.error
    ? undefined
    : failedLogins.length > 0
      ? "Prüfen, ob die fehlgeschlagenen Versuche von einer bekannten Adresse stammen."
      : "Nichts zu tun. Dieses Protokoll ist eine Nachweisspur, kein Betriebsmonitor.";

  return (
    <>
      <PageHeader eyebrow="System" title="Audit" />

      <PageIntro
        purpose="Diese Seite hält fest, wer wann welche administrative oder sicherheitsrelevante Änderung ausgelöst hat."
        tone={tone}
        verdict={verdict}
        detail={detail}
        nextStep={nextStep}
      />

      {result.error ? (
        <ErrorState
          title={errorCopy.title}
          message={errorCopy.message}
          hint={errorCopy.hint}
          action={errorCopy.retryable ? <RetryButton /> : null}
        />
      ) : null}

      <SectionCard
        title={logs.length > 0 ? `${logs.length} Einträge` : undefined}
        subtitle={
          reachedLimit
            ? `Neueste zuerst. Es werden höchstens ${AUDIT_LIMIT} Einträge angezeigt — ältere sind über die API abrufbar.`
            : logs.length > 0
              ? "Neueste zuerst."
              : undefined
        }
      >
        {logs.length > 0 ? (
          <div className="stack-list">
            {logs.map((log) => (
              <div className="audit-entry" key={log.id}>
                <div className="audit-entry-head">
                  <span className={`badge ${TONE_CLASS[auditActionTone(log.action)]}`}>
                    {auditActionLabel(log.action)}
                  </span>
                  {log.targetType ? (
                    <span className="audit-entry-target">
                      {log.targetType}
                      {/* Zielbezeichner sind frei wählbare Werte — als Datenwert
                          kenntlich machen, nicht als Fließtext neben der Aktion. */}
                      {log.targetId ? (
                        <>
                          {" "}
                          <code>{log.targetId}</code>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                  <span className="audit-entry-meta">
                    <span>{log.actor}</span>
                    <span>{log.ip}</span>
                    <span>{formatDateTime(log.createdAt)}</span>
                  </span>
                </div>
                {log.metadataJson &&
                Object.keys(log.metadataJson as object).length > 0 ? (
                  <TechnicalDetails summary="Technische Details">
                    <MetaDetail value={log.metadataJson} />
                    <p className="muted small" style={{ marginTop: 8 }}>
                      Interner Aktionsschlüssel: <code>{log.action}</code>
                    </p>
                  </TechnicalDetails>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Noch keine Audit-Einträge."
            description="Anmeldungen und administrative Änderungen erscheinen hier automatisch."
          />
        )}
      </SectionCard>
    </>
  );
}

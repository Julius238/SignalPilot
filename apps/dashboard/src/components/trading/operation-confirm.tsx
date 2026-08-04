"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { postTradingOperation } from "../../lib/trading-api";

type ExtraField = {
  name: string;
  label: string;
  type: "text" | "textarea" | "checkbox" | "select";
  required?: boolean;
  helpText?: string;
  // Nur für type "select" — feste Auswahl statt Freitext (z. B. Jobname-
  // Allowlist, offene Positionen). Kein Freitext für sicherheitsrelevante IDs.
  options?: Array<{ value: string; label: string }>;
};

type Status = "idle" | "submitting" | "success" | "error";

export type OperationBodyValue = string | number | boolean | null | undefined;

/**
 * Declarative, fully serialisable description of the request body.
 *
 * This used to be a `buildBody` callback. A function cannot cross the React
 * Server/Client boundary: the operations page is a Server Component, so
 * passing one made `next build` fail while prerendering
 * /dashboard/trading/operations ("Functions cannot be passed directly to
 * Client Components"). That error only surfaced once the trading dashboard was
 * actually enabled at build time — with the flag off the page short-circuits
 * to <TradingDisabled/> and never renders these props.
 *
 * Everything the callbacks used to do is expressible as data, so the body is
 * now assembled here on the client from plain values.
 */
export type OperationBodySpec = {
  /** Constants resolved on the server (ids, expected entity versions). */
  base?: Record<string, OperationBodyValue>;
  /**
   * Extra form fields copied into the body under the same key. A field
   * declared as a checkbox is coerced to a strict boolean.
   */
  passthrough?: readonly string[];
  /** One "<id><separator><version>" select value split into two body keys. */
  split?: {
    from: string;
    separator: string;
    idKey: string;
    versionKey: string;
  };
  /**
   * One extra field that must match a fixed allowlist before it enters the
   * body. A non-matching value becomes `undefined`, exactly as the previous
   * callback did — and the API re-validates it server-side regardless.
   */
  allowlisted?: { from: string; to: string; allowed: readonly string[] };
};

/**
 * Assemble the operation body from the spec and the current form state. Pure
 * and exported so it can be unit-tested without rendering.
 */
export function buildOperationBody(
  spec: OperationBodySpec,
  extra: Record<string, string | boolean>,
  extraFields: readonly ExtraField[] = []
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...(spec.base ?? {}) };

  for (const key of spec.passthrough ?? []) {
    const declared = extraFields.find((field) => field.name === key);
    body[key] =
      declared?.type === "checkbox" ? extra[key] === true : extra[key];
  }

  if (spec.split) {
    const [id, version] = String(extra[spec.split.from] ?? "").split(
      spec.split.separator
    );
    body[spec.split.idKey] = id;
    body[spec.split.versionKey] = Number(version);
  }

  if (spec.allowlisted) {
    const value = String(extra[spec.allowlisted.from] ?? "");
    body[spec.allowlisted.to] = spec.allowlisted.allowed.includes(value)
      ? value
      : undefined;
  }

  return body;
}

export type OperationConfirmProps = {
  title: string;
  impact: string;
  dangerous?: boolean;
  confirmPhrase: string;
  endpoint: string;
  reasonFieldName: "reasonCode" | "reasonNote" | "reason";
  reasonLabel?: string;
  body: OperationBodySpec;
  extraFields?: ExtraField[];
  triggerLabel?: string;
  disabledReason?: string | null;
};

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback für Umgebungen ohne crypto.randomUUID — nicht kryptografisch,
  // aber ausreichend eindeutig als Idempotenz-Scope für einen UI-Versuch.
  return `attempt-${Math.random().toString(36).slice(2)}-${performance.now()}`;
}

export function OperationConfirm({
  title,
  impact,
  dangerous = false,
  confirmPhrase,
  endpoint,
  reasonFieldName,
  reasonLabel = "Grund",
  body: bodySpec,
  extraFields = [],
  triggerLabel = "Aktion vorbereiten",
  disabledReason = null
}: OperationConfirmProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmInput, setConfirmInput] = useState("");
  const [extra, setExtra] = useState<Record<string, string | boolean>>({});
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  function openPanel() {
    setOpen(true);
    setStatus("idle");
    setMessage(null);
    idempotencyKeyRef.current = newIdempotencyKey();
  }

  function closePanel() {
    setOpen(false);
    setReason("");
    setConfirmInput("");
    setExtra({});
    setStatus("idle");
    setMessage(null);
    idempotencyKeyRef.current = null;
  }

  const requiredExtraMissing = extraFields.some(
    (field) =>
      field.required &&
      field.type !== "checkbox" &&
      !String(extra[field.name] ?? "").trim()
  );
  const requiredCheckboxMissing = extraFields.some(
    (field) =>
      field.required && field.type === "checkbox" && extra[field.name] !== true
  );
  const canSubmit =
    reason.trim().length > 0 &&
    confirmInput === confirmPhrase &&
    !requiredExtraMissing &&
    !requiredCheckboxMissing &&
    status !== "submitting";

  async function submit() {
    if (!canSubmit) {
      return;
    }

    setStatus("submitting");
    setMessage(null);

    const idempotencyKey = idempotencyKeyRef.current ?? newIdempotencyKey();
    idempotencyKeyRef.current = idempotencyKey;

    const body = {
      ...buildOperationBody(bodySpec, extra, extraFields),
      [reasonFieldName]: reason,
      confirm: confirmPhrase,
      idempotencyKey
    };

    const result = await postTradingOperation(endpoint, body);

    if (result.error || !result.data) {
      setStatus("error");
      setMessage(result.error ?? "Unbekannter Fehler.");
      return;
    }

    setStatus("success");
    setMessage(
      result.data.replayed
        ? "Bereits ausgeführt — vorheriges Ergebnis wurde erneut zurückgegeben (Idempotenz)."
        : "Aktion erfolgreich ausgeführt."
    );
    idempotencyKeyRef.current = null;
    router.refresh();
  }

  if (disabledReason) {
    return (
      <div className={`operation-panel${dangerous ? " dangerous" : ""}`}>
        <h3>{title}</h3>
        <p className="operation-impact">{disabledReason}</p>
      </div>
    );
  }

  if (!open) {
    return (
      <div className={`operation-panel${dangerous ? " dangerous" : ""}`}>
        <h3>{title}</h3>
        <p className="operation-impact">{impact}</p>
        <div className="operation-actions">
          <button
            type="button"
            className="operation-toggle"
            onClick={openPanel}
          >
            {triggerLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`operation-panel${dangerous ? " dangerous" : ""}`}>
      <h3>{title}</h3>
      <p className="operation-impact">{impact}</p>

      <label htmlFor={`${endpoint}-reason`}>{reasonLabel} (Pflichtfeld)</label>
      <textarea
        id={`${endpoint}-reason`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        disabled={status === "submitting"}
        placeholder="Warum wird diese Aktion jetzt ausgeführt?"
      />

      {extraFields.map((field) =>
        field.type === "checkbox" ? (
          <label
            key={field.name}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <input
              type="checkbox"
              checked={extra[field.name] === true}
              onChange={(event) =>
                setExtra((current) => ({
                  ...current,
                  [field.name]: event.target.checked
                }))
              }
              disabled={status === "submitting"}
            />
            {field.label}
          </label>
        ) : (
          <div key={field.name}>
            <label htmlFor={`${endpoint}-${field.name}`}>{field.label}</label>
            {field.type === "textarea" ? (
              <textarea
                id={`${endpoint}-${field.name}`}
                value={String(extra[field.name] ?? "")}
                onChange={(event) =>
                  setExtra((current) => ({
                    ...current,
                    [field.name]: event.target.value
                  }))
                }
                disabled={status === "submitting"}
              />
            ) : field.type === "select" ? (
              <select
                id={`${endpoint}-${field.name}`}
                value={String(extra[field.name] ?? "")}
                onChange={(event) =>
                  setExtra((current) => ({
                    ...current,
                    [field.name]: event.target.value
                  }))
                }
                disabled={status === "submitting"}
              >
                <option value="" disabled>
                  Bitte auswählen…
                </option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`${endpoint}-${field.name}`}
                type="text"
                value={String(extra[field.name] ?? "")}
                onChange={(event) =>
                  setExtra((current) => ({
                    ...current,
                    [field.name]: event.target.value
                  }))
                }
                disabled={status === "submitting"}
              />
            )}
            {field.helpText ? (
              <p className="operation-meta">{field.helpText}</p>
            ) : null}
          </div>
        )
      )}

      <label htmlFor={`${endpoint}-confirm`}>
        Zum Bestätigen exakt eingeben: <code>{confirmPhrase}</code>
      </label>
      <input
        id={`${endpoint}-confirm`}
        type="text"
        value={confirmInput}
        onChange={(event) => setConfirmInput(event.target.value)}
        disabled={status === "submitting"}
        autoComplete="off"
      />

      <p className="operation-meta">
        Diese Aktion verwendet einen frisch ausgestellten CSRF-Token und einen
        pro Versuch stabilen Idempotency-Key — ein erneuter Klick nach einem
        Fehler führt die Aktion nicht doppelt aus.
      </p>

      {message ? (
        <p
          className="operation-meta"
          role={status === "error" ? "alert" : "status"}
          style={{
            color: status === "error" ? "var(--bad)" : "var(--good)",
            fontWeight: 600
          }}
        >
          {message}
        </p>
      ) : null}

      <div className="operation-actions">
        <button type="submit" onClick={submit} disabled={!canSubmit}>
          {status === "submitting" ? "Wird ausgeführt…" : "Jetzt ausführen"}
        </button>
        <button
          type="button"
          className="operation-toggle"
          onClick={closePanel}
          disabled={status === "submitting"}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

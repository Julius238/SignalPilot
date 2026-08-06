import Link from "next/link";

import { EmptyState, ErrorState } from "../../../components/empty-state";
import { RetryButton } from "../../../components/retry-button";
import { PageHeader, PageIntro, SectionCard } from "../../../components/ui";
import { describeApiError } from "../../../lib/api-error";
import { formatDateTime } from "../../../lib/format";
import { timeframeLabel } from "../../../lib/labels";
import { fetchApi, type BacktestRun } from "../../../lib/signalpilot-api";

function formatList(values: unknown[]): string {
  return values.length > 0 ? values.join(", ") : "—";
}

function formatPercent(v: number | null | undefined): string {
  return typeof v === "number" ? `${v.toFixed(2)}%` : "—";
}

const STATUS_LABELS: Record<string, string> = {
  RUNNING: "Läuft",
  SUCCESS: "Abgeschlossen",
  FAILED: "Fehlgeschlagen",
  CANCELLED: "Abgebrochen"
};

export default async function BacktestsPage() {
  const runs = await fetchApi<BacktestRun[]>("/backtests?limit=50");
  const list = runs.data ?? [];
  const errorCopy = describeApiError(runs.errorKind, runs.error ?? "", "Die Backtest-Läufe");

  const failed = list.filter((run) => run.status === "FAILED");
  const running = list.filter((run) => run.status === "RUNNING");
  const thin = list.filter((run) => run.status === "SUCCESS" && run.totalSignals < 30);

  const tone = runs.error
    ? "bad"
    : failed.length > 0
      ? "bad"
      : list.length === 0
        ? "neutral"
        : thin.length > 0
          ? "warn"
          : "good";
  const verdict = runs.error
    ? "Backtest-Läufe nicht abrufbar."
    : list.length === 0
      ? "Noch kein Backtest durchgeführt."
      : failed.length > 0
        ? `${failed.length} von ${list.length} Läufen sind fehlgeschlagen.`
        : running.length > 0
          ? `${running.length} Lauf${running.length !== 1 ? "läufe" : ""} laufen gerade.`
          : thin.length > 0
            ? `${list.length} Läufe abgeschlossen, davon ${thin.length} mit sehr kleiner Datenbasis.`
            : `${list.length} Läufe abgeschlossen.`;
  const nextStep = runs.error
    ? undefined
    : list.length === 0
      ? "Ein Backtest wird über die Kommandozeile gestartet und erscheint anschließend automatisch hier."
      : failed.length > 0
        ? "Fehlgeschlagene Läufe zuerst öffnen — die Detailseite nennt den Abbruchgrund."
        : thin.length > 0
          ? "Läufe mit unter 30 Datenpunkten sind statistisch nicht belastbar; sie sind unten markiert."
          : "Einen Lauf öffnen, um die einzelnen historischen Signale und ihre Ergebnisse zu sehen.";

  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="Backtest-Analysen"
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/strategy-lab">
            Strategie-Labor
          </Link>
        }
      />

      <PageIntro
        purpose="Diese Seite prüft die Regeln gegen historische Kursdaten — rein hypothetisch, ohne echte Trades und ohne Aussage über die Zukunft."
        tone={tone}
        verdict={verdict}
        nextStep={nextStep}
      />

      {runs.error ? (
        <ErrorState
          title={errorCopy.title}
          message={errorCopy.message}
          hint={errorCopy.hint}
          action={errorCopy.retryable ? <RetryButton /> : null}
        />
      ) : null}

      <SectionCard title={list.length > 0 ? `${list.length} Läufe` : undefined}>
        {list.length === 0 ? (
          <EmptyState
            title="Noch kein Backtest durchgeführt."
            description="Backtests werden bewusst manuell angestoßen, weil sie rechenintensiv sind. Ergebnisse erscheinen anschließend hier."
          />
        ) : (
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Zeitraum</th>
                  <th>Symbole</th>
                  <th>Zeitebenen</th>
                  <th>Datenpunkte</th>
                  <th>Trefferquote</th>
                  <th>Ø Kursänd. nach 1 Tag</th>
                  <th>Gestartet</th>
                  <th>Abgeschlossen</th>
                </tr>
              </thead>
              <tbody>
                {list.map((run) => (
                  <tr key={run.id}>
                    <td data-label="Name">
                      <Link href={`/dashboard/backtests/${encodeURIComponent(run.id)}`}>
                        {run.name}
                      </Link>
                    </td>
                    <td data-label="Status">{STATUS_LABELS[run.status] ?? run.status}</td>
                    <td data-label="Zeitraum" className="nowrap">
                      {formatDateTime(run.from)} – {formatDateTime(run.to)}
                    </td>
                    <td data-label="Symbole">{formatList(run.symbols)}</td>
                    <td data-label="Zeitebenen">
                      {run.timeframes.length > 0
                        ? run.timeframes.map((tf) => timeframeLabel(String(tf))).join(", ")
                        : "—"}
                    </td>
                    <td data-label="Datenpunkte">
                      {run.totalSignals}
                      {run.totalSignals < 30 ? (
                        <span
                          style={{ color: "var(--bad)", marginLeft: 4 }}
                          title="Unter 30 Datenpunkten ist das Ergebnis statistisch nicht belastbar."
                        >
                          ⚠
                        </span>
                      ) : run.totalSignals < 100 ? (
                        <span
                          style={{ color: "var(--warn)", marginLeft: 4 }}
                          title="Begrenzte Datenbasis — das Ergebnis ist nur eingeschränkt aussagekräftig."
                        >
                          △
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Trefferquote">{formatPercent(run.winRate)}</td>
                    <td data-label="Ø Kursänd. nach 1 Tag">
                      {formatPercent(run.avgReturnAfter1d)}
                    </td>
                    <td data-label="Gestartet" className="nowrap">
                      {formatDateTime(run.startedAt)}
                    </td>
                    <td data-label="Abgeschlossen" className="nowrap">
                      {run.finishedAt ? formatDateTime(run.finishedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}

import Link from "next/link";

import { AlignmentBadge, RiskBadge } from "../../../components/badges";
import { EmptyState, ErrorState } from "../../../components/empty-state";
import { RetryButton } from "../../../components/retry-button";
import { InfoHint, PageHeader, PageIntro, SectionCard } from "../../../components/ui";
import { describeApiError } from "../../../lib/api-error";
import { formatScore } from "../../../lib/format";
import {
  alignmentExplanation,
  assetTypeLabel,
  germanizeAnalysisText,
  timeframeLabel
} from "../../../lib/labels";
import {
  buildQuery,
  fetchApi,
  type MultiTimeframeAlignment,
  type MultiTimeframeScannerItem
} from "../../../lib/signalpilot-api";

const ASSET_TYPE_OPTIONS = [
  { value: "", label: "Alle Asset-Typen" },
  { value: "CRYPTO", label: "Krypto" },
  { value: "STOCK", label: "Aktien" },
  { value: "ETF", label: "ETF" }
];

const ALIGNMENT_OPTIONS: { value: "" | MultiTimeframeAlignment; label: string }[] = [
  { value: "", label: "Alle Ausrichtungen" },
  { value: "BULLISH_ALIGNED", label: "Beide Richtungen aufwärts" },
  { value: "BEARISH_ALIGNED", label: "Beide Richtungen abwärts" },
  { value: "MIXED", label: "Uneinheitlich" },
  { value: "SHORT_TERM_ONLY", label: "Nur kurzfristig" },
  { value: "HIGHER_TIMEFRAME_CONFIRMATION", label: "Längere Zeitebene bestätigt" },
  { value: "CONFLICT", label: "Widerspruch" },
  { value: "NO_EDGE", label: "Kein Vorteil" }
];

// Ausrichtungen, bei denen die Zeitebenen einander widersprechen — sie bestimmen
// den Gesamtzustand der Seite.
const CONFLICTING: Array<MultiTimeframeAlignment | string> = ["CONFLICT", "MIXED"];

type MultiTimeframePageProps = {
  searchParams: Promise<{
    assetType?: string;
    alignment?: string;
    watchlistOnly?: string;
  }>;
};

function timeframeList(values: string[]): string {
  if (values.length === 0) return "—";
  return values.map(timeframeLabel).join(" · ");
}

export default async function MultiTimeframePage({ searchParams }: MultiTimeframePageProps) {
  const params = await searchParams;
  const query = buildQuery({
    assetType: params.assetType,
    alignment: params.alignment,
    watchlistOnly: params.watchlistOnly
  });
  const result = await fetchApi<MultiTimeframeScannerItem[]>(
    `/scanner/multi-timeframe${query}`
  );
  const rows = result.data ?? [];
  const hasFilter = !!(params.assetType || params.alignment || params.watchlistOnly);
  const errorCopy = describeApiError(
    result.errorKind,
    result.error ?? "",
    "Die Zeitebenen-Auswertung"
  );

  const conflicting = rows.filter((row) =>
    CONFLICTING.includes(row.multiTimeframeSummary.alignment)
  );
  const aligned = rows.filter(
    (row) =>
      row.multiTimeframeSummary.alignment === "BULLISH_ALIGNED" ||
      row.multiTimeframeSummary.alignment === "BEARISH_ALIGNED"
  );

  // Zustand der Seite in einem Satz: Sind sich die Zeitebenen einig?
  const tone = result.error
    ? "bad"
    : rows.length === 0
      ? "neutral"
      : conflicting.length > 0
        ? "warn"
        : "good";
  const verdict = result.error
    ? "Auswertung nicht abrufbar."
    : rows.length === 0
      ? "Noch keine Zeitebenen-Auswertung vorhanden."
      : conflicting.length > 0
        ? `Bei ${conflicting.length} von ${rows.length} Werten widersprechen sich die Zeitebenen.`
        : `Alle ${rows.length} Werte zeigen über die Zeitebenen hinweg ein einheitliches Bild.`;
  const nextStep =
    rows.length === 0
      ? "Die Auswertung entsteht automatisch, sobald die Analyse-Pipeline Signale für mehrere Zeitebenen erzeugt hat."
      : conflicting.length > 0
        ? "Zuerst die Werte mit Widerspruch ansehen — dort ist das Bild am unklarsten."
        : aligned.length > 0
          ? "Werte mit übereinstimmender Richtung sind am ehesten weiter beobachtenswert."
          : "Kein Wert sticht heraus; ein Blick in den Markt-Radar lohnt eher.";

  return (
    <>
      <PageHeader
        eyebrow="Kontext"
        title="Zeitebenen"
        actions={
          <Link className="primary-link secondary-link" href="/dashboard/scanner">
            Markt-Radar
          </Link>
        }
      />

      <PageIntro
        purpose="Diese Seite vergleicht je Wert das kurzfristige mit dem übergeordneten Bild — 1 Stunde, 4 Stunden und 1 Tag."
        tone={tone}
        verdict={verdict}
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

      <form className="filter-bar" method="GET" style={{ marginBottom: 16 }}>
        <select defaultValue={params.assetType ?? ""} name="assetType">
          {ASSET_TYPE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select defaultValue={params.alignment ?? ""} name="alignment">
          {ALIGNMENT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <label className="check-filter">
          <input
            defaultChecked={params.watchlistOnly === "true"}
            name="watchlistOnly"
            type="checkbox"
            value="true"
          />
          Nur Watchlist
        </label>
        <button type="submit">Filtern</button>
        {hasFilter ? (
          <a href="/dashboard/multi-timeframe" className="section-link" style={{ alignSelf: "center" }}>
            Zurücksetzen
          </a>
        ) : null}
      </form>

      {!result.error && rows.length === 0 ? (
        <EmptyState
          title={
            hasFilter
              ? "Kein Wert passt zu diesem Filter."
              : "Noch keine Zeitebenen-Auswertung vorhanden."
          }
          description={
            hasFilter
              ? "Filter zurücksetzen oder eine andere Ausrichtung wählen."
              : "Sie entsteht automatisch, sobald für einen Wert Signale auf mehreren Zeitebenen vorliegen."
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <SectionCard
          title={`${rows.length} Wert${rows.length !== 1 ? "e" : ""}`}
          subtitle={
            hasFilter
              ? "Die Ansicht ist aktuell gefiltert. Widersprüchliche Zeitebenen stehen oben."
              : "Widersprüchliche Zeitebenen stehen oben."
          }
        >
          {/* Kartenliste statt breiter Tabelle: Die Einordnungstexte sind lang und
              wurden in der Tabelle am rechten Rand mitten im Wort abgeschnitten. */}
          <div className="tf-list">
            {[...rows]
              .sort((left, right) => {
                const leftConflict = CONFLICTING.includes(left.multiTimeframeSummary.alignment)
                  ? 0
                  : 1;
                const rightConflict = CONFLICTING.includes(right.multiTimeframeSummary.alignment)
                  ? 0
                  : 1;
                return (
                  leftConflict - rightConflict ||
                  (right.multiTimeframeSummary.alignmentScore ?? 0) -
                    (left.multiTimeframeSummary.alignmentScore ?? 0)
                );
              })
              .map((row) => {
                const mtf = row.multiTimeframeSummary;
                const explanation = alignmentExplanation(mtf.alignment);
                return (
                  <article className="tf-card" key={row.asset.id}>
                    <div className="tf-card-head">
                      <Link href={`/dashboard/assets/${encodeURIComponent(row.asset.symbol)}`}>
                        <span className="tf-card-symbol">{row.asset.symbol}</span>
                      </Link>
                      <span className="tf-card-type">{assetTypeLabel(row.asset.assetType)}</span>
                      <span className="tf-card-spacer" />
                      <span title={explanation ?? undefined}>
                        <AlignmentBadge value={mtf.alignment} />
                      </span>
                      <RiskBadge value={mtf.riskLevel} />
                    </div>

                    {/* Der asset-spezifische Text ist aussagekräftiger als die generische
                        Erklärung — die steht nur noch als Tooltip am Badge. */}
                    {mtf.summary ? (
                      <p className="tf-card-summary">{germanizeAnalysisText(mtf.summary)}</p>
                    ) : explanation ? (
                      <p className="tf-card-summary">{explanation}</p>
                    ) : null}

                    {mtf.nextFocus ? (
                      <p className="tf-card-next">
                        <strong>Nächster Fokus:</strong>{" "}
                        {germanizeAnalysisText(mtf.nextFocus)}
                      </p>
                    ) : null}

                    <div className="tf-card-facts">
                      <span className="tf-fact">
                        <span className="tf-fact-label">
                          Übereinstimmung
                          <InfoHint text="Wie stark die Zeitebenen dasselbe Bild zeigen — 0 bis 100. Höher bedeutet einheitlicher." />
                        </span>
                        <span className="tf-fact-value">
                          {formatScore(mtf.alignmentScore)} / 100
                        </span>
                      </span>
                      <span className="tf-fact">
                        <span className="tf-fact-label">
                          Führend
                          <InfoHint text="Die Zeitebene, die das Gesamtbild derzeit bestimmt." />
                        </span>
                        <span className="tf-fact-value">
                          {timeframeLabel(mtf.primaryTimeframe)}
                        </span>
                      </span>
                      <span className="tf-fact">
                        <span className="tf-fact-label">Bestätigend</span>
                        <span className="tf-fact-value">
                          {timeframeList(mtf.confirmingTimeframes)}
                        </span>
                      </span>
                      <span className="tf-fact">
                        <span className="tf-fact-label">Widerspruch</span>
                        <span
                          className={`tf-fact-value${
                            mtf.conflictingTimeframes.length > 0
                              ? " tf-fact-value--conflict"
                              : ""
                          }`}
                        >
                          {timeframeList(mtf.conflictingTimeframes)}
                        </span>
                      </span>
                    </div>
                  </article>
                );
              })}
          </div>
        </SectionCard>
      ) : null}
    </>
  );
}

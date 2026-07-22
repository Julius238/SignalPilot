import Link from "next/link";

import { EmptyState } from "../empty-state";
import { formatDateTime, formatRelativeTime } from "../../lib/format";
import { severityLabel, severityTone, type Severity } from "./shared";

// "Wichtig jetzt": das Erste, was nach dem Lagebild gelesen wird.
// Jede Karte beantwortet drei Fragen: Was ist passiert? Warum ist es
// relevant? Was könnte es bedeuten? — Auswirkungen kommen aus der
// regelbasierten Impact-Engine und bleiben ausdrücklich "möglich".

export type PriorityKind = "event" | "radar" | "chart";

const kindLabels: Record<PriorityKind, string> = {
  event: "Weltgeschehen",
  radar: "Marktbewegung",
  chart: "Chartbild"
};

export type PriorityItem = {
  id: string;
  kind: PriorityKind;
  severity: Severity;
  title: string;
  note?: string | null;
  impactPos?: string[];
  impactNeg?: string[];
  showOpenImpact?: boolean;
  meta: string;
  time: string;
  href?: string;
  externalUrl?: string | null;
};

export function PriorityFeed({ items, now }: { items: PriorityItem[]; now: Date }) {
  return (
    <section className="cmd-section" aria-label="Wichtig jetzt" id="wichtig-jetzt">
      <div className="section-header">
        <h2 className="section-title">Wichtig jetzt</h2>
        <span className="muted small">keine Handlungsempfehlung</span>
        <p className="section-subtitle">
          Was das System aktuell für relevant hält — und was es bedeuten könnte.
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState
          tone="calm"
          title="Gerade ist nichts dringend."
          description="Sobald das System eine wichtige Entwicklung erkennt, erscheint sie hier ganz oben — mit Einordnung und möglichen Auswirkungen."
        />
      ) : (
        <ol className="story-list">
          {items.map((item) => (
            <StoryCard key={item.id} item={item} now={now} />
          ))}
        </ol>
      )}
    </section>
  );
}

function StoryCard({ item, now }: { item: PriorityItem; now: Date }) {
  const tone = severityTone(item.severity);
  const hasImpacts =
    (item.impactPos?.length ?? 0) > 0 || (item.impactNeg?.length ?? 0) > 0;

  return (
    <li className={`story-card story-card--${tone}`}>
      <div className="story-head">
        <span className={`sev-chip sev-chip--${tone}`}>{severityLabel(item.severity)}</span>
        <span className="story-kind">{kindLabels[item.kind]}</span>
        <span className="story-time" title={formatDateTime(item.time)}>
          {formatRelativeTime(item.time, now)}
        </span>
      </div>

      <h3 className="story-title">
        {item.externalUrl ? (
          <a href={item.externalUrl} target="_blank" rel="noreferrer noopener">
            {item.title}
          </a>
        ) : item.href ? (
          <Link href={item.href}>{item.title}</Link>
        ) : (
          item.title
        )}
      </h3>

      {item.note ? <p className="story-note">{item.note}</p> : null}

      {hasImpacts ? (
        <div className="story-impacts">
          <span className="story-impacts-label">Mögliche Auswirkung:</span>
          {(item.impactPos ?? []).slice(0, 3).map((area) => (
            <span key={`pos-${area}`} className="impact-chip impact-chip--pos">
              <span aria-hidden="true">↗</span> {area}
            </span>
          ))}
          {(item.impactNeg ?? []).slice(0, 3).map((area) => (
            <span key={`neg-${area}`} className="impact-chip impact-chip--neg">
              <span aria-hidden="true">↘</span> {area}
            </span>
          ))}
        </div>
      ) : item.showOpenImpact ? (
        <div className="story-impacts">
          <span className="story-impacts-label">Mögliche Auswirkung:</span>
          <span className="impact-chip impact-chip--open">
            noch unklar — keine sichere Regel-Zuordnung
          </span>
        </div>
      ) : null}

      <div className="story-meta">{item.meta}</div>
    </li>
  );
}

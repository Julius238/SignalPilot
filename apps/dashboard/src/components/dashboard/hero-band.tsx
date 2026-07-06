import Link from "next/link";

import { RegimeBadge, RiskModeBadge } from "../badges";
import { formatDateTime } from "../../lib/format";
import type { MarketRegimeSnapshot } from "../../lib/signalpilot-api";

// Hero-Band: beantwortet auf einen Blick "Wie ist die Marktlage?" und
// liefert die vier Kernzahlen des Tages. Details liegen auf den Unterseiten.

export type HeroMetric = {
  label: string;
  value: string | number;
  sub?: string;
  href: string;
  tone?: string;
};

export function HeroBand({
  regime,
  metrics
}: {
  regime: MarketRegimeSnapshot | null | undefined;
  metrics: HeroMetric[];
}) {
  return (
    <section className="hero-band" aria-label="Marktlage">
      <div className="hero-regime">
        <span className="hero-label">Marktlage</span>
        {regime ? (
          <>
            <div className="hero-regime-badges">
              <RegimeBadge value={regime.overallRegime} />
              <RiskModeBadge value={regime.riskMode} />
            </div>
            <div className="hero-regime-meta">
              <span>Konfidenz {Math.round(regime.confidence * 100)}%</span>
              <span className="muted small" title={formatDateTime(regime.generatedAt)}>
                <Link href="/dashboard/market-regime" className="section-link">
                  Details →
                </Link>
              </span>
            </div>
            {regime.riskNote ? (
              <p className="hero-risk-note">
                {regime.riskNote.slice(0, 140)}
                {regime.riskNote.length > 140 ? "…" : ""}
              </p>
            ) : null}
          </>
        ) : (
          <p className="muted small">Markt-Regime noch nicht berechnet.</p>
        )}
      </div>
      <div className="hero-metrics">
        {metrics.map((metric) => (
          <Link key={metric.label} href={metric.href} className="hero-metric">
            <span className="metric-label">{metric.label}</span>
            <strong className="metric-value" style={{ color: metric.tone }}>
              {metric.value}
            </strong>
            {metric.sub ? <span className="muted small">{metric.sub}</span> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

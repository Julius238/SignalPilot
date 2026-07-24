import Link from "next/link";

import { RegimeBadge, RiskModeBadge } from "../badges";
import { confidenceWords, regimeSentence } from "./shared";
import type { MarketRegimeSnapshot } from "../../lib/signalpilot-api";

// Lagebild: beantwortet "Wie ist die Lage?" in einem Satz, den jeder versteht.
// Der Puls-Satz wird aus den echten Daten gebaut (page.tsx) und funktioniert
// auch dann, wenn die automatische Regime-Einschätzung noch fehlt.

export type HeroMetric = {
  label: string;
  value: string | number;
  sub?: string;
  href: string;
  tone?: string;
};

export function HeroBand({
  pulse,
  context,
  regime,
  metrics
}: {
  pulse: string;
  context: string | null;
  regime: MarketRegimeSnapshot | null | undefined;
  metrics: HeroMetric[];
}) {
  const confidence = confidenceWords(regime?.confidence);

  return (
    <section className="lagebild" aria-label="Marktlage">
      <div>
        <span className="lagebild-kicker">Lagebild</span>
        <p className="lagebild-pulse">{pulse}</p>
        {context ? <p className="lagebild-sub">{context}</p> : null}
        <div className="lagebild-badges">
          {regime ? (
            <>
              <RegimeBadge value={regime.overallRegime} />
              <RiskModeBadge value={regime.riskMode} />
              {confidence ? <span className="confidence-copy">{confidence}</span> : null}
              <Link href="/dashboard/market-regime" className="section-link">
                Marktlage verstehen
              </Link>
            </>
          ) : (
            <span className="muted small">
              Die automatische Markt-Einschätzung liegt noch nicht vor — sie ergänzt dieses Bild,
              sobald sie berechnet wurde.
            </span>
          )}
        </div>
        {regimeSentence(regime?.overallRegime) ? (
          <p className="regime-explanation">{regimeSentence(regime?.overallRegime)}</p>
        ) : null}
      </div>
      <div className="lagebild-metrics">
        {metrics.map((metric) => (
          <Link key={metric.label} href={metric.href} className="lagebild-metric">
            <span className="lagebild-metric-value" style={{ color: metric.tone }}>
              {metric.value}
            </span>
            <span className="lagebild-metric-label">{metric.label}</span>
            {metric.sub ? <span className="lagebild-metric-sub">{metric.sub}</span> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

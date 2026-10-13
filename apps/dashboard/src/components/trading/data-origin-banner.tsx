import { fetchMarketDataOrigin } from "../../lib/trading-api";

/**
 * Says loudly when the strategy currently decides on SYNTHETIC candles (dev
 * feed or scenario): signals, trades and P&L on these pages are then a
 * pipeline demonstration, not a statement about real markets.
 */
export async function DataOriginBanner() {
  const origin = await fetchMarketDataOrigin();
  const synthetic = (origin.data ?? []).filter((row) => row.synthetic);
  if (synthetic.length === 0) return null;
  return (
    <div className="shadow-banner data-origin-banner" role="alert">
      <strong>SYNTHETISCHE MARKTDATEN</strong>
      <span>
        {synthetic.map((row) => row.symbol).join(", ")}: Kerzen stammen aus dem Entwicklungs-Feed (Quelle SYNTHETIC).
        Signale, Trades und P&amp;L auf diesen Seiten demonstrieren die Pipeline — sie sind keine Ergebnisse auf
        echten Marktdaten.
      </span>
    </div>
  );
}

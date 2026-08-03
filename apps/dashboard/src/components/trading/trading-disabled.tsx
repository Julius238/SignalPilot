export function TradingDisabled() {
  return (
    <div className="trading-disabled" role="status">
      <strong>Shadow Trading ist deaktiviert.</strong>
      <span>
        NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED ist nicht gesetzt oder auf false — es werden keine
        Trading-Seiten angezeigt und keine Trading-API-Aufrufe ausgeführt.
      </span>
    </div>
  );
}

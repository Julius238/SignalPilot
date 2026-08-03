import type { ReactNode } from "react";

import { PageHeader } from "../../../components/ui";
import { ShadowBanner } from "../../../components/trading/shadow-banner";
import { TradingDisabled } from "../../../components/trading/trading-disabled";
import { TradingSubnav } from "../../../components/trading/trading-nav";
import { TRADING_DASHBOARD_ENABLED } from "../../../lib/trading-flag";

// Wenn das Flag aus ist, wird `children` (die eigentliche Seite mit ihren
// fetchApi-Aufrufen) hier nicht gerendert — React ruft eine Server-Component-
// Funktion erst auf, wenn sie tatsächlich Teil des zurückgegebenen Baums ist.
// Damit lösen deaktivierte Trading-Seiten keine /trading/*-Requests aus.
export default function TradingLayout({ children }: { children: ReactNode }) {
  if (!TRADING_DASHBOARD_ENABLED) {
    return (
      <>
        <PageHeader
          eyebrow="Shadow Trading"
          title="Shadow Trading"
          subtitle="Keine echten Börsenorders"
        />
        <TradingDisabled />
      </>
    );
  }

  return (
    <>
      <ShadowBanner />
      <TradingSubnav />
      {children}
    </>
  );
}

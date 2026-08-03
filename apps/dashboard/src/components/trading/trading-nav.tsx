"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: Array<{ href: string; label: string }> = [
  { href: "/dashboard/trading", label: "Übersicht" },
  { href: "/dashboard/trading/candidates", label: "Kandidaten" },
  { href: "/dashboard/trading/positions", label: "Positionen" },
  { href: "/dashboard/trading/orders", label: "Orders & Fills" },
  { href: "/dashboard/trading/performance", label: "Performance" },
  { href: "/dashboard/trading/risk", label: "Risiko" },
  { href: "/dashboard/trading/audit", label: "Audit" },
  { href: "/dashboard/trading/operations", label: "Operations" }
];

export function TradingSubnav() {
  const pathname = usePathname();

  return (
    <nav className="trading-subnav" aria-label="Shadow-Trading-Bereiche">
      {TABS.map((tab) => {
        const active =
          tab.href === "/dashboard/trading" ? pathname === tab.href : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

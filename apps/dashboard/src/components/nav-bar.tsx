"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";

type NavItem = { href: string; label: string; exact?: boolean };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Command",
    items: [
      { href: "/dashboard", label: "Overview", exact: true },
      { href: "/dashboard/scanner", label: "Scanner" },
      { href: "/dashboard/signals", label: "Signals" },
      { href: "/dashboard/assets", label: "Assets" },
      { href: "/dashboard/watchlist", label: "Watchlist" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/dashboard/market-regime", label: "Regime" },
      { href: "/dashboard/news", label: "News" },
      { href: "/dashboard/events", label: "Events" },
      { href: "/dashboard/multi-timeframe", label: "Multi-TF" },
      { href: "/dashboard/rules", label: "Rules" },
    ],
  },
  {
    label: "Research",
    items: [
      { href: "/dashboard/backtests", label: "Backtests" },
      { href: "/dashboard/strategy-lab", label: "Strategy Lab" },
      { href: "/dashboard/paper", label: "Paper Eval" },
      { href: "/dashboard/performance", label: "Performance" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/dashboard/data-quality", label: "Daten" },
      { href: "/dashboard/operations", label: "Ops" },
      { href: "/dashboard/logs", label: "Logs" },
      { href: "/dashboard/audit-logs", label: "Audit" },
    ],
  },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function NavBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="top-nav">
      <Link className="brand" href="/dashboard" onClick={() => setOpen(false)}>
        SignalPilot
      </Link>

      <nav
        className={`nav-groups${open ? " nav-groups--open" : ""}`}
        aria-label="Hauptnavigation"
      >
        {NAV_GROUPS.map((group, i) => (
          <Fragment key={group.label}>
            {i > 0 && <div className="nav-sep" aria-hidden="true" />}
            <div className="nav-group">
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link${isActive(pathname, item.href, item.exact) ? " active" : ""}`}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </Fragment>
        ))}
      </nav>

      <div className="nav-actions">
        <button
          aria-expanded={open}
          aria-label={open ? "Navigation schließen" : "Navigation öffnen"}
          className="nav-mobile-toggle"
          type="button"
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true">{open ? "✕" : "☰"}</span>
        </button>
        <LogoutButton />
      </div>
    </header>
  );
}

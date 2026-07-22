"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";

type NavItem = { href: string; label: string; exact?: boolean };

// Navigation nach Nutzer-Aufgaben statt Systemmodulen:
// "Was ist los?" → Übersicht · "Was macht der Markt?" → Märkte ·
// "Was passiert in der Welt?" → Weltlage · Analyse → Research · Betrieb → System.
const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "Übersicht", exact: true }],
  },
  {
    label: "Märkte",
    items: [
      { href: "/dashboard/scanner", label: "Scanner" },
      { href: "/dashboard/signals", label: "Signale" },
      { href: "/dashboard/assets", label: "Assets" },
      { href: "/dashboard/watchlist", label: "Watchlist" },
    ],
  },
  {
    label: "Weltlage",
    items: [
      { href: "/dashboard/market-regime", label: "Marktlage" },
      { href: "/dashboard/news", label: "News" },
      { href: "/dashboard/events", label: "Termine" },
      { href: "/dashboard/multi-timeframe", label: "Zeitebenen" },
      { href: "/dashboard/rules", label: "Regeln" },
    ],
  },
  {
    label: "Research",
    items: [
      { href: "/dashboard/backtests", label: "Backtests" },
      { href: "/dashboard/strategy-lab", label: "Strategie-Labor" },
      { href: "/dashboard/paper", label: "Paper-Auswertung" },
      { href: "/dashboard/performance", label: "Performance" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/dashboard/data-quality", label: "Datenqualität" },
      { href: "/dashboard/operations", label: "Betrieb" },
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
          <Fragment key={group.label ?? "start"}>
            {i > 0 && <div className="nav-sep" aria-hidden="true" />}
            <div className="nav-group">
              {group.label ? (
                <span className="nav-group-label">{group.label}</span>
              ) : null}
              {group.items.map((item) => {
                const active = isActive(pathname, item.href, item.exact);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`nav-link${active ? " active" : ""}`}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                );
              })}
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

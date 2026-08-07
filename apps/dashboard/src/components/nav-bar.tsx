"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { LogoutButton } from "./logout-button";
import { TRADING_DASHBOARD_ENABLED } from "../lib/trading-flag";

type IconName =
  | "overview"
  | "radar"
  | "discovery"
  | "signal"
  | "asset"
  | "watchlist"
  | "regime"
  | "news"
  | "calendar"
  | "layers"
  | "rules"
  | "paper"
  | "performance"
  | "backtest"
  | "lab"
  | "quality"
  | "system"
  | "logs"
  | "audit"
  | "trading";

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: IconName;
  exact?: boolean;
};

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Lage",
    items: [
      {
        href: "/dashboard",
        label: "Command Center",
        description: "Das Wichtigste zuerst",
        icon: "overview",
        exact: true
      }
    ]
  },
  {
    label: "Beobachten",
    items: [
      {
        href: "/dashboard/discovery",
        label: "Markt entdecken",
        description: "Dynamisches Asset-Universum",
        icon: "discovery"
      },
      {
        href: "/dashboard/scanner",
        label: "Markt-Radar",
        description: "Chancen und Auffälligkeiten",
        icon: "radar"
      },
      {
        href: "/dashboard/signals",
        label: "Signale",
        description: "Aktuelle Beobachtungen",
        icon: "signal"
      },
      {
        href: "/dashboard/watchlist",
        label: "Meine Watchlist",
        description: "Persönlicher Fokus",
        icon: "watchlist"
      },
      {
        href: "/dashboard/assets",
        label: "Märkte & Assets",
        description: "Instrumente im Detail",
        icon: "asset"
      }
    ]
  },
  {
    label: "Kontext",
    items: [
      {
        href: "/dashboard/market-regime",
        label: "Marktlage",
        description: "Umfeld und Risikoklima",
        icon: "regime"
      },
      {
        href: "/dashboard/news",
        label: "Weltlage",
        description: "Karte, Ereignisse und Nachrichten",
        icon: "news"
      },
      {
        href: "/dashboard/events",
        label: "Unternehmenstermine",
        description: "Earnings und Kalender",
        icon: "calendar"
      },
      {
        href: "/dashboard/multi-timeframe",
        label: "Zeitebenen",
        description: "Kurz- und langfristiges Bild",
        icon: "layers"
      }
    ]
  },
  {
    label: "Research",
    items: [
      {
        href: "/dashboard/paper",
        label: "Paper-Auswertung",
        description: "Signale rückblickend prüfen",
        icon: "paper"
      },
      {
        href: "/dashboard/performance",
        label: "Performance",
        description: "Was bislang funktioniert",
        icon: "performance"
      },
      {
        href: "/dashboard/backtests",
        label: "Backtests",
        description: "Historische Prüfungen",
        icon: "backtest"
      },
      {
        href: "/dashboard/strategy-lab",
        label: "Strategie-Labor",
        description: "Regelwerke vergleichen",
        icon: "lab"
      },
      {
        href: "/dashboard/rules",
        label: "Signalregeln",
        description: "Bewertungen nachvollziehen",
        icon: "rules"
      }
    ]
  },
  {
    label: "System",
    items: [
      {
        href: "/dashboard/data-quality",
        label: "Datenqualität",
        description: "Abdeckung und Frische",
        icon: "quality"
      },
      {
        href: "/dashboard/operations",
        label: "Systemstatus",
        description: "Worker und Zustellung",
        icon: "system"
      },
      {
        href: "/dashboard/logs",
        label: "Ausführungsprotokoll",
        description: "Technische Details",
        icon: "logs"
      },
      {
        href: "/dashboard/audit-logs",
        label: "Audit",
        description: "Administrative Änderungen",
        icon: "audit"
      }
    ]
  },
  // Nur sichtbar, wenn NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED=true — sonst
  // keine Navigation, keine erreichbare Route, keine Trading-API-Aufrufe.
  ...(TRADING_DASHBOARD_ENABLED
    ? [
        {
          label: "Shadow Trading",
          items: [
            {
              href: "/dashboard/trading",
              label: "Shadow Trading",
              description: "Keine echten Börsenorders",
              icon: "trading" as const
            }
          ]
        }
      ]
    : [])
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Escape schließt das Menü, Tab bleibt darin gefangen. Ohne die Fokusfalle
  // wandert der Fokus hinter das Overlay in Inhalte, die dort nicht bedienbar
  // sein sollen — für Tastatur- und Screenreader-Nutzer wäre das Menü dann offen,
  // die Bedienung aber unsichtbar woanders.
  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        toggleRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      // Der Umschalter gehört zum Menü, steht im DOM aber davor.
      const first = toggleRef.current ?? focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // Der Hintergrund darf nicht mitscrollen, solange das Menü ihn verdeckt.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <aside className={`side-nav${open ? " side-nav--open" : ""}`}>
      <div className="side-nav-top">
        <Link className="brand" href="/dashboard" onClick={close}>
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-copy">
            <strong>SignalPilot</strong>
            <small>Market Intelligence</small>
          </span>
        </Link>
        <button
          ref={toggleRef}
          aria-expanded={open}
          aria-controls="hauptnavigation"
          aria-label={open ? "Navigation schließen" : "Navigation öffnen"}
          className="nav-mobile-toggle"
          type="button"
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true">{open ? "×" : "☰"}</span>
        </button>
      </div>

      {/* Eigener Abdunkler über dem Seiteninhalt: macht sichtbar, dass der
          Hintergrund pausiert ist, und schließt das Menü bei Klick daneben.
          `aria-hidden`, weil Escape und der Umschalter denselben Zweck erfüllen. */}
      {open ? (
        <div className="side-nav-scrim" aria-hidden="true" onClick={close} />
      ) : null}

      <div
        id="hauptnavigation"
        ref={panelRef}
        className={`side-nav-panel${open ? " side-nav-panel--open" : ""}`}
      >
        <nav className="nav-groups" aria-label="Hauptnavigation">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              <div className="nav-group-items">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href, item.exact);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`nav-link${active ? " active" : ""}`}
                      onClick={close}
                    >
                      <NavIcon name={item.icon} />
                      <span className="nav-link-copy">
                        <span>{item.label}</span>
                        <small>{item.description}</small>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="side-nav-footer">
          <Link href="/dashboard/operations" className="nav-health" onClick={close}>
            <span className="nav-health-dot" aria-hidden="true" />
            <span>
              <strong>Systemübersicht</strong>
              <small>Worker, Daten und Alerts</small>
            </span>
          </Link>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}

function NavIcon({ name }: { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7
  };

  const paths: Record<IconName, React.ReactNode> = {
    overview: (
      <>
        <path d="M3 11.5 11 4l8 7.5" />
        <path d="M5.5 10.5V19h11v-8.5M9 19v-5h4v5" />
      </>
    ),
    radar: (
      <>
        <circle cx="11" cy="11" r="8" />
        <path d="m11 11 5-5M11 3v2M19 11h-2M11 19v-2M3 11h2" />
      </>
    ),
    discovery: (
      <>
        <circle cx="11" cy="11" r="8" />
        <path d="m14.5 7.5-2 5-5 2 2-5 5-2Z" />
        <path d="M11 3v2M19 11h-2M11 19v-2M3 11h2" />
      </>
    ),
    signal: <path d="M3 15h3l2-8 4 12 3-9 2 5h2" />,
    asset: (
      <>
        <path d="M4 18V9M9 18V5M14 18v-7M19 18V3" />
        <path d="M2.5 18.5h18" />
      </>
    ),
    watchlist: <path d="m11 3 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8Z" />,
    regime: (
      <>
        <path d="M3 16c3-6 5 2 8-4s5 2 8-5" />
        <path d="M3 19h16" />
      </>
    ),
    news: (
      <>
        <path d="M5 4h12v15H5z" />
        <path d="M8 8h6M8 11h6M8 14h4" />
      </>
    ),
    calendar: (
      <>
        <rect x="3.5" y="5.5" width="15" height="13" rx="2" />
        <path d="M7 3v5M15 3v5M3.5 10h15" />
      </>
    ),
    layers: <path d="m11 3 8 4-8 4-8-4 8-4Zm-8 8 8 4 8-4M3 15l8 4 8-4" />,
    rules: (
      <>
        <path d="M5 4v14M11 4v14M17 4v14" />
        <circle cx="5" cy="8" r="2" />
        <circle cx="11" cy="14" r="2" />
        <circle cx="17" cy="7" r="2" />
      </>
    ),
    paper: (
      <>
        <path d="M5 3h9l3 3v13H5z" />
        <path d="M14 3v4h4M8 11h6M8 14h5" />
      </>
    ),
    performance: <path d="M4 18V8M9 18v-5M14 18V4M19 18v-8" />,
    backtest: (
      <>
        <path d="M4 7v5h5" />
        <path d="M5.5 15.5A7 7 0 1 0 5 7" />
      </>
    ),
    lab: (
      <>
        <path d="M8 3h6M9 3v6l-5 8a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-8V3" />
        <path d="M7 14h8" />
      </>
    ),
    quality: (
      <>
        <path d="m11 3 7 3v5c0 4.5-2.8 7.3-7 9-4.2-1.7-7-4.5-7-9V6l7-3Z" />
        <path d="m8 11 2 2 4-4" />
      </>
    ),
    system: (
      <>
        <circle cx="11" cy="11" r="3" />
        <path d="M11 3v2M11 17v2M3 11h2M17 11h2M5.3 5.3l1.4 1.4M15.3 15.3l1.4 1.4M16.7 5.3l-1.4 1.4M6.7 15.3l-1.4 1.4" />
      </>
    ),
    logs: <path d="M5 5h14M5 11h14M5 17h14M2 5h.1M2 11h.1M2 17h.1" />,
    audit: (
      <>
        <path d="M5 3h12v16H5z" />
        <path d="m8 11 2 2 4-4M8 6h6" />
      </>
    ),
    trading: (
      <>
        <path d="M4 17V9l4-4 4 4 6-7" />
        <path d="M14 2h4v4" />
      </>
    )
  };

  return (
    <svg aria-hidden="true" className="nav-icon" viewBox="0 0 22 22" {...common}>
      {paths[name]}
    </svg>
  );
}

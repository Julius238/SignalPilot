import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LogoutButton } from "../components/logout-button";
import "./globals.css";

export const metadata: Metadata = {
  title: "SignalPilot Dashboard",
  description: "Internal market intelligence dashboard for SignalPilot"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const authDisabled =
    process.env.API_AUTH_ENABLED === "false" ||
    process.env.DASHBOARD_AUTH_ENABLED === "false";

  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          {authDisabled ? (
            <div className="auth-warning">
              Auth disabled — do not expose this dashboard publicly.
            </div>
          ) : null}
          <header className="top-nav">
            <Link className="brand" href="/dashboard">
              SignalPilot
            </Link>
            <nav className="nav-groups">
              <div className="nav-group">
                <span className="nav-group-label">Command</span>
                <Link href="/dashboard">Overview</Link>
                <Link href="/dashboard/scanner">Scanner</Link>
                <Link href="/dashboard/signals">Signals</Link>
                <Link href="/dashboard/assets">Assets</Link>
                <Link href="/dashboard/watchlist">Watchlist</Link>
              </div>
              <div className="nav-sep" aria-hidden="true" />
              <div className="nav-group">
                <span className="nav-group-label">Intelligence</span>
                <Link href="/dashboard/market-regime">Regime</Link>
                <Link href="/dashboard/news">News</Link>
                <Link href="/dashboard/events">Events</Link>
                <Link href="/dashboard/multi-timeframe">Multi-TF</Link>
                <Link href="/dashboard/rules">Rules</Link>
              </div>
              <div className="nav-sep" aria-hidden="true" />
              <div className="nav-group">
                <span className="nav-group-label">Research</span>
                <Link href="/dashboard/backtests">Backtests</Link>
                <Link href="/dashboard/strategy-lab">Strategy Lab</Link>
                <Link href="/dashboard/paper">Paper Eval</Link>
                <Link href="/dashboard/performance">Performance</Link>
              </div>
              <div className="nav-sep" aria-hidden="true" />
              <div className="nav-group">
                <span className="nav-group-label">System</span>
                <Link href="/dashboard/data-quality">Data Quality</Link>
                <Link href="/dashboard/logs">Logs</Link>
                <Link href="/dashboard/audit-logs">Audit</Link>
              </div>
            </nav>
            <div className="nav-actions">
              <LogoutButton />
            </div>
          </header>
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}

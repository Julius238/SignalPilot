import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "SignalPilot Dashboard",
  description: "Internal market intelligence dashboard for SignalPilot"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // TODO: Add dashboard authentication before production exposure.
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="top-nav">
            <Link className="brand" href="/dashboard">
              SignalPilot
            </Link>
            <nav>
              <Link href="/dashboard">Overview</Link>
              <Link href="/dashboard/watchlist">Watchlist</Link>
              <Link href="/dashboard/scanner">Scanner</Link>
              <Link href="/dashboard/multi-timeframe">Multi-Timeframe</Link>
              <Link href="/dashboard/signals">Signals</Link>
              <Link href="/dashboard/paper">Paper Eval</Link>
              <Link href="/dashboard/performance">Performance</Link>
              <Link href="/dashboard/data-quality">Data Quality</Link>
              <Link href="/dashboard/assets">Assets</Link>
              <Link href="/dashboard/logs">Logs</Link>
            </nav>
          </header>
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}

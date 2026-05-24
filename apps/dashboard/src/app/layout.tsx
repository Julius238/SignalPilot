import type { Metadata } from "next";
import type { ReactNode } from "react";

import { NavBar } from "../components/nav-bar";
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
          <NavBar />
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}

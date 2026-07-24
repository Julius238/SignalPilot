import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";

import { AppShell } from "../components/app-shell";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter"
});

export const metadata: Metadata = {
  title: "SignalPilot",
  description: "Marktbeobachtung und Ereignis-Radar für Research-Zwecke"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const authDisabled =
    process.env.API_AUTH_ENABLED === "false" ||
    process.env.DASHBOARD_AUTH_ENABLED === "false";

  return (
    <html lang="de" className={inter.variable}>
      <body>
        <AppShell authDisabled={authDisabled}>{children}</AppShell>
      </body>
    </html>
  );
}

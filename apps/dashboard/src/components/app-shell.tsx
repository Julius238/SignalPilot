"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { NavBar } from "./nav-bar";

export function AppShell({
  authDisabled,
  children
}: {
  authDisabled: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  if (isLoginPage) {
    return <main className="auth-page-content">{children}</main>;
  }

  return (
    <div className="app-shell">
      <NavBar />
      {authDisabled ? (
        <div className="auth-warning">
          Login ist deaktiviert — dieses Dashboard nicht öffentlich erreichbar machen.
        </div>
      ) : null}
      <main className="page">{children}</main>
    </div>
  );
}

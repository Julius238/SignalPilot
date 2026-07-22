"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { browserApiUrl } from "../lib/api-url";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch(`${browserApiUrl}/auth/logout`, {
        method: "POST",
        credentials: "include"
      });
    } finally {
      router.replace("/login");
    }
  }

  return (
    <button className="logout-button" disabled={pending} onClick={handleLogout} type="button">
      {pending ? "…" : "Abmelden"}
    </button>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const apiUrl = process.env.NEXT_PUBLIC_SIGNALPILOT_API_URL ?? "http://localhost:3100";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch(`${apiUrl}/auth/logout`, {
        method: "POST",
        credentials: "include"
      });
    } finally {
      router.replace("/login");
    }
  }

  return (
    <button className="logout-button" disabled={pending} onClick={handleLogout} type="button">
      {pending ? "…" : "Sign out"}
    </button>
  );
}

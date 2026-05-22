"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const apiUrl = process.env.NEXT_PUBLIC_SIGNALPILOT_API_URL ?? "http://localhost:3100";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: formData.get("username"),
          password: formData.get("password")
        })
      });

      if (!response.ok) {
        setError("Invalid credentials. Please try again.");
        setPending(false);
        return;
      }

      router.replace("/dashboard");
    } catch {
      setError("Unable to reach API. Please check your connection.");
      setPending(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>SignalPilot</h1>
        <p className="login-subtitle">Sign in to continue</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              autoComplete="username"
              autoFocus
              disabled={pending}
              name="username"
              required
              type="text"
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              disabled={pending}
              name="password"
              required
              type="password"
            />
          </label>
          {error ? <p className="form-message form-message-error">{error}</p> : null}
          <button disabled={pending} type="submit">
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

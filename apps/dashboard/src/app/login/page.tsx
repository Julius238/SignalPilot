"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { browserApiUrl } from "../../lib/api-url";
import { redirectAfterLogin } from "../../lib/login-redirect";

type AuthStatus = {
  authenticated?: boolean;
  devLoginEnabled?: boolean;
};

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [devPending, setDevPending] = useState(false);
  const [devLoginEnabled, setDevLoginEnabled] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const redirectStarted = useRef(false);

  const redirectToDashboard = useCallback(() => {
    if (redirectStarted.current) return;

    redirectStarted.current = true;
    setPending(false);
    setDevPending(false);
    setRedirecting(true);
    redirectAfterLogin(router);
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function loadAuthStatus() {
      try {
        const response = await fetch(`${browserApiUrl}/auth/status`, {
          credentials: "include",
          cache: "no-store"
        });
        if (!response.ok) return;
        const status = (await response.json()) as AuthStatus;
        if (cancelled) return;
        if (status.authenticated === true) {
          redirectToDashboard();
          return;
        }
        setDevLoginEnabled(status.devLoginEnabled === true);
      } catch {
        if (!cancelled) setDevLoginEnabled(false);
      }
    }

    void loadAuthStatus();

    return () => {
      cancelled = true;
    };
  }, [redirectToDashboard]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch(`${browserApiUrl}/auth/login`, {
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

      redirectToDashboard();
    } catch {
      setError("Unable to reach API. Please check your connection.");
      setPending(false);
    }
  }

  async function handleDevLogin() {
    setDevPending(true);
    setError(null);

    try {
      const response = await fetch(`${browserApiUrl}/auth/dev-login`, {
        method: "POST",
        credentials: "include"
      });

      if (!response.ok) {
        setError("Dev login is not available.");
        setDevPending(false);
        return;
      }

      redirectToDashboard();
    } catch {
      setError("Unable to reach API. Please check your connection.");
      setDevPending(false);
    }
  }

  if (redirecting) return null;

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
        {devLoginEnabled ? (
          <button
            className="dev-login-button"
            disabled={pending || devPending}
            onClick={handleDevLogin}
            type="button"
          >
            {devPending ? "Continuing…" : "Continue in Dev Mode"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

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
        setError("Benutzername oder Passwort stimmt nicht. Bitte erneut versuchen.");
        setPending(false);
        return;
      }

      redirectToDashboard();
    } catch {
      setError("Die SignalPilot-API ist nicht erreichbar. Bitte Verbindung prüfen.");
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
        setError("Die Entwickler-Anmeldung ist nicht verfügbar.");
        setDevPending(false);
        return;
      }

      redirectToDashboard();
    } catch {
      setError("Die SignalPilot-API ist nicht erreichbar. Bitte Verbindung prüfen.");
      setDevPending(false);
    }
  }

  if (redirecting) return null;

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>SignalPilot</h1>
        <p className="login-subtitle">Zum Fortfahren bitte anmelden</p>
        {/* Labels stehen über den Feldern und beide Felder haben dieselbe Breite —
            vorher standen sie daneben und die Felder waren unterschiedlich breit. */}
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="login-username">
            <span className="login-label">Benutzername</span>
            <input
              autoComplete="username"
              autoFocus
              disabled={pending}
              id="login-username"
              name="username"
              required
              type="text"
            />
          </label>
          <label htmlFor="login-password">
            <span className="login-label">Passwort</span>
            <input
              autoComplete="current-password"
              disabled={pending}
              id="login-password"
              name="password"
              required
              type="password"
            />
          </label>
          {error ? (
            <p className="form-message form-message-error" role="alert">
              {error}
            </p>
          ) : null}
          <button disabled={pending} type="submit">
            {pending ? "Anmeldung läuft…" : "Anmelden"}
          </button>
        </form>
        <p className="login-note">
          SignalPilot hat genau einen Zugang. Es gibt keine Registrierung und keine
          Passwort-Zurücksetzung — bei Verlust wird das Passwort direkt am Server neu gesetzt.
        </p>
        {devLoginEnabled ? (
          // Bewusst als Textlink und nicht als Knopf: Der echte Login soll die
          // einzige prominente Aktion bleiben.
          <button
            className="dev-login-link"
            disabled={pending || devPending}
            onClick={handleDevLogin}
            type="button"
          >
            {devPending ? "Wird geöffnet…" : "Ohne Anmeldung fortfahren (nur lokale Entwicklung)"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

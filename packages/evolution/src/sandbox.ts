/**
 * Prepared extension: AI-generated strategy modules (NOT active in V1).
 *
 * V1 lets the AI change only closed parameter genomes. A later version may let
 * it write new strategy code. That code is untrusted and must never run in
 * the trading worker, the API or the evolution worker process itself. The
 * contract below is what such a sandbox has to guarantee before the switch
 * may ever be turned on; until then every attempt fails closed.
 */

export const STRATEGY_MODULE_SANDBOX_CONTRACT_V0 = Object.freeze({
  version: "strategy-module-sandbox-v0",
  status: "NOT_IMPLEMENTED",
  isolation: Object.freeze([
    "eigener, kurzlebiger Container je Ausführung (kein Prozess im Trading-Worker, in der API oder im Evolution-Worker)",
    "kein Netzwerk (network_mode: none), keine Datenbank, kein Docker-Socket, keine Secrets, keine Umgebungsvariablen",
    "Nur-Lese-Dateisystem; Eingabe ausschließlich als JSON-Snapshot über stdin, Ausgabe ausschließlich als JSON über stdout",
    "harte Grenzen: CPU-Quote, Speicher, Prozessanzahl, Laufzeit; Abbruch = Kandidat scheitert technisch",
    "nicht-root, keine Capabilities, no-new-privileges, seccomp-Standardprofil"
  ]),
  interface: Object.freeze({
    input: "StrategyInputSnapshotV1 (dieselbe Struktur wie für registrierte Strategien)",
    output: "StrategyEvaluationResultV1, vom Host gegen das Schema validiert",
    determinism: "zwei Läufe mit gleicher Eingabe müssen denselben outputHash liefern"
  }),
  admission: Object.freeze([
    "statische Prüfung: keine Imports außer einer Allowlist reiner Hilfsfunktionen",
    "Golden-Fixtures und die technischen Tests der Evolution Engine",
    "dieselben historischen Gates wie Parameter-Kandidaten",
    "Code-Review und Freigabe durch den Betreiber, danach regulärer Registry-Eintrag mit eigener Version"
  ])
});

export class StrategyCodeGenerationDisabledError extends Error {
  constructor() {
    super("AI-generated strategy code is disabled in Evolution Engine V1 (see STRATEGY_MODULE_SANDBOX_CONTRACT_V0).");
    this.name = "StrategyCodeGenerationDisabledError";
  }
}

/** Fails closed: V1 has no sandbox, so a request to run generated code is always refused. */
export function assertStrategyCodeGenerationDisabled(requested: boolean): void {
  if (requested) throw new StrategyCodeGenerationDisabledError();
}

/**
 * Prompts, response schemas and response parsing of the research AI.
 *
 * The system prompts are fixed text (cache-friendly prefix); everything that
 * varies goes into the user prompt after it. The parser is strict and treats
 * the model output as untrusted input: unknown families, missing fields and
 * oversized texts are refused, never repaired by guessing.
 */

import type { ResearchContext } from "./context.js";
import { EVOLUTION_FAMILIES, type EvolutionFamily, type ParameterChange } from "./genome.js";

export const PROMPT_VERSION = "evolution-prompt-v1";

export const HYPOTHESIS_SYSTEM_PROMPT = `Du bist der Forschungsassistent der SignalPilot Evolution Engine. Du entwirfst überprüfbare, parametrisierte Handelshypothesen für historische Backtests von BTCUSDT und ETHUSDT (Spot, Long-only, 1h-Entscheidungen). Deine Vorschläge werden automatisch in geschlossene Parametersätze übersetzt, mit realistischen Kosten (10 bp Gebühr je Seite, 2 bp Spread, 3 bp Slippage je Seite) und der unveränderten Risk Engine simuliert und streng auf Überanpassung geprüft. Nichts davon ist eine Anlageempfehlung, und kein Vorschlag handelt ohne menschliche Freigabe und einen eigenen Forward-Test.

Arbeitsweise:
- Leite jede Hypothese aus einer konkreten Beobachtung im Kontext ab (Marktphasen, Bedingungen beim Einstieg, Ausstiegsarten, bisherige Kandidaten).
- Formuliere eine ökonomische Begründung, warum die Änderung den Nettoertrag nach Kosten verbessern sollte, und ein Kriterium, an dem die Hypothese scheitert.
- Ändere wenige Parameter (höchstens request.maxChangesPerHypothesis) gegenüber genau einer Elternstrategie aus allowedParents. Nutze ausschließlich Parameter und Werte aus families.
- Wiederhole keine Kombination aus history und keine Änderung, die dort bereits an denselben Gates gescheitert ist.
- Bevorzuge robuste Effekte über mehrere Marktphasen gegenüber Optimierungen auf ein einzelnes Jahr; eine niedrigere Trefferquote ist in Ordnung, wenn der Erwartungswert je Trade nach Kosten steigt.
- Schreibe alle Texte auf Deutsch, sachlich und ohne Kauf- oder Verkaufsempfehlung.

Antworte ausschließlich im vorgegebenen JSON-Format.`;

export const REVIEW_SYSTEM_PROMPT = `Du fasst einen Forschungsdurchlauf der SignalPilot Evolution Engine für den Betreiber zusammen. Grundlage sind ausschließlich die gelieferten historischen Backtest-Ergebnisse (keine Forward-Ergebnisse). Benenne, was die Ergebnisse zeigen, was sie nicht beweisen, auffällige Risiken der Überanpassung und sinnvolle nächste Forschungsschritte. Schreibe auf Deutsch, knapp und ohne Kauf- oder Verkaufsempfehlung. Antworte ausschließlich im vorgegebenen JSON-Format.`;

export const HYPOTHESIS_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["summary", "hypotheses"],
  properties: {
    summary: { type: "string" },
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "marketObservation", "rationale", "family", "parentKey", "changes", "expectedEffect", "falsificationCriterion"],
        properties: {
          title: { type: "string" },
          marketObservation: { type: "string" },
          rationale: { type: "string" },
          family: { type: "string", enum: [...EVOLUTION_FAMILIES] },
          parentKey: { type: "string" },
          changes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["parameter", "value"],
              properties: { parameter: { type: "string" }, value: { type: "string" } }
            }
          },
          expectedEffect: { type: "string" },
          falsificationCriterion: { type: "string" }
        }
      }
    }
  }
});

export const REVIEW_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["summary", "keyFindings", "warnings", "nextSteps"],
  properties: {
    summary: { type: "string" },
    keyFindings: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } }
  }
});

export function renderHypothesisPrompt(context: ResearchContext): string {
  return [
    `Erzeuge genau ${context.request.hypotheses} neue Hypothesen.`,
    "<research_context>",
    JSON.stringify(context),
    "</research_context>"
  ].join("\n");
}

export interface ParsedHypothesis {
  readonly title: string;
  readonly marketObservation: string;
  readonly rationale: string;
  readonly family: EvolutionFamily;
  readonly parentKey: string;
  readonly changes: readonly ParameterChange[];
  readonly expectedEffect: string;
  readonly falsificationCriterion: string;
}

export interface ParsedHypothesisResponse {
  readonly summary: string;
  readonly hypotheses: readonly ParsedHypothesis[];
  /** Entries that were refused, with the reason. */
  readonly refused: readonly { readonly index: number; readonly reason: string }[];
}

const LIMITS = { title: 140, text: 1500, changes: 6, value: 32, parameter: 64 } as const;

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
};

/** Strictly parse the hypothesis JSON. Throws only if the envelope itself is unusable. */
export function parseHypothesisResponse(json: unknown, maxHypotheses: number): ParsedHypothesisResponse {
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Error("Hypothesis response is not a JSON object.");
  const record = json as Record<string, unknown>;
  if (!Array.isArray(record.hypotheses)) throw new Error("Hypothesis response has no hypotheses array.");
  const summary = text(record.summary, LIMITS.text * 2) ?? "";
  const hypotheses: ParsedHypothesis[] = [];
  const refused: { index: number; reason: string }[] = [];
  record.hypotheses.forEach((raw, index) => {
    if (hypotheses.length >= maxHypotheses) {
      refused.push({ index, reason: `Mehr als ${maxHypotheses} Hypothesen angefordert; überzählige verworfen.` });
      return;
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      refused.push({ index, reason: "Eintrag ist kein Objekt." });
      return;
    }
    const entry = raw as Record<string, unknown>;
    const title = text(entry.title, LIMITS.title);
    const marketObservation = text(entry.marketObservation, LIMITS.text);
    const rationale = text(entry.rationale, LIMITS.text);
    const expectedEffect = text(entry.expectedEffect, LIMITS.text);
    const falsificationCriterion = text(entry.falsificationCriterion, LIMITS.text);
    const parentKey = text(entry.parentKey, 80);
    const family = EVOLUTION_FAMILIES.find((candidate) => candidate === entry.family) ?? null;
    if (!title || !marketObservation || !rationale || !expectedEffect || !falsificationCriterion || !parentKey) {
      refused.push({ index, reason: "Pflichtfeld fehlt, ist leer oder zu lang." });
      return;
    }
    if (family === null) {
      refused.push({ index, reason: `Unbekannte Familie ${String(entry.family)}.` });
      return;
    }
    if (!Array.isArray(entry.changes) || entry.changes.length === 0 || entry.changes.length > LIMITS.changes) {
      refused.push({ index, reason: `changes muss 1 bis ${LIMITS.changes} Einträge haben.` });
      return;
    }
    const changes: ParameterChange[] = [];
    for (const change of entry.changes) {
      const item = (change ?? {}) as Record<string, unknown>;
      const parameter = text(item.parameter, LIMITS.parameter);
      const value = typeof item.value === "number" || typeof item.value === "boolean" ? String(item.value) : text(item.value, LIMITS.value);
      if (parameter === null || value === null) {
        refused.push({ index, reason: "Parameteränderung ohne gültigen Namen oder Wert." });
        return;
      }
      changes.push({ parameter, value });
    }
    hypotheses.push({ title, marketObservation, rationale, family, parentKey, changes, expectedEffect, falsificationCriterion });
  });
  return { summary, hypotheses, refused };
}

export interface ParsedReview {
  readonly summary: string;
  readonly keyFindings: readonly string[];
  readonly warnings: readonly string[];
  readonly nextSteps: readonly string[];
}

export function parseReviewResponse(json: unknown): ParsedReview {
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Error("Review response is not a JSON object.");
  const record = json as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value.map((item) => text(item, LIMITS.text)).filter((item): item is string => item !== null).slice(0, 10) : []);
  return {
    summary: text(record.summary, LIMITS.text * 3) ?? "",
    keyFindings: list(record.keyFindings),
    warnings: list(record.warnings),
    nextSteps: list(record.nextSteps)
  };
}

/** Extract the context back out of a hypothesis prompt (used by the mock provider). */
export function extractResearchContext(prompt: string): ResearchContext | null {
  const match = /<research_context>\n([\s\S]*?)\n<\/research_context>/.exec(prompt);
  if (match === null) return null;
  try {
    return JSON.parse(match[1]!) as ResearchContext;
  } catch {
    return null;
  }
}

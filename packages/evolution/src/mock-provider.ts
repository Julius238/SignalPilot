/**
 * Deterministic stand-in for the research AI.
 *
 * Used when no API key is configured and in every test. It is not a dummy
 * that returns fixed text: it reads the same research context the real
 * model gets and derives hypotheses from it with simple, documented rules
 * (e.g. "losses concentrate below the 200-day average → demand a stronger
 * regime"), so the whole cycle — hypothesis, genome, backtest, gates,
 * persistence, dashboard — runs on real decisions. Token counts are
 * simulated from text length; the provider is never billable.
 */

import type { AiRequest, AiResponse, ResearchAiProvider } from "./ai.js";
import type { ResearchContext } from "./context.js";
import { FAMILY_SPECS, normalizeDecimal, type EvolutionFamily, type ParameterValue } from "./genome.js";
import { extractResearchContext } from "./prompt.js";

interface Operator {
  readonly family: EvolutionFamily;
  readonly id: string;
  /** Returns the change set, or null when it does not apply to this parent. */
  readonly build: (
    parameters: Readonly<Record<string, ParameterValue>>,
    context: ResearchContext
  ) => { changes: { parameter: string; value: string }[]; observation: string; rationale: string; effect: string; falsification: string; title: string } | null;
}

const stepOf = (family: EvolutionFamily, name: string) => FAMILY_SPECS[family].parameters.find((parameter) => parameter.name === name)!;

/** Move a numeric parameter by `steps` grid steps, clamped to its range; null if it cannot move. */
function shift(family: EvolutionFamily, parameters: Readonly<Record<string, ParameterValue>>, name: string, steps: number): string | null {
  const spec = stepOf(family, name);
  const current = Number(parameters[name]);
  if (spec.allowed !== undefined) {
    const index = spec.allowed.findIndex((value) => Math.abs(value - current) < 1e-12);
    const next = Math.max(0, Math.min(spec.allowed.length - 1, index + steps));
    return next === index ? null : String(spec.allowed[next]);
  }
  const decimals = String(spec.step).includes(".") ? String(spec.step).split(".")[1]!.length : 0;
  const next = Math.max(spec.min!, Math.min(spec.max!, current + steps * spec.step!));
  return Math.abs(next - current) < 1e-12 ? null : normalizeDecimal(next.toFixed(decimals));
}

const bucket = (context: ResearchContext, subject: string, dimension: string, name: string) =>
  context.market.buckets.find((entry) => entry.subject === subject && entry.dimension === dimension && entry.bucket === name) ?? null;

const exitShare = (context: ResearchContext, subject: string, reason: string): number => {
  const all = context.market.buckets.filter((entry) => entry.subject === subject && entry.dimension === "EXIT_REASON");
  const total = all.reduce((sum, entry) => sum + entry.trades, 0);
  const own = all.find((entry) => entry.bucket === reason)?.trades ?? 0;
  return total === 0 ? 0 : own / total;
};

const fmtR = (value: number | null | undefined) => (value === null || value === undefined ? "n/a" : `${value.toFixed(2)}R`);

/** Alternating families, so every cycle explores both the champion's and the challenger's lineage. */
const OPERATORS: readonly Operator[] = [
  {
    family: "BREAKOUT_LONG",
    id: "regime-stricter",
    build: (p, context) => {
      const below = bucket(context, "ROOT:CRYPTO_TREND_CORE_LONG_V1", "TREND_200D", "BELOW");
      const value = shift("BREAKOUT_LONG", p, "regimeMinimumConfidence", 2);
      if (value === null) return null;
      return {
        title: "Regime-Konfidenz für Ausbrüche anheben",
        changes: [{ parameter: "regimeMinimumConfidence", value }],
        observation: `Ausbrüche unter dem 200-Tage-Schnitt: ${below?.trades ?? 0} Trades, Ø ${fmtR(below?.averageR)}.`,
        rationale: "Falsche Ausbrüche häufen sich in schwachen Regimen; ein strengeres Regime-Gate sollte vor allem Verlierer entfernen.",
        effect: "Weniger Trades, höherer Erwartungswert je Trade, geringerer Drawdown.",
        falsification: "Scheitert, wenn Ø R in der Entdeckung nicht steigt oder die Validierung negativ wird."
      };
    }
  },
  {
    family: "REGIME_LONG",
    id: "regime-confidence",
    build: (p, context) => {
      const regime = bucket(context, "ROOT:CRYPTO_REGIME_LONG_V1", "PHASE", "SIDEWAYS");
      const value = shift("REGIME_LONG", p, "regimeMinimumConfidence", 2);
      if (value === null) return null;
      return {
        title: "Regime-Gate erst bei höherer Konfidenz öffnen",
        changes: [{ parameter: "regimeMinimumConfidence", value }],
        observation: `Challenger in Seitwärtsphasen: ${regime?.trades ?? 0} Trades, Ø ${fmtR(regime?.averageR)}.`,
        rationale: "Knappe Regime-Signale wechseln häufig; eine höhere Mindest-Konfidenz reduziert Ein- und Ausstiege mit vollen Kosten.",
        effect: "Weniger Round-Trips, geringere Kostenquote, kürzere aber sauberere Haltephasen.",
        falsification: "Scheitert, wenn die Nettorendite nach Kosten sinkt oder weniger Marktphasen positiv sind."
      };
    }
  },
  {
    family: "BREAKOUT_LONG",
    id: "wider-stop",
    build: (p, context) => {
      const share = exitShare(context, "ROOT:CRYPTO_TREND_CORE_LONG_V1", "STOP");
      const value = shift("BREAKOUT_LONG", p, "stopAtrMultiple", 2);
      if (value === null) return null;
      return {
        title: "Stop weiter fassen",
        changes: [{ parameter: "stopAtrMultiple", value }],
        observation: `${Math.round(share * 100)} % der Champion-Trades enden am Stop.`,
        rationale: "Ein Stop im normalen Stunden-Rauschen beendet Trends zu früh; ein weiterer ATR-Stop lässt Trends laufen, die Positionsgröße sinkt automatisch.",
        effect: "Seltener ausgestoppt, höhere Trefferquote, ähnliche Kosten je Trade.",
        falsification: "Scheitert, wenn der Profit Factor sinkt oder der Drawdown steigt."
      };
    }
  },
  {
    family: "REGIME_LONG",
    id: "regime-stop",
    build: (p, context) => {
      const share = exitShare(context, "ROOT:CRYPTO_REGIME_LONG_V1", "STOP");
      const value = shift("REGIME_LONG", p, "stopAtrMultiple1d", 2);
      if (value === null) return null;
      return {
        title: "Schutz-Stop des Regime-Haltens weiter setzen",
        changes: [{ parameter: "stopAtrMultiple1d", value }],
        observation: `${Math.round(share * 100)} % der Challenger-Trades enden am Schutz-Stop.`,
        rationale: "Der Regime-Exit soll die meisten Trades beenden; ein zu enger Tages-ATR-Stop beendet Haltephasen bei normalen Rücksetzern.",
        effect: "Weniger Stop-Ausstiege, mehr Regime-Ausstiege.",
        falsification: "Scheitert, wenn der Drawdown deutlich steigt oder Ø R sinkt."
      };
    }
  },
  {
    family: "BREAKOUT_LONG",
    id: "longer-breakout",
    build: (p, context) => {
      const sideways = bucket(context, "ROOT:CRYPTO_TREND_CORE_LONG_V1", "PHASE", "SIDEWAYS");
      const value = shift("BREAKOUT_LONG", p, "breakoutLookback", 2);
      if (value === null) return null;
      return {
        title: "Längeres Ausbruchsfenster",
        changes: [{ parameter: "breakoutLookback", value }],
        observation: `Seitwärtsphasen: ${sideways?.trades ?? 0} Trades, Ø ${fmtR(sideways?.averageR)}.`,
        rationale: "Ein Ausbruch über ein längeres Hoch filtert kurzfristige Spitzen in Seitwärtsmärkten und lässt nur breitere Ausbrüche zu.",
        effect: "Weniger Fehlsignale in Seitwärtsphasen.",
        falsification: "Scheitert, wenn Seitwärtsphasen weiter negativ bleiben oder die Tradezahl unter das Minimum fällt."
      };
    }
  },
  {
    family: "REGIME_LONG",
    id: "regime-target",
    build: (p) => {
      const value = shift("REGIME_LONG", p, "takeProfitRMultiple", 4);
      if (value === null) return null;
      return {
        title: "Gewinnziel des Regime-Haltens anheben",
        changes: [{ parameter: "takeProfitRMultiple", value }],
        observation: "Das Ziel begrenzt die Gewinne langer Regime-Phasen.",
        rationale: "Wenn das Regime die Haltephase steuert, sollte ein festes Ziel große Trends nicht vorzeitig beenden.",
        effect: "Größere Gewinner, unveränderte Verlierer.",
        falsification: "Scheitert, wenn der Profit Factor nicht steigt."
      };
    }
  },
  {
    family: "BREAKOUT_LONG",
    id: "longer-hold",
    build: (p, context) => {
      const share = exitShare(context, "ROOT:CRYPTO_TREND_CORE_LONG_V1", "TIME_EXIT");
      const value = shift("BREAKOUT_LONG", p, "maxHoldHours", 2);
      if (value === null) return null;
      return {
        title: "Gewinner länger halten",
        changes: [{ parameter: "maxHoldHours", value }],
        observation: `${Math.round(share * 100)} % der Champion-Trades enden durch den Zeit-Exit.`,
        rationale: "Trendfolger verdienen an wenigen großen Bewegungen; ein zu kurzes Zeitlimit schneidet sie ab, bevor das Ziel erreicht ist.",
        effect: "Mehr Ziel-Ausstiege, höherer Durchschnittsgewinn, längere Kapitalbindung.",
        falsification: "Scheitert, wenn der Durchschnittsgewinn nicht steigt oder der Drawdown zunimmt."
      };
    }
  }
];

/** Deterministic research hypotheses from a context (exported for tests). */
export function mockHypotheses(context: ResearchContext): Record<string, unknown> {
  const wanted = context.request.hypotheses;
  const parentFor = (family: EvolutionFamily): { key: string; parameters: Readonly<Record<string, ParameterValue>> } => {
    const passed = context.history
      .filter((entry) => entry.family === family && entry.verdict === "PASSED_SCREENING" && entry.discovery?.averageR !== null)
      .sort((a, b) => (b.discovery?.averageR ?? 0) - (a.discovery?.averageR ?? 0))[0];
    if (passed !== undefined) return { key: passed.candidateKey, parameters: passed.parameters };
    const root = context.roots.find((candidate) => candidate.family === family)!;
    return { key: root.key, parameters: root.parameters };
  };
  const tried = new Set(context.history.map((entry) => `${entry.parentKey}|${entry.changes.map((change) => `${change.parameter}=${String(change.to)}`).join(",")}`));
  const offset = context.history.length % OPERATORS.length;
  const ordered = [...OPERATORS.slice(offset), ...OPERATORS.slice(0, offset)];
  const hypotheses: Record<string, unknown>[] = [];
  for (const operator of ordered) {
    if (hypotheses.length >= wanted) break;
    const parent = parentFor(operator.family);
    const built = operator.build(parent.parameters, context);
    if (built === null) continue;
    const signature = `${parent.key}|${built.changes.map((change) => `${change.parameter}=${change.value}`).join(",")}`;
    if (tried.has(signature)) continue;
    tried.add(signature);
    hypotheses.push({
      title: built.title,
      marketObservation: built.observation,
      rationale: built.rationale,
      family: operator.family,
      parentKey: parent.key,
      changes: built.changes,
      expectedEffect: built.effect,
      falsificationCriterion: built.falsification
    });
  }
  return {
    summary: `Regelbasierter Mock: ${hypotheses.length} Hypothesen aus ${context.market.findings.length} Bedingungsbefunden und ${context.history.length} bisherigen Kandidaten.`,
    hypotheses
  };
}

function mockReview(prompt: string): Record<string, unknown> {
  const lines = prompt.split("\n").filter((line) => line.startsWith("- "));
  return {
    summary: `Regelbasierte Zusammenfassung (Mock) von ${lines.length} Kandidatenzeilen. Historische Backtests, kein Forward-Beweis.`,
    keyFindings: lines.slice(0, 5).map((line) => line.slice(2)),
    warnings: ["Alle Ergebnisse stammen aus historischen Daten; der Holdout 2024–2026 wurde bereits früher analysiert."],
    nextSteps: ["Bestandene Kandidaten nur nach Freigabe in einen eigenen Shadow-Forward-Test übernehmen."]
  };
}

export class MockResearchProvider implements ResearchAiProvider {
  readonly name = "mock";
  readonly billable = false;

  async complete(request: AiRequest): Promise<AiResponse> {
    let json: Record<string, unknown>;
    if (request.task === "HYPOTHESIS_GENERATION") {
      const context = extractResearchContext(request.prompt);
      if (context === null) throw new Error("Mock provider: prompt carries no research context.");
      json = mockHypotheses(context);
    } else {
      json = mockReview(request.prompt);
    }
    const text = JSON.stringify(json);
    const usage = {
      inputTokens: Math.ceil((request.system.length + request.prompt.length) / 4),
      outputTokens: Math.min(request.maxOutputTokens, Math.ceil(text.length / 4)),
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0
    };
    return {
      servedModel: request.model,
      text,
      json,
      usage,
      usageByModel: [{ model: request.model, usage }],
      stopReason: "end_turn",
      requestId: null,
      attempts: 1
    };
  }
}

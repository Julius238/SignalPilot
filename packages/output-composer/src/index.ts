import type {
  AssetClass,
  IntelligenceContext,
  SignalDecision,
  SignalOutputDraft
} from "@signalpilot/shared";

export type ComposeSignalOutputInput = {
  decision: SignalDecision;
  asset?: {
    symbol: string;
    assetType: AssetClass;
  };
  intelligence?: Partial<IntelligenceContext>;
};

type TechnicalSummary = {
  trend: string;
  momentum: string;
  rsi: string;
  volume: string;
  movingAverages: string;
};

const defaultNewsSummary = "Keine relevante neue Meldung im Scan-Fenster gefunden.";
const defaultSocialSummary = "X/Social: noch nicht aktiv verbunden.";
const defaultEventSummary = "Keine Event-Daten in diesem Scan.";
const defaultImpactSummary = "Signal basiert primär auf technischen Daten.";

export function composeSignalOutput(input: ComposeSignalOutputInput): SignalOutputDraft {
  const decision = input.decision;
  const symbol = input.asset?.symbol ?? decision.symbol;
  const assetType = input.asset?.assetType ?? decision.assetType;
  const intelligence = normalizeIntelligence(input.intelligence);
  const technical = buildTechnicalSummary(decision);
  const confirmations = buildConfirmations(decision);
  const counterArgument =
    decision.counterArguments[0] ?? "Kein dominantes Gegenargument im aktuellen technischen Scan.";
  const shortConclusion = buildShortConclusion(decision);
  const emoji = emojiForSignalType(decision.signalType);

  const telegramText = [
    `${emoji} ${symbol} · ${assetType.toUpperCase()} · ${decision.timeframe}`,
    "",
    `Status: ${decision.status}`,
    `Richtung: ${decision.direction}`,
    `Score: ${formatScore(decision.score)}/100`,
    `Risiko: ${decision.riskLevel}`,
    "",
    "Kurzfazit:",
    shortConclusion,
    "",
    "Technik:",
    `• Trend: ${technical.trend}`,
    `• Momentum: ${technical.momentum}`,
    `• RSI: ${technical.rsi}`,
    `• Volumen: ${technical.volume}`,
    `• MAs: ${technical.movingAverages}`,
    "",
    "News/X/Event:",
    `• News: ${intelligence.newsSummary}`,
    `• X/Social: ${intelligence.socialSummary}`,
    `• Events: ${intelligence.eventSummary}`,
    `• Impact: ${intelligence.impactSummary}`,
    "",
    "Marktbestätigung:",
    ...confirmations.map((confirmation) => `• ${confirmation}`),
    "",
    "Gegenargument:",
    counterArgument,
    "",
    "Nächster Trigger:",
    decision.nextTrigger
  ].join("\n");

  return {
    shortConclusion,
    technicalJson: {
      ...technical,
      scores: {
        trendScore: decision.trendScore,
        momentumScore: decision.momentumScore,
        rsiScore: decision.rsiScore,
        volumeScore: decision.volumeScore,
        volatilityScore: decision.volatilityScore,
        riskScore: decision.riskScore
      },
      reasons: decision.reasons
    },
    intelligenceJson: intelligence,
    marketConfirmationJson: {
      confirmations,
      status: decision.status,
      direction: decision.direction,
      score: decision.score,
      signalType: decision.signalType
    },
    counterArgument,
    nextTrigger: decision.nextTrigger,
    telegramText,
    dashboardJson: {
      symbol,
      assetType,
      decision,
      technical,
      intelligence,
      confirmations,
      counterArgument,
      nextTrigger: decision.nextTrigger,
      generatedSections: [
        "Kurzfazit",
        "Technik",
        "News/X/Event",
        "Marktbestätigung",
        "Gegenargument",
        "Nächster Trigger"
      ]
    }
  };
}

function buildShortConclusion(decision: SignalDecision): string {
  if (decision.status === "STRONG_WATCH") {
    return `${decision.symbol} zeigt ein starkes ${decision.direction.toLowerCase()} Setup mit ${formatScore(decision.score)} Punkten. Fokus bleibt auf Bestätigung, nicht auf Ausführung.`;
  }

  if (decision.status === "WATCH") {
    return `${decision.symbol} ist beobachtenswert: ${decision.direction} Struktur, Score ${formatScore(decision.score)}.`;
  }

  if (decision.status === "WAIT") {
    return `${decision.symbol} liefert noch kein sauberes Signal. Warten auf den nächsten technischen Trigger.`;
  }

  if (decision.status === "AVOID") {
    return `${decision.symbol} ist aktuell zu schwach oder zu riskant für eine Watchlist-Priorität.`;
  }

  return `${decision.symbol} hat aktuell keinen belastbaren technischen Edge.`;
}

function buildTechnicalSummary(decision: SignalDecision): TechnicalSummary {
  return {
    trend: describeScore(decision.trendScore, "Trend"),
    momentum: describeScore(decision.momentumScore, "Momentum"),
    rsi: describeRsi(decision.rsiScore, decision.riskScore),
    volume: describeScore(decision.volumeScore, "Volumen"),
    movingAverages: describeMovingAverages(decision)
  };
}

function buildConfirmations(decision: SignalDecision): string[] {
  const confirmations = decision.reasons.slice(0, 3);

  while (confirmations.length < 3) {
    if (confirmations.length === 0) {
      confirmations.push(`Status ${decision.status} bei Score ${formatScore(decision.score)}/100.`);
    } else if (confirmations.length === 1) {
      confirmations.push(`Richtung: ${decision.direction}.`);
    } else {
      confirmations.push(`Signaltyp: ${decision.signalType}.`);
    }
  }

  return confirmations;
}

function normalizeIntelligence(
  intelligence?: Partial<IntelligenceContext>
): Required<IntelligenceContext> {
  return {
    newsSummary: cleanText(intelligence?.newsSummary) ?? defaultNewsSummary,
    socialSummary: cleanText(intelligence?.socialSummary) ?? defaultSocialSummary,
    eventSummary: cleanText(intelligence?.eventSummary) ?? defaultEventSummary,
    impactSummary: cleanText(intelligence?.impactSummary) ?? defaultImpactSummary,
    sources: intelligence?.sources ?? []
  };
}

function describeScore(score: number, label: string): string {
  if (score >= 80) {
    return `${label} stark (${formatScore(score)}/100).`;
  }

  if (score >= 65) {
    return `${label} konstruktiv (${formatScore(score)}/100).`;
  }

  if (score >= 50) {
    return `${label} neutral (${formatScore(score)}/100).`;
  }

  if (score >= 40) {
    return `${label} schwach (${formatScore(score)}/100).`;
  }

  return `${label} klar schwach (${formatScore(score)}/100).`;
}

function describeRsi(rsiScore: number, riskScore: number): string {
  if (rsiScore >= 80 && riskScore >= 70) {
    return `RSI stark, aber überhitztes Risiko (${formatScore(rsiScore)}/100).`;
  }

  return describeScore(rsiScore, "RSI");
}

function describeMovingAverages(decision: SignalDecision): string {
  if (decision.trendScore >= 75) {
    return "Moving Averages bestätigen die Trendstruktur.";
  }

  if (decision.trendScore < 40) {
    return "Moving Averages sprechen gegen eine saubere Trendstruktur.";
  }

  return "Moving Averages liefern kein klares Übergewicht.";
}

function emojiForSignalType(signalType: SignalDecision["signalType"]): string {
  switch (signalType) {
    case "BREAKOUT_ALERT":
      return "🚀";
    case "MOMENTUM_ALERT":
      return "⚡";
    case "TREND_ALERT":
      return "📈";
    case "VOLUME_SPIKE":
      return "🔊";
    case "VOLATILITY_SPIKE":
      return "🌪️";
    case "NO_SIGNAL":
      return "▫️";
  }
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

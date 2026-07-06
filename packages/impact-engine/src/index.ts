// Regelbasierte Impact Engine: bildet erkannte Markt-Ereignisse auf potenziell
// betroffene Assetklassen, Sektoren und Beobachtungsbereiche ab.
// Bewusst deterministisch und transparent: jede Zuordnung nennt die angewandten
// Regeln, die Confidence bleibt konservativ gedeckelt, widersprüchliche Signale
// werden explizit als "gemischt" ausgewiesen statt verschwiegen.
// Keine Handlungsempfehlungen — nur Research-/Beobachtungshinweise.

export type ImpactAssessmentInput = {
  eventType: string;
  title: string;
  summary?: string | null;
  region?: string | null;
};

export type ImpactContext = {
  // riskMode aus dem letzten MarketRegimeSnapshot (AGGRESSIVE | NORMAL | DEFENSIVE | HIGH_RISK | UNKNOWN)
  riskMode?: string | null;
};

export type ImpactAssessment = {
  affectedAssetClasses: string[];
  affectedSectors: string[];
  affectedSymbols: string[];
  potentiallyPositive: string[];
  potentiallyNegative: string[];
  mixedSignals: string[];
  confidence: number;
  reasoning: string;
  appliedRules: string[];
};

type ImpactRule = {
  id: string;
  label: string;
  // null = gilt für alle Ereignistypen
  eventTypes: string[] | null;
  // AND aus ORs: aus jeder Gruppe muss mindestens ein Keyword im Text vorkommen
  keywordGroups: string[][];
  // Regel greift nicht, wenn eines dieser Keywords vorkommt (z.B. "rejects" bei Entspannung)
  excludeKeywords?: string[];
  assetClasses: string[];
  sectors: string[];
  symbols: string[];
  positive: string[];
  negative: string[];
  confidence: number;
  note?: string;
};

const maxConfidence = 0.6;
const maxListLength = 8;

const upWords = [
  "surge",
  "surges",
  "jump",
  "jumps",
  "rally",
  "rallies",
  "rise",
  "rises",
  "rising",
  "spike",
  "spikes",
  "soar",
  "soars",
  "climbs",
  "higher",
  "gains",
  "record high"
];

const downWords = [
  "fall",
  "falls",
  "drop",
  "drops",
  "plunge",
  "plunges",
  "tumble",
  "tumbles",
  "slide",
  "slides",
  "slump",
  "slumps",
  "sink",
  "sinks",
  "lower",
  "declines",
  "weakens"
];

const impactRules: ImpactRule[] = [
  {
    id: "oil-price-up",
    label: "Ölpreis-Anstieg",
    eventTypes: ["ENERGY_COMMODITY", "GEOPOLITICAL", "CONFLICT", "SANCTIONS"],
    keywordGroups: [
      ["oil", "crude", "brent", "wti", "opec", "gasoline"],
      [...upWords, "production cut", "supply cut", "supply disruption", "embargo"]
    ],
    assetClasses: ["Rohstoffe", "Aktien"],
    sectors: ["Energie", "Transport/Logistik", "Konsum"],
    symbols: ["XLE", "XOP", "USO"],
    positive: ["Energieaktien", "Öl-/Gasproduzenten", "Rohstoff-ETFs"],
    negative: ["Airlines", "Logistik/Transport", "Konsumzykliker", "inflationssensible Anleihen"],
    confidence: 0.45
  },
  {
    id: "oil-price-down",
    label: "Ölpreis-Rückgang",
    eventTypes: ["ENERGY_COMMODITY"],
    keywordGroups: [
      ["oil", "crude", "brent", "wti", "opec", "gasoline"],
      [...downWords, "glut", "oversupply", "weak demand"]
    ],
    assetClasses: ["Rohstoffe", "Aktien"],
    sectors: ["Energie", "Transport/Logistik", "Konsum"],
    symbols: ["XLE", "XOP", "USO"],
    positive: ["Airlines", "Logistik/Transport", "Konsumzykliker"],
    negative: ["Energieaktien", "Öl-/Gasproduzenten"],
    confidence: 0.45
  },
  {
    id: "precious-metals-up",
    label: "Edelmetall-Anstieg",
    eventTypes: ["ENERGY_COMMODITY", "RISK_SENTIMENT", "GEOPOLITICAL", "MACRO"],
    keywordGroups: [["gold", "silver", "precious metals"], upWords],
    assetClasses: ["Edelmetalle"],
    sectors: ["Goldminen"],
    symbols: ["GLD", "GDX", "SLV"],
    positive: ["Gold", "Edelmetalle", "Goldminen-Aktien"],
    negative: [],
    confidence: 0.4,
    note: "Steigende Edelmetalle sind häufig ein Risk-off-Signal."
  },
  {
    id: "rate-cut-expectation",
    label: "Zinssenkungserwartung",
    eventTypes: ["CENTRAL_BANK", "RATES", "INFLATION", "MACRO", "LABOR_MARKET"],
    keywordGroups: [
      [
        "rate cut",
        "rate cuts",
        "cuts rates",
        "cut rates",
        "lower rates",
        "easing",
        "dovish",
        "zinssenkung"
      ]
    ],
    assetClasses: ["Aktien", "Anleihen", "Krypto", "Edelmetalle", "Währungen"],
    sectors: ["Technologie", "Finanzen", "Immobilien"],
    symbols: ["QQQ", "TLT", "GLD", "BTC"],
    positive: ["Growth-/Tech-Aktien", "langlaufende Anleihen", "Gold", "Bitcoin/Krypto", "REITs"],
    negative: ["Bankenmargen/Finanzwerte", "US-Dollar"],
    confidence: 0.45
  },
  {
    id: "rate-hike-expectation",
    label: "Zinserhöhungserwartung",
    eventTypes: ["CENTRAL_BANK", "RATES", "INFLATION", "MACRO"],
    keywordGroups: [
      [
        "rate hike",
        "rate hikes",
        "hikes rates",
        "raise rates",
        "raises rates",
        "higher rates",
        "tightening",
        "hawkish",
        "zinserhöhung"
      ]
    ],
    assetClasses: ["Aktien", "Anleihen", "Krypto", "Edelmetalle", "Währungen"],
    sectors: ["Finanzen", "Technologie", "Immobilien"],
    symbols: ["XLF", "UUP", "TLT", "QQQ"],
    positive: ["Banken/Finanzwerte", "US-Dollar", "Geldmarkt/kurze Laufzeiten"],
    negative: [
      "Growth-/Tech-Aktien",
      "langlaufende Anleihen",
      "Gold",
      "Bitcoin/Krypto",
      "REITs",
      "Emerging Markets"
    ],
    confidence: 0.45
  },
  {
    id: "usd-strong",
    label: "US-Dollar-Stärke",
    eventTypes: null,
    keywordGroups: [["dollar", "greenback", "dxy", "dollar index"], [...upWords, "strengthens", "strong"]],
    assetClasses: ["Währungen", "Edelmetalle", "Rohstoffe", "Aktien"],
    sectors: ["Export-Industrie"],
    symbols: ["UUP", "GLD", "EEM"],
    positive: ["US-Dollar-nahe Anlagen", "US-Importeure"],
    negative: ["Gold", "Emerging Markets", "exportlastige US-Unternehmen", "Rohstoffe"],
    confidence: 0.4
  },
  {
    id: "usd-weak",
    label: "US-Dollar-Schwäche",
    eventTypes: null,
    keywordGroups: [["dollar", "greenback", "dxy", "dollar index"], [...downWords, "weak"]],
    assetClasses: ["Währungen", "Edelmetalle", "Rohstoffe", "Aktien"],
    sectors: ["Export-Industrie"],
    symbols: ["UUP", "GLD", "EEM"],
    positive: ["Gold", "Emerging Markets", "Rohstoffe", "exportlastige US-Unternehmen"],
    negative: ["US-Dollar-nahe Anlagen"],
    confidence: 0.4
  },
  {
    id: "geopolitical-escalation",
    label: "Geopolitische Eskalation",
    eventTypes: ["CONFLICT", "GEOPOLITICAL", "SANCTIONS"],
    keywordGroups: [
      [
        "escalation",
        "escalates",
        "escalating",
        "attack",
        "attacks",
        "invasion",
        "war",
        "strikes",
        "missile",
        "sanctions",
        "embargo",
        "blockade",
        "tensions",
        "threat",
        "threatens",
        "rejects ceasefire",
        "ceasefire collapses",
        "ceasefire violated",
        "truce collapses"
      ]
    ],
    assetClasses: ["Edelmetalle", "Rohstoffe", "Aktien", "Währungen", "Krypto"],
    sectors: ["Rüstung/Verteidigung", "Energie", "Reise/Tourismus"],
    symbols: ["GLD", "ITA", "XLE", "JETS"],
    positive: ["Gold", "Rüstung/Verteidigung", "Energie (Risikoprämie)", "US-Dollar/CHF (sichere Häfen)"],
    negative: ["Risikoassets breit (Aktien, Krypto)", "Märkte der betroffenen Region", "Airlines/Reise/Tourismus"],
    confidence: 0.4
  },
  {
    id: "geopolitical-deescalation",
    label: "Geopolitische Entspannung",
    eventTypes: ["CONFLICT", "GEOPOLITICAL", "SANCTIONS"],
    keywordGroups: [
      [
        "ceasefire",
        "truce",
        "peace deal",
        "peace talks",
        "de-escalation",
        "agreement reached",
        "deal reached",
        "sanctions lifted",
        "eases sanctions"
      ]
    ],
    excludeKeywords: [
      "rejects",
      "rejected",
      "refuses",
      "refused",
      "collapses",
      "collapsed",
      "violated",
      "violates",
      "breaks down",
      "broke down"
    ],
    assetClasses: ["Aktien", "Edelmetalle", "Rohstoffe", "Krypto"],
    sectors: ["Reise/Tourismus", "Rüstung/Verteidigung", "Energie"],
    symbols: ["GLD", "ITA", "XLE", "JETS"],
    positive: ["Risikoassets breit (Aktien, Krypto)", "Airlines/Reise/Tourismus", "Märkte der betroffenen Region"],
    negative: ["Gold", "Rüstung/Verteidigung", "Öl (sinkende Risikoprämie)"],
    confidence: 0.4
  },
  {
    id: "weak-economic-data",
    label: "Schwache Konjunkturdaten",
    eventTypes: ["MACRO", "LABOR_MARKET"],
    keywordGroups: [
      [
        "miss",
        "misses",
        "missed",
        "weak",
        "weaker",
        "slump",
        "slumps",
        "contraction",
        "contracts",
        "below expectations",
        "disappointing",
        "slows",
        "slowdown",
        "cools",
        "falls short"
      ]
    ],
    assetClasses: ["Aktien", "Anleihen"],
    sectors: ["Industrie", "Konsum", "Finanzen"],
    symbols: ["XLI", "XLY", "XLF"],
    positive: [],
    negative: ["konjunktursensitive Sektoren (Industrie, Konsumzykliker, Banken)", "Risikoassets breit (Aktien, Krypto)"],
    confidence: 0.35,
    note: "Wirkung hängt vom Zinskontext ab: schwache Daten können Zinssenkungserwartungen stützen."
  },
  {
    id: "strong-economic-data",
    label: "Starke Konjunkturdaten",
    eventTypes: ["MACRO", "LABOR_MARKET"],
    keywordGroups: [
      [
        "beat",
        "beats",
        "strong",
        "stronger",
        "tops expectations",
        "above expectations",
        "accelerates",
        "robust",
        "better than expected"
      ]
    ],
    assetClasses: ["Aktien", "Anleihen", "Währungen"],
    sectors: ["Industrie", "Konsum"],
    symbols: ["XLI", "XLY", "TLT"],
    positive: ["zyklische Sektoren", "US-Dollar"],
    negative: ["langlaufende Anleihen (Zinsdruck)", "Gold"],
    confidence: 0.35,
    note: "Wirkung hängt vom Zinskontext ab: starke Daten können Zinssenkungen verzögern."
  },
  {
    id: "inflation-hot",
    label: "Inflation über Erwartung",
    eventTypes: ["INFLATION"],
    keywordGroups: [
      [
        "rises",
        "rise",
        "accelerates",
        "hot",
        "hotter",
        "above expectations",
        "above forecast",
        "jumps",
        "higher than expected",
        "sticky"
      ]
    ],
    assetClasses: ["Rohstoffe", "Anleihen", "Aktien"],
    sectors: ["Energie", "Technologie", "Konsum"],
    symbols: ["TIP", "TLT", "QQQ"],
    positive: ["Rohstoffe", "Energie", "inflationsindexierte Anleihen"],
    negative: ["langlaufende Anleihen", "Growth-/Tech-Aktien", "Konsum"],
    confidence: 0.4
  },
  {
    id: "inflation-cooling",
    label: "Inflation kühlt ab",
    eventTypes: ["INFLATION"],
    keywordGroups: [
      [
        "cools",
        "cooling",
        "eases",
        "easing",
        "slows",
        "falls",
        "below expectations",
        "lower than expected",
        "disinflation"
      ]
    ],
    assetClasses: ["Anleihen", "Aktien", "Krypto", "Edelmetalle"],
    sectors: ["Technologie"],
    symbols: ["TLT", "QQQ", "GLD", "BTC"],
    positive: ["Anleihen", "Growth-/Tech-Aktien", "Gold", "Bitcoin/Krypto"],
    negative: [],
    confidence: 0.4,
    note: "Stützt tendenziell Zinssenkungserwartungen."
  },
  {
    id: "supply-chain-disruption",
    label: "Lieferketten-Störung",
    eventTypes: ["SUPPLY_CHAIN"],
    keywordGroups: [
      ["disruption", "shortage", "strike", "blockade", "congestion", "closure", "attack", "delays"]
    ],
    assetClasses: ["Aktien", "Rohstoffe"],
    sectors: ["Logistik", "Industrie", "Einzelhandel", "Automobil"],
    symbols: ["XLI", "XRT"],
    positive: ["Frachtraten/Reedereien (kurzfristig)"],
    negative: ["importabhängige Industrie", "Einzelhandel", "Automobil"],
    confidence: 0.35
  },
  {
    id: "risk-off",
    label: "Risk-off-Bewegung",
    eventTypes: ["RISK_SENTIMENT"],
    keywordGroups: [
      [
        "selloff",
        "sell-off",
        "crash",
        "plunge",
        "plunges",
        "rout",
        "panic",
        "fear",
        "tumble",
        "tumbles",
        "slump",
        "circuit breaker"
      ]
    ],
    assetClasses: ["Aktien", "Krypto", "Edelmetalle", "Anleihen", "Währungen"],
    sectors: ["Technologie"],
    symbols: ["GLD", "TLT", "UUP"],
    positive: ["Gold", "US-Dollar", "Staatsanleihen (Flucht in Qualität)"],
    negative: ["Aktien breit", "Bitcoin/Krypto", "High-Beta/Growth"],
    confidence: 0.4
  },
  {
    id: "risk-on",
    label: "Risk-on-Bewegung",
    eventTypes: ["RISK_SENTIMENT"],
    keywordGroups: [
      ["rally", "rallies", "record high", "record highs", "rebound", "rebounds", "risk appetite", "surges", "soars"]
    ],
    assetClasses: ["Aktien", "Krypto", "Edelmetalle", "Währungen"],
    sectors: ["Technologie", "Konsum"],
    symbols: ["QQQ", "BTC", "GLD"],
    positive: ["Aktien breit", "Bitcoin/Krypto", "zyklische Sektoren"],
    negative: ["Gold (Safe-Haven-Nachfrage)", "US-Dollar (Safe-Haven-Nachfrage)"],
    confidence: 0.35
  }
];

export function assessMarketEventImpact(
  input: ImpactAssessmentInput,
  context: ImpactContext = {}
): ImpactAssessment | null {
  const text = `${input.title} ${input.summary ?? ""}`.toLowerCase();
  const matched = impactRules.filter((rule) => ruleMatches(rule, input.eventType, text));

  if (matched.length === 0) {
    return null;
  }

  const rawPositive = mergeLists(matched.map((rule) => rule.positive));
  const rawNegative = mergeLists(matched.map((rule) => rule.negative));
  const mixedSignals = rawPositive.filter((entry) => rawNegative.includes(entry));
  const potentiallyPositive = rawPositive.filter((entry) => !mixedSignals.includes(entry));
  const potentiallyNegative = rawNegative.filter((entry) => !mixedSignals.includes(entry));

  return {
    affectedAssetClasses: mergeLists(matched.map((rule) => rule.assetClasses)),
    affectedSectors: mergeLists(matched.map((rule) => rule.sectors)),
    affectedSymbols: mergeLists(matched.map((rule) => rule.symbols)),
    potentiallyPositive,
    potentiallyNegative,
    mixedSignals,
    confidence: deriveConfidence(matched),
    reasoning: buildReasoning(matched, mixedSignals, input.region, context),
    appliedRules: matched.map((rule) => rule.id)
  };
}

function ruleMatches(rule: ImpactRule, eventType: string, text: string): boolean {
  if (rule.eventTypes !== null && !rule.eventTypes.includes(eventType)) {
    return false;
  }

  if (rule.excludeKeywords?.some((keyword) => keywordPattern(keyword).test(text))) {
    return false;
  }

  return rule.keywordGroups.every((group) => group.some((keyword) => keywordPattern(keyword).test(text)));
}

function mergeLists(lists: string[][]): string[] {
  const merged: string[] = [];

  for (const list of lists) {
    for (const entry of list) {
      if (!merged.includes(entry)) {
        merged.push(entry);
      }
    }
  }

  return merged.slice(0, maxListLength);
}

function deriveConfidence(matched: ImpactRule[]): number {
  // Konservativ: die unsicherste angewandte Regel bestimmt die Gesamt-Confidence.
  const lowest = Math.min(...matched.map((rule) => rule.confidence));
  return Math.round(Math.min(maxConfidence, lowest) * 100) / 100;
}

function buildReasoning(
  matched: ImpactRule[],
  mixedSignals: string[],
  region: string | null | undefined,
  context: ImpactContext
): string {
  const parts = [`Regelbasierte Impact-Zuordnung: ${matched.map((rule) => rule.label).join(", ")}.`];

  for (const rule of matched) {
    if (rule.note) {
      parts.push(rule.note);
    }
  }

  if (mixedSignals.length > 0) {
    parts.push(`Gemischte Signale für: ${mixedSignals.join(", ")}.`);
  }

  if (region) {
    parts.push(`Regionale Betroffenheit: ${region}.`);
  }

  if (context.riskMode === "DEFENSIVE" || context.riskMode === "HIGH_RISK") {
    parts.push(`Marktumfeld aktuell ${context.riskMode} — Risikoseite stärker gewichten.`);
  }

  parts.push("Automatische Vorbewertung, keine Handlungsempfehlung.");
  return parts.join(" ");
}

const keywordPatternCache = new Map<string, RegExp>();

function keywordPattern(keyword: string): RegExp {
  let pattern = keywordPatternCache.get(keyword);

  if (!pattern) {
    // Wortgrenzen verhindern Substring-Treffer wie "war" in "software".
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "iu");
    keywordPatternCache.set(keyword, pattern);
  }

  return pattern;
}

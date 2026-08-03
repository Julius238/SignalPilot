// Statusanzeigen für Shadow Trading. Jede Badge trägt einen sichtbaren
// deutschen Text — Farbe ist nur eine Zusatzinformation, nie der einzige Träger
// der Bedeutung (Barrierefreiheit, siehe P7 Abschnitt 6).
import type {
  RiskAssessmentStatus,
  RiskRuleOutcome,
  RiskSeverity,
  ShadowOrderStatus,
  ShadowPositionStatus,
  TradeCandidateStatus,
  TradingSessionStatus
} from "../../lib/trading-api";

type Tone = "good" | "bad" | "warn" | "critical" | "neutral";

function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`badge trading-${tone}`}>{children}</span>;
}

const SESSION_LABELS: Record<TradingSessionStatus, string> = {
  STOPPED: "Gestoppt",
  SHADOW_ACTIVE: "Shadow aktiv",
  PAUSED: "Pausiert",
  KILLED: "Kill-Switch aktiv",
  ERROR_LOCKED: "Fehler-Sperre",
  CLOSED: "Geschlossen"
};

const SESSION_TONES: Record<TradingSessionStatus, Tone> = {
  STOPPED: "neutral",
  SHADOW_ACTIVE: "good",
  PAUSED: "warn",
  KILLED: "critical",
  ERROR_LOCKED: "critical",
  CLOSED: "neutral"
};

export function SessionStatusBadge({ value }: { value: TradingSessionStatus | string }) {
  const status = value as TradingSessionStatus;
  return (
    <ToneBadge tone={SESSION_TONES[status] ?? "neutral"}>{SESSION_LABELS[status] ?? value}</ToneBadge>
  );
}

export function KillSwitchBadge({ engaged }: { engaged: boolean }) {
  return (
    <ToneBadge tone={engaged ? "critical" : "good"}>
      {engaged ? "Kill-Switch: aktiv" : "Kill-Switch: gelöst"}
    </ToneBadge>
  );
}

const CANDIDATE_LABELS: Record<TradeCandidateStatus, string> = {
  CREATED: "Erstellt",
  VALIDATING: "Wird geprüft",
  READY_FOR_RISK: "Bereit für Risikoprüfung",
  APPROVED_FOR_SHADOW: "Für Shadow freigegeben",
  INVALID: "Ungültig",
  RISK_REJECTED: "Risiko abgelehnt",
  EXPIRED: "Abgelaufen",
  CANCELLED: "Storniert"
};

const CANDIDATE_TONES: Record<TradeCandidateStatus, Tone> = {
  CREATED: "neutral",
  VALIDATING: "neutral",
  READY_FOR_RISK: "warn",
  APPROVED_FOR_SHADOW: "good",
  INVALID: "bad",
  RISK_REJECTED: "bad",
  EXPIRED: "neutral",
  CANCELLED: "neutral"
};

export function CandidateStatusBadge({ value }: { value: TradeCandidateStatus | string }) {
  const status = value as TradeCandidateStatus;
  return (
    <ToneBadge tone={CANDIDATE_TONES[status] ?? "neutral"}>
      {CANDIDATE_LABELS[status] ?? value}
    </ToneBadge>
  );
}

const RISK_ASSESSMENT_LABELS: Record<RiskAssessmentStatus, string> = {
  PASS: "Bestanden",
  FAIL: "Nicht bestanden",
  ERROR: "Fehler"
};

const RISK_ASSESSMENT_TONES: Record<RiskAssessmentStatus, Tone> = {
  PASS: "good",
  FAIL: "bad",
  ERROR: "critical"
};

export function RiskAssessmentStatusBadge({ value }: { value: RiskAssessmentStatus | string }) {
  const status = value as RiskAssessmentStatus;
  return (
    <ToneBadge tone={RISK_ASSESSMENT_TONES[status] ?? "neutral"}>
      {RISK_ASSESSMENT_LABELS[status] ?? value}
    </ToneBadge>
  );
}

const RULE_OUTCOME_LABELS: Record<RiskRuleOutcome, string> = {
  PASS: "Bestanden",
  FAIL: "Verletzt",
  WARN: "Warnung",
  ERROR: "Fehler"
};

const RULE_OUTCOME_TONES: Record<RiskRuleOutcome, Tone> = {
  PASS: "good",
  FAIL: "bad",
  WARN: "warn",
  ERROR: "critical"
};

export function RiskRuleOutcomeBadge({ value }: { value: RiskRuleOutcome | string }) {
  const status = value as RiskRuleOutcome;
  return (
    <ToneBadge tone={RULE_OUTCOME_TONES[status] ?? "neutral"}>
      {RULE_OUTCOME_LABELS[status] ?? value}
    </ToneBadge>
  );
}

const SEVERITY_LABELS: Record<RiskSeverity, string> = {
  INFO: "Info",
  WARNING: "Warnung",
  BLOCKER: "Blockierend",
  CRITICAL: "Kritisch"
};

const SEVERITY_TONES: Record<RiskSeverity, Tone> = {
  INFO: "neutral",
  WARNING: "warn",
  BLOCKER: "bad",
  CRITICAL: "critical"
};

export function RiskSeverityBadge({ value }: { value: RiskSeverity | string }) {
  const status = value as RiskSeverity;
  return (
    <ToneBadge tone={SEVERITY_TONES[status] ?? "neutral"}>{SEVERITY_LABELS[status] ?? value}</ToneBadge>
  );
}

const ORDER_LABELS: Record<ShadowOrderStatus, string> = {
  PROPOSED: "Vorgeschlagen",
  ACCEPTED: "Akzeptiert",
  WAITING_FOR_ENTRY: "Wartet auf Entry",
  PARTIALLY_FILLED: "Teilweise gefüllt",
  FILLED: "Gefüllt",
  REJECTED: "Abgelehnt",
  CANCELLED: "Storniert",
  EXPIRED: "Abgelaufen"
};

const ORDER_TONES: Record<ShadowOrderStatus, Tone> = {
  PROPOSED: "neutral",
  ACCEPTED: "neutral",
  WAITING_FOR_ENTRY: "warn",
  PARTIALLY_FILLED: "warn",
  FILLED: "good",
  REJECTED: "bad",
  CANCELLED: "neutral",
  EXPIRED: "neutral"
};

export function OrderStatusBadge({ value }: { value: ShadowOrderStatus | string }) {
  const status = value as ShadowOrderStatus;
  return <ToneBadge tone={ORDER_TONES[status] ?? "neutral"}>{ORDER_LABELS[status] ?? value}</ToneBadge>;
}

const POSITION_LABELS: Record<ShadowPositionStatus, string> = {
  OPENING: "Wird eröffnet",
  OPEN: "Offen",
  PARTIALLY_CLOSED: "Teilweise geschlossen",
  CLOSED: "Geschlossen",
  STOPPED_OUT: "Stop ausgelöst",
  INVALIDATED: "Invalidiert",
  ERROR: "Fehler"
};

const POSITION_TONES: Record<ShadowPositionStatus, Tone> = {
  OPENING: "neutral",
  OPEN: "good",
  PARTIALLY_CLOSED: "warn",
  CLOSED: "neutral",
  STOPPED_OUT: "bad",
  INVALIDATED: "bad",
  ERROR: "critical"
};

export function PositionStatusBadge({ value }: { value: ShadowPositionStatus | string }) {
  const status = value as ShadowPositionStatus;
  return (
    <ToneBadge tone={POSITION_TONES[status] ?? "neutral"}>{POSITION_LABELS[status] ?? value}</ToneBadge>
  );
}

export function CircuitBreakerBadge({ allowed }: { allowed: boolean }) {
  return (
    <ToneBadge tone={allowed ? "good" : "critical"}>
      {allowed ? "Circuit Breaker: frei" : "Circuit Breaker: blockiert"}
    </ToneBadge>
  );
}

export function ReconciliationFreshnessBadge({ stale }: { stale: boolean }) {
  return (
    <ToneBadge tone={stale ? "bad" : "good"}>
      {stale ? "Reconcile: veraltet" : "Reconcile: aktuell"}
    </ToneBadge>
  );
}

export function StaleDataBadge({ stale, label = "Daten" }: { stale: boolean; label?: string }) {
  return (
    <ToneBadge tone={stale ? "warn" : "good"}>{stale ? `${label}: veraltet` : `${label}: aktuell`}</ToneBadge>
  );
}

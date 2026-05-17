import type {
  MultiTimeframeAlignment,
  RiskLevel,
  SignalDirection,
  SignalStatus
} from "../lib/signalpilot-api";

export function StatusBadge({ value }: { value: SignalStatus | string }) {
  return <span className={`badge status-${value.toLowerCase()}`}>{value}</span>;
}

export function DirectionBadge({ value }: { value: SignalDirection | string }) {
  return <span className={`badge direction-${value.toLowerCase()}`}>{value}</span>;
}

export function RiskBadge({ value }: { value: RiskLevel | string }) {
  return <span className={`badge risk-${value.toLowerCase()}`}>{value}</span>;
}

export function AlignmentBadge({ value }: { value: MultiTimeframeAlignment | string }) {
  return <span className={`badge alignment-${value.toLowerCase()}`}>{value}</span>;
}

export function HealthBadge({ ok }: { ok: boolean }) {
  return <span className={`badge ${ok ? "health-ok" : "health-fail"}`}>{ok ? "OK" : "DOWN"}</span>;
}

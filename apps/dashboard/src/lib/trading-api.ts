// Shadow-Trading-API-Client. Spiegelt exakt die implementierten Routen aus
// apps/api/src/routes/trading/{reads,operations}.ts (P6) — nicht die
// ursprünglich in docs/trading/08 skizzierten Routen, die teils abweichen
// (z. B. keine /trading/orders/:id, keine /trading/risk-assessments/:id,
// Mutationen unter /trading/operations/* statt pro-Resource-Pfaden).
//
// Alle Decimal-Felder sind Strings, alle Zeitfelder ISO-UTC-Strings.

import {
  buildQuery,
  fetchApi,
  mutateApi,
  type ApiResult
} from "./signalpilot-api";

export type TradeCandidateStatus =
  | "CREATED"
  | "VALIDATING"
  | "READY_FOR_RISK"
  | "APPROVED_FOR_SHADOW"
  | "INVALID"
  | "RISK_REJECTED"
  | "EXPIRED"
  | "CANCELLED";
export type TradeDirection = "LONG" | "SHORT";

export type RiskAssessmentStatus = "PASS" | "FAIL" | "ERROR";
export type RiskRuleOutcome = "PASS" | "FAIL" | "WARN" | "ERROR";
export type RiskSeverity = "INFO" | "WARNING" | "BLOCKER" | "CRITICAL";
export type TradeDecisionOutcome =
  | "APPROVE_SHADOW"
  | "REJECT"
  | "EXPIRE"
  | "CANCEL"
  | "ERROR";

export type ShadowOrderStatus =
  | "PROPOSED"
  | "ACCEPTED"
  | "WAITING_FOR_ENTRY"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED";
export type ShadowOrderPurpose = "ENTRY" | "EXIT";
export type ShadowOrderSide = "BUY" | "SELL";
export type ShadowFillTriggerType =
  | "ENTRY"
  | "STOP"
  | "TAKE_PROFIT"
  | "TIME_EXIT"
  | "INVALIDATION"
  | "MANUAL_RISK_CLOSE";

export type ShadowPositionStatus =
  | "OPENING"
  | "OPEN"
  | "PARTIALLY_CLOSED"
  | "CLOSED"
  | "STOPPED_OUT"
  | "INVALIDATED"
  | "ERROR";
export type ShadowPositionEventType =
  | "OPENING"
  | "OPENED"
  | "PARTIAL_CLOSE"
  | "CLOSED"
  | "STOPPED_OUT"
  | "INVALIDATED"
  | "MARKED"
  | "ERROR";

export type StrategyPerformanceWindow = "DAILY" | "ROLLING_30D" | "ALL_TIME";

export type TradingSessionStatus =
  | "STOPPED"
  | "SHADOW_ACTIVE"
  | "PAUSED"
  | "KILLED"
  | "ERROR_LOCKED"
  | "CLOSED";

export type RiskEventType =
  | "RISK_RULE_BLOCK"
  | "DAILY_LOSS_LIMIT"
  | "CONSECUTIVE_LOSS_LIMIT"
  | "PORTFOLIO_INCONSISTENCY"
  | "IDEMPOTENCY_OR_VERSION_CONFLICT"
  | "CONFIGURATION_INVALID"
  | "DATA_STALE"
  | "DATA_QUALITY"
  | "EXECUTION_PROFILE_CHANGE"
  | "SIMULATION_ERROR"
  | "WORKER_ERROR"
  | "RECONCILIATION_FINDING"
  | "ADMIN_ACTION";

export type TradingActorType = "SYSTEM" | "ADMIN" | "RECOVERY";
export type PortfolioStatus = string;
export type CircuitBreakerScope = "ENTRY" | "MONITORING";

export type TradingOverview = {
  asOf: string;
  portfolio: {
    id: string;
    key: string;
    status: string;
    availableCash: string;
    reservedCash: string;
  } | null;
  session: {
    id: string;
    status: TradingSessionStatus;
    killSwitchEngaged: boolean;
    heartbeatAt: string | null;
  } | null;
  openPositionCount: number;
  openOrderCount: number;
  tradesToday: number;
  unrealizedPnl: string;
  realizedPnl: string;
  equity: string;
  dailyPnl: string | null;
  drawdownAmount: string;
  drawdownPct: string;
  latestActivity: {
    candidate: {
      id: string;
      symbol: string | null;
      status: string;
      dataAsOf: string;
    } | null;
    riskAssessment: { id: string; status: string; assessedAt: string } | null;
    order: { id: string; status: string; createdAt: string } | null;
  };
  lastReconciledAt: string | null;
  workerHeartbeatAt: string | null;
  circuitBreakerBlocked: boolean;
  activeCriticalRiskEventCount: number;
};

export type PortfolioSummary = {
  id: string;
  key: string;
  name: string;
  baseCurrency: string;
  status: PortfolioStatus;
  startingCash: string;
  availableCash: string;
  reservedCash: string;
  realizedPnl: string;
  feesPaid: string;
  equity: string;
  highWaterMark: string;
  ledgerSequence: number;
  lastReconciledAt: string | null;
  version: number;
  updatedAt: string;
};

export type PortfolioSnapshot = {
  id: string;
  portfolioId: string;
  asOf: string;
  tradingDateUtc: string;
  availableCash: string;
  reservedCash: string;
  marketValue: string;
  equity: string;
  realizedPnl: string;
  unrealizedPnl: string;
  feesPaid: string;
  dailyPnl: string;
  highWaterMark: string;
  drawdownAmount: string;
  drawdownPct: string;
  grossExposure: string;
  openPositionCount: number;
};

export type StrategyAssignment = {
  id: string;
  portfolioId: string;
  assetId: string;
  symbol: string;
  timeframe: string;
  enabled: boolean;
  direction: TradeDirection | null;
  directionConsistent: boolean;
  strategyId: string;
  strategyKey: string;
  strategyName: string;
  strategyStatus: string;
  strategyVersionId: string;
  strategyVersion: number;
  strategyVersionStatus: string;
  strategyEngineVersion: string;
  strategySpecificationHash: string;
  syntheticShadowOnly: boolean;
  version: number;
  validFrom: string | null;
  validTo: string | null;
};

export type TradeCandidateListItem = {
  id: string;
  candidateKey: string;
  portfolioId: string;
  assetId: string;
  symbol: string | null;
  direction: TradeDirection;
  strategyAssignmentId: string;
  strategyVersionId: string;
  strategyKey: string | null;
  strategyName: string | null;
  strategyVersion: number | null;
  strategyEngineVersion: string | null;
  strategyCodeVersion: string | null;
  strategySpecificationHash: string | null;
  entryType: string;
  status: TradeCandidateStatus;
  referenceEntryPrice: string;
  stopPrice: string;
  takeProfitPrice: string;
  minimumRewardRisk: string;
  plannedRewardRisk: string;
  invalidReasonCode: string | null;
  cancelReasonCode: string | null;
  dataAsOf: string;
  decisionTime: string;
  expiresAt: string;
};

export type TradeCandidateDetail = TradeCandidateListItem & {
  stopDistance: string;
  stopDistancePct: string;
  plannedEntryMinimum: string;
  plannedEntryMaximum: string;
  maximumEntryGapDistance: string;
  validFrom: string | null;
  earliestFillAt: string | null;
  maxHoldHours: number | null;
  strategyReasonCodes: unknown;
  latestRiskAssessment: RiskAssessment | null;
};

export type RiskRuleResult = {
  id: string;
  ruleCode: string;
  outcome: RiskRuleOutcome;
  reasonCode: string;
  severity: RiskSeverity;
};

export type RiskAssessment = {
  id: string;
  tradeCandidateId: string;
  portfolioId: string;
  status: RiskAssessmentStatus;
  ruleSetVersion: string;
  equity: string;
  availableCash: string;
  reservedCash: string;
  dailyPnl: string;
  grossExposure: string;
  assetExposure: string;
  correlatedExposure: string;
  requestedQuantity: string;
  approvedQuantity: string;
  riskAmount: string;
  openPositionCount: number;
  newTradesToday: number;
  consecutiveLosses: number;
  tradingDateUtc: string;
  assessedAt: string;
  ruleResults: RiskRuleResult[];
  decision: {
    id: string;
    outcome: TradeDecisionOutcome;
    reasonCode: string;
    decidedAt: string;
  } | null;
};

export type ShadowOrder = {
  id: string;
  orderKey: string;
  portfolioId: string;
  assetId: string;
  symbol: string | null;
  tradeCandidateId: string | null;
  shadowPositionId: string | null;
  purpose: ShadowOrderPurpose;
  direction: TradeDirection;
  side: ShadowOrderSide;
  strategyVersionId: string | null;
  strategyVersion: number | null;
  strategyKey: string | null;
  strategyName: string | null;
  syntheticShadowShort: boolean;
  exchangePosition: false;
  orderType: string;
  timeInForce: string;
  status: ShadowOrderStatus;
  requestedQuantity: string;
  filledQuantity: string;
  remainingQuantity: string;
  referencePrice: string;
  reservedQuoteAmount: string;
  rejectionReasonCode: string | null;
  cancelReasonCode: string | null;
  earliestFillAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ShadowFill = {
  id: string;
  fillKey: string;
  shadowOrderId: string;
  shadowPositionId: string | null;
  assetId: string;
  symbol: string | null;
  side: ShadowOrderSide;
  direction: TradeDirection | null;
  strategyVersionId: string | null;
  strategyVersion: number | null;
  strategyKey: string | null;
  strategyName: string | null;
  syntheticShadowShort: boolean;
  exchangePosition: false;
  quantity: string;
  referencePrice: string;
  spreadAmount: string;
  slippageAmount: string;
  fillPrice: string;
  notional: string;
  feeAmount: string;
  feeAsset: string;
  triggerType: ShadowFillTriggerType;
  occurredAt: string;
};

export type ShadowPositionListItem = {
  id: string;
  positionKey: string;
  portfolioId: string;
  assetId: string;
  symbol: string | null;
  direction: TradeDirection;
  strategyAssignmentId: string;
  strategyVersionId: string;
  strategyVersion: number | null;
  strategyKey: string | null;
  strategyName: string | null;
  syntheticShadowShort: boolean;
  exchangePosition: false;
  status: ShadowPositionStatus;
  initialQuantity: string;
  openQuantity: string;
  closedQuantity: string;
  averageEntryPrice: string;
  averageExitPrice: string;
  realizedPnl: string;
  feesPaid: string;
  reservedCollateral: string;
  exitReason: ShadowFillTriggerType | string | null;
  stopPrice: string;
  takeProfitPrice: string;
  maxHoldUntil: string;
  openedAt: string | null;
  closedAt: string | null;
  version: number;
};

export type ShadowPositionEvent = {
  id: string;
  sequence: number;
  type: ShadowPositionEventType;
  quantity: string;
  price: string;
  realizedPnlDelta: string;
  occurredAt: string;
};

export type ShadowPositionDetail = ShadowPositionListItem & {
  grossEntryNotional: string;
  grossExitNotional: string;
  lastValuationAt: string | null;
  exitPlans: Array<{
    id: string;
    version: number;
    status: string;
    triggeredBy: string | null;
    triggeredAt: string | null;
  }>;
  events: ShadowPositionEvent[];
};

export type StrategyPerformance = {
  id: string;
  strategyVersionId: string;
  portfolioId: string;
  window: StrategyPerformanceWindow;
  asOf: string;
  from: string;
  to: string;
  closedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  grossPnl: string;
  netPnl: string;
  fees: string;
  averageR: string;
  profitFactor: string;
  maxDrawdownPct: string;
};

export type TradingSession = {
  id: string;
  sessionKey: string;
  portfolioId: string;
  mode: string;
  status: TradingSessionStatus;
  killSwitchEngaged: boolean;
  killReasonCode: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  killedAt: string | null;
  closedAt: string | null;
  reconciledAt: string | null;
  heartbeatAt: string | null;
  version: number;
  updatedAt: string;
};

export type RiskEvent = {
  id: string;
  type: RiskEventType;
  severity: RiskSeverity;
  reasonCode: string;
  portfolioId: string;
  tradeCandidateId: string | null;
  shadowOrderId: string | null;
  shadowPositionId: string | null;
  tradingSessionId: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
};

export type TradingAuditEvent = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  actorType: TradingActorType;
  actorId: string | null;
  reasonCode: string;
  tradingSessionId: string | null;
  beforeState: unknown;
  afterState: unknown;
  occurredAt: string;
};

export type WorkerJobStatus = {
  jobKey: string;
  cronExpression: string;
  scope: CircuitBreakerScope;
  nextScheduledRunAt: string | null;
  lastRun: {
    status: "SUCCESS" | "FAILED" | "RUNNING";
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
  } | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lease: {
    claimedBy: string | null;
    claimedAt: string | null;
    claimExpiresAt: string | null;
    active: boolean;
  } | null;
  circuitBreaker: {
    state: string;
    allowed: boolean;
    reasonCode: string | null;
    cooldownUntil: string | null;
    policyVersion: string | number;
  };
};

export type WorkerStatus = {
  asOf: string;
  portfolioId: string | null;
  session: {
    id: string;
    status: TradingSessionStatus;
    killSwitchEngaged: boolean;
    heartbeatAt: string | null;
    reconciledAt: string | null;
  } | null;
  jobs: WorkerJobStatus[];
};

export type OperationEnvelope<T = unknown> = {
  replayed: boolean;
  result: T;
};

export type PaginationParams = {
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
};

export function buildTradingQuery(
  params: Record<string, string | number | undefined>
): string {
  return buildQuery(params);
}

// Server-Aufrufe (Server Components) und Client-Mutationen teilen sich
// dieselben fetchApi/mutateApi-Helfer aus signalpilot-api.ts — kein separater
// Cache, keine unbegrenzten Requests (jede Liste verlangt ein `limit`).

export function fetchTradingOverview() {
  return fetchApi<TradingOverview>("/trading/overview");
}

export function fetchTradingPortfolio() {
  return fetchApi<PortfolioSummary>("/trading/portfolio");
}

export function fetchTradingPortfolioSnapshots(
  params: PaginationParams & { portfolioId?: string }
) {
  return fetchApi<PortfolioSnapshot[]>(
    `/trading/portfolio/snapshots${buildQuery(params)}`
  );
}

export function fetchStrategyAssignments(
  params: PaginationParams & {
    assetId?: string;
    direction?: string;
    enabled?: "true" | "false";
  }
) {
  return fetchApi<StrategyAssignment[]>(
    `/trading/assignments${buildQuery(params)}`
  );
}

export function fetchTradeCandidates(
  params: PaginationParams & {
    status?: string;
    assetId?: string;
    direction?: string;
    strategyVersionId?: string;
  }
) {
  return fetchApi<TradeCandidateListItem[]>(
    `/trading/candidates${buildQuery(params)}`
  );
}

export function fetchTradeCandidateDetail(id: string) {
  return fetchApi<TradeCandidateDetail>(
    `/trading/candidates/${encodeURIComponent(id)}`
  );
}

export function fetchRiskAssessments(
  params: PaginationParams & {
    status?: string;
    tradeCandidateId?: string;
    portfolioId?: string;
  }
) {
  return fetchApi<RiskAssessment[]>(
    `/trading/risk-assessments${buildQuery(params)}`
  );
}

export function fetchShadowOrders(
  params: PaginationParams & {
    status?: string;
    purpose?: string;
    assetId?: string;
    portfolioId?: string;
    direction?: string;
    strategyVersionId?: string;
  }
) {
  return fetchApi<ShadowOrder[]>(`/trading/orders${buildQuery(params)}`);
}

export function fetchShadowFills(
  params: PaginationParams & {
    assetId?: string;
    orderId?: string;
    positionId?: string;
    direction?: string;
    strategyVersionId?: string;
  }
) {
  return fetchApi<ShadowFill[]>(`/trading/fills${buildQuery(params)}`);
}

export function fetchShadowPositions(
  params: PaginationParams & {
    assetId?: string;
    portfolioId?: string;
    open?: "true" | "false";
    direction?: string;
    strategyVersionId?: string;
  }
) {
  return fetchApi<ShadowPositionListItem[]>(
    `/trading/positions${buildQuery(params)}`
  );
}

export function fetchShadowPositionDetail(id: string) {
  return fetchApi<ShadowPositionDetail>(
    `/trading/positions/${encodeURIComponent(id)}`
  );
}

export function fetchStrategyPerformance(
  params: PaginationParams & {
    window?: string;
    portfolioId?: string;
    strategyVersionId?: string;
  }
) {
  return fetchApi<StrategyPerformance[]>(
    `/trading/performance${buildQuery(params)}`
  );
}

export function fetchTradingSessions(
  params: PaginationParams & { portfolioId?: string }
) {
  return fetchApi<TradingSession[]>(`/trading/sessions${buildQuery(params)}`);
}

export function fetchRiskEvents(
  params: PaginationParams & {
    type?: string;
    severity?: string;
    portfolioId?: string;
    acknowledged?: "true" | "false";
  }
) {
  return fetchApi<RiskEvent[]>(`/trading/risk-events${buildQuery(params)}`);
}

export function fetchTradingAudit(
  params: PaginationParams & {
    aggregateType?: string;
    aggregateId?: string;
    eventType?: string;
    sessionId?: string;
  }
) {
  return fetchApi<TradingAuditEvent[]>(`/trading/audit${buildQuery(params)}`);
}

export function fetchWorkerStatus() {
  return fetchApi<WorkerStatus>("/trading/worker-status");
}

// ── Operationen (Mutationen) ────────────────────────────────────────────────
// Jede Mutation braucht ein frisch geholtes CSRF-Token (Double-Submit-Cookie).
// Ein 404 hier bedeutet "Operationen sind serverseitig deaktiviert", kein
// technischer Fehler — die UI muss das als deaktiviert behandeln, nicht als
// harten Fehler.

export async function fetchTradingCsrfToken(): Promise<
  ApiResult<{ csrfToken: string }>
> {
  return fetchApi<{ csrfToken: string }>("/trading/csrf-token");
}

export async function postTradingOperation<T = unknown>(
  path: string,
  body: Record<string, unknown>
): Promise<ApiResult<OperationEnvelope<T>>> {
  const csrf = await fetchTradingCsrfToken();

  if (csrf.error || !csrf.data) {
    return {
      data: null,
      error:
        csrf.error === "Unauthorized"
          ? "Unauthorized"
          : "Operationen sind derzeit nicht verfügbar (Feature-Flag oder CSRF-Ausgabe fehlgeschlagen)."
    };
  }

  return mutateApi<OperationEnvelope<T>>(path, {
    method: "POST",
    headers: { "x-trading-csrf-token": csrf.data.csrfToken },
    body: JSON.stringify(body)
  });
}

export const RUN_JOB_ALLOWLIST = [
  "shadow-start-trading-day",
  "shadow-generate-candidates",
  "shadow-assess-risk",
  "shadow-create-orders",
  "shadow-process-fills",
  "shadow-monitor-positions",
  "shadow-reconcile-portfolio",
  // P8. shadow-retention läuft über diesen Weg ausschließlich als Dry-Run —
  // die API übergibt niemals `apply`.
  "shadow-performance-refresh",
  "shadow-alert-outbox",
  "shadow-retention"
] as const;

export type RunJobName = (typeof RUN_JOB_ALLOWLIST)[number];

export function isAllowedJobName(value: string): value is RunJobName {
  return (RUN_JOB_ALLOWLIST as readonly string[]).includes(value);
}

export const RUN_JOB_LABELS: Record<RunJobName, string> = {
  "shadow-start-trading-day": "Handelstag starten",
  "shadow-generate-candidates": "Kandidaten generieren",
  "shadow-assess-risk": "Risiko bewerten",
  "shadow-create-orders": "Orders erstellen",
  "shadow-process-fills": "Fills simulieren",
  "shadow-monitor-positions": "Positionen überwachen",
  "shadow-reconcile-portfolio": "Portfolio abgleichen",
  "shadow-performance-refresh": "Performance neu berechnen",
  "shadow-alert-outbox": "Alerts sammeln und zustellen",
  "shadow-retention": "Retention (nur Dry-Run)"
};

export const CONFIRM_PHRASES = {
  activatePortfolio: "ACTIVATE_PORTFOLIO",
  activateSession: "ACTIVATE_SESSION",
  pauseSession: "PAUSE_SESSION",
  engageKillSwitch: "ENGAGE_KILL_SWITCH",
  releaseKillSwitch: "RELEASE_KILL_SWITCH",
  unlockSession: "UNLOCK_SESSION",
  manualRiskClose: "MANUAL_RISK_CLOSE",
  runJob: "RUN_JOB"
} as const;

// Seit P8 liefert die API bei 409 ein strukturiertes Feld `currentVersion`
// (plus `expectedVersion`, `entityType`, `entityId`). Diese Funktion bleibt als
// Fallback für Antworten bestehen, die nur den Satz "Current version is <N>."
// enthalten — sie ist nicht mehr der primäre Weg.
export function parseVersionFromConflictMessage(
  message: string
): number | null {
  const match = message.match(/version is (\d+)/i);
  return match ? Number(match[1]) : null;
}

export type TradingVersionConflict = {
  reasonCode: "VERSION_CONFLICT";
  currentVersion: number;
  expectedVersion: number;
  entityType: string;
  entityId: string | null;
  message: string;
};

/** Bevorzugter Weg: die strukturierten Felder aus dem 409-Body lesen. */
export function readVersionConflict(
  body: unknown
): TradingVersionConflict | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (
    record.reasonCode !== "VERSION_CONFLICT" ||
    typeof record.currentVersion !== "number"
  )
    return null;
  return {
    reasonCode: "VERSION_CONFLICT",
    currentVersion: record.currentVersion,
    expectedVersion:
      typeof record.expectedVersion === "number" ? record.expectedVersion : -1,
    entityType:
      typeof record.entityType === "string" ? record.entityType : "unknown",
    entityId: typeof record.entityId === "string" ? record.entityId : null,
    message: typeof record.message === "string" ? record.message : ""
  };
}

// ── P8: Performance-Segmente, Alert-Outbox, Audit-Drilldown, Eligibility ────
// Alle Decimal-Felder bleiben Strings. `null` heißt hier immer "nicht
// berechenbar" — die Begründung steht in `nullReasons` und darf im Frontend
// niemals als 0 dargestellt werden.

export type StrategyPerformanceSegmentType =
  | "OVERALL"
  | "DIRECTION"
  | "STRATEGY_VERSION"
  | "ASSET"
  | "MARKET_REGIME"
  | "EXIT_REASON";

export type PerformanceProvenance = {
  engineVersion: string;
  codeVersion: string;
  inputHash: string;
  outputHash: string;
  dataThroughAt: string | null;
  computedAt: string | null;
  sourceThroughPositionEventId: string | null;
  createdAt: string;
};

export type PerformanceSegment = {
  id: string;
  snapshotKey: string;
  portfolioId: string;
  strategyVersionId: string | null;
  window: StrategyPerformanceWindow;
  segmentType: StrategyPerformanceSegmentType;
  segmentKey: string;
  segmentLabel: string;
  asOf: string;
  from: string;
  to: string;

  closedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRatePct: string | null;

  grossPnl: string;
  netPnl: string;
  fees: string;
  simulatedExecutionCost: string;
  grossProfit: string;
  grossLoss: string;

  averageWin: string | null;
  averageLoss: string | null;
  profitFactor: string;
  expectancy: string;

  averageR: string;
  cumulativeR: string | null;
  tradesWithPlannedRisk: number;

  maxWinStreak: number;
  maxLossStreak: number;

  maxDrawdownAmount: string | null;
  maxDrawdownPct: string;
  recoveryFactor: string | null;

  averageHoldMinutes: string;
  exposureMinutes: string;
  exposurePct: string | null;

  averageMaePct: string | null;
  averageMfePct: string | null;

  sharpeRatio: string | null;
  sortinoRatio: string | null;
  returnObservations: number;

  assessedCandidates: number;
  riskRejectedCandidates: number;
  invalidCandidates: number;
  expiredCandidates: number;
  riskRejectionRatePct: string | null;

  provenance: PerformanceProvenance;
  nullReasons: Record<string, string>;
};

export type PerformanceLatestRun = {
  portfolioId: string;
  window: StrategyPerformanceWindow;
  provenance: {
    asOf: string;
    from: string;
    to: string;
    engineVersion: string;
    codeVersion: string;
    inputHash: string;
    outputHash: string;
    dataThroughAt: string | null;
    computedAt: string | null;
  } | null;
  segments: PerformanceSegment[];
  engineVersions: Array<{
    engineVersion: string;
    snapshots: number;
    latestAsOf: string | null;
  }>;
};

export type TradingAlertOutboxStatus =
  | "PENDING"
  | "PROCESSING"
  | "SENT"
  | "FAILED"
  | "DEAD";

export type TradingAlertEventType =
  | "SESSION_ERROR_LOCKED"
  | "KILL_SWITCH_ENGAGED"
  | "RECONCILIATION_FAILED"
  | "CRITICAL_RISK_EVENT"
  | "POSITION_WITHOUT_SAFE_EXIT"
  | "CIRCUIT_BREAKER_OPEN"
  | "WORKER_HEARTBEAT_STALE"
  | "POSITION_MONITOR_STALE"
  | "DAILY_LOSS_LIMIT_REACHED"
  | "PORTFOLIO_LEDGER_CONFLICT";

export type AlertOutboxAttempt = {
  id: string;
  attempt: number;
  status: TradingAlertOutboxStatus;
  error: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export type AlertOutboxEntry = {
  id: string;
  idempotencyKey: string;
  eventType: TradingAlertEventType;
  severity: RiskSeverity;
  status: TradingAlertOutboxStatus;
  aggregateType: string;
  aggregateId: string;
  portfolioId: string | null;
  tradingSessionId: string | null;
  reasonCode: string;
  payload: unknown;
  payloadHash: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  sentAt: string | null;
  deadLetteredAt: string | null;
  alertId: string | null;
  createdAt: string;
  updatedAt: string;
  attempts: AlertOutboxAttempt[];
};

export type AlertOutboxSummary = {
  asOf: string;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  dead: number;
  oldestPending: { id: string; eventType: string; createdAt: string } | null;
  lastSent: { id: string; eventType: string; sentAt: string | null } | null;
};

export type AuditChainNode = {
  aggregateType: string;
  aggregateId: string;
  label: string;
  status: string | null;
  occurredAt: string | null;
  reasonCodes: string[];
  version: number | null;
};

export type AuditChainEvent = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  actorType: TradingActorType;
  actorId: string | null;
  reasonCode: string;
  correlationId: string;
  causationId: string;
  tradingSessionId: string | null;
  engineVersion: string | null;
  codeVersion: string | null;
  inputHash: string | null;
  outputHash: string | null;
  beforeState: unknown;
  afterState: unknown;
  occurredAt: string;
};

export type AuditDrilldown = {
  rootAggregateType: string;
  rootAggregateId: string;
  found: boolean;
  chain: AuditChainNode[];
  events: AuditChainEvent[];
  correlationIds: string[];
  truncated: boolean;
};

export const DRILLDOWN_AGGREGATE_TYPES = [
  "TradeCandidate",
  "RiskAssessment",
  "ShadowOrder",
  "ShadowFill",
  "ShadowPosition",
  "TradingSession"
] as const;

export type EligibilityStatus = "READY" | "NOT_READY" | "ERROR";

export type EligibilityCheck = {
  code: string;
  label: string;
  outcome: "PASS" | "FAIL" | "WARN";
  blocking: boolean;
  reason: string;
  details?: Record<string, unknown>;
};

export type EligibilityReport = {
  status: EligibilityStatus;
  asOf: string;
  reportVersion: string;
  checks: EligibilityCheck[];
  blockingFailures: string[];
  warnings: string[];
};

export function fetchPerformanceSegments(
  params: PaginationParams & {
    window?: string;
    segmentType?: string;
    segmentKey?: string;
    portfolioId?: string;
    strategyVersionId?: string;
    engineVersion?: string;
  }
) {
  return fetchApi<PerformanceSegment[]>(
    `/trading/performance/segments${buildQuery(params)}`
  );
}

export function fetchLatestPerformanceRun(params: {
  window?: string;
  portfolioId?: string;
}) {
  return fetchApi<PerformanceLatestRun>(
    `/trading/performance/latest${buildQuery(params)}`
  );
}

export function fetchAlertOutbox(
  params: PaginationParams & {
    status?: string;
    eventType?: string;
    severity?: string;
    portfolioId?: string;
  }
) {
  return fetchApi<AlertOutboxEntry[]>(
    `/trading/alerts/outbox${buildQuery(params)}`
  );
}

export function fetchAlertOutboxSummary() {
  return fetchApi<AlertOutboxSummary>("/trading/alerts/summary");
}

export function fetchAuditDrilldown(params: {
  aggregateType: string;
  aggregateId: string;
  limit?: number;
}) {
  return fetchApi<AuditDrilldown>(
    `/trading/audit/drilldown${buildQuery(params)}`
  );
}

export function fetchEligibilityReport() {
  return fetchApi<EligibilityReport>("/trading/eligibility");
}

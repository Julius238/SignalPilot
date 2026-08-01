import type {
  DiscoveryPolicy,
  UniverseSelectionCandidate,
  UniverseSelectionDecision,
  UniverseSelectionResult
} from "./types.js";

export function selectActiveUniverse(
  candidates: UniverseSelectionCandidate[],
  policy: DiscoveryPolicy,
  now: Date = new Date()
): UniverseSelectionResult {
  const decisions: UniverseSelectionDecision[] = [];
  const byId = new Map(candidates.map((candidate) => [candidate.assetId, candidate]));
  const selected = new Set<string>();
  const active = candidates.filter((candidate) => candidate.isActive);

  for (const candidate of active) {
    if (candidate.isCore || candidate.isPinned || candidate.isManual) {
      selected.add(candidate.assetId);
      decisions.push(decision(candidate, "KEEP", mandatoryReason(candidate)));
    }
  }

  const eligible = candidates
    .filter((candidate) => isEligible(candidate, policy, now))
    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));

  for (const candidate of eligible) {
    if (selected.has(candidate.assetId)) continue;

    if (candidate.isActive && canFit(candidate, selected, byId, policy)) {
      selected.add(candidate.assetId);
      decisions.push(decision(candidate, "KEEP", "ACTIVE_INCUMBENT"));
    }
  }

  let additionsUsed = 0;
  let removalsUsed = 0;

  for (const candidate of eligible) {
    if (candidate.isActive || selected.has(candidate.assetId)) continue;
    if (additionsUsed >= policy.maxAdditionsPerRun) break;
    if (candidate.cooldownUntil && candidate.cooldownUntil > now) {
      decisions.push(decision(candidate, "IGNORE", "REMOVAL_COOLDOWN_ACTIVE"));
      continue;
    }

    const replacement = findReplacement(candidate, selected, byId, policy, now);
    if (!replacement || removalsUsed >= policy.maxRemovalsPerRun) {
      continue;
    }

    selected.delete(replacement.assetId);
    selected.add(candidate.assetId);
    additionsUsed += 1;
    removalsUsed += 1;
    decisions.push(
      decision(
        replacement,
        "REMOVE",
        `REPLACED_BY_${candidate.symbol}_DELTA_${round(candidate.score - replacement.score)}`
      )
    );
    decisions.push(
      decision(
        candidate,
        "ADD",
        `MATERIALLY_BETTER_THAN_${replacement.symbol}_DELTA_${round(candidate.score - replacement.score)}`
      )
    );
  }

  for (const candidate of eligible) {
    if (candidate.isActive || selected.has(candidate.assetId)) continue;
    if (additionsUsed >= policy.maxAdditionsPerRun) break;
    if (candidate.cooldownUntil && candidate.cooldownUntil > now) continue;
    if (!canFit(candidate, selected, byId, policy)) continue;

    selected.add(candidate.assetId);
    additionsUsed += 1;
    decisions.push(decision(candidate, "ADD", "OPEN_CAPACITY_AND_POLICY_MATCH"));
  }

  for (const candidate of active) {
    if (selected.has(candidate.assetId)) continue;
    if (decisions.some((item) => item.assetId === candidate.assetId && item.action === "REMOVE")) {
      continue;
    }
    if (!canRemove(candidate, policy, now) || removalsUsed >= policy.maxRemovalsPerRun) {
      selected.add(candidate.assetId);
      decisions.push(
        decision(
          candidate,
          "KEEP",
          canRemove(candidate, policy, now) ? "REMOVAL_LIMIT_REACHED" : "STABILITY_GUARD"
        )
      );
      continue;
    }

    removalsUsed += 1;
    decisions.push(decision(candidate, "REMOVE", removalReason(candidate, policy)));
  }

  for (const candidate of candidates) {
    if (decisions.some((item) => item.assetId === candidate.assetId)) continue;
    decisions.push(
      decision(
        candidate,
        "IGNORE",
        candidate.isExcluded
          ? "USER_EXCLUDED"
          : candidate.isObserveOnly
            ? "USER_OBSERVE_ONLY"
            : !candidate.eligible
              ? "HARD_QUALITY_GATE"
              : candidate.score < policy.minimumScore
                ? "BELOW_MINIMUM_SCORE"
                : "DIVERSIFICATION_OR_CAPACITY_LIMIT"
      )
    );
  }

  return {
    selectedAssetIds: [...selected],
    decisions,
    additions: decisions.filter((item) => item.action === "ADD"),
    removals: decisions.filter((item) => item.action === "REMOVE"),
    retained: decisions.filter((item) => item.action === "KEEP"),
    ignored: decisions.filter((item) => item.action === "IGNORE")
  };
}

function isEligible(candidate: UniverseSelectionCandidate, policy: DiscoveryPolicy, now: Date) {
  return (
    candidate.eligible &&
    !candidate.isExcluded &&
    !candidate.isObserveOnly &&
    candidate.score >= policy.minimumScore &&
    candidate.dataQuality >= policy.minimumDataQuality &&
    candidate.liquidity >= policy.minimumLiquidity &&
    (!candidate.cooldownUntil || candidate.cooldownUntil <= now || candidate.isActive)
  );
}

function canFit(
  candidate: UniverseSelectionCandidate,
  selected: Set<string>,
  byId: Map<string, UniverseSelectionCandidate>,
  policy: DiscoveryPolicy
) {
  const selectedCandidates = [...selected].map((id) => byId.get(id)).filter(isCandidate);
  const classCount = selectedCandidates.filter(
    (item) => item.assetType === candidate.assetType
  ).length;
  if (classCount >= policy.activeLimits[candidate.assetType]) return false;

  if (candidate.sector) {
    const sectorCount = selectedCandidates.filter(
      (item) => item.sector && item.sector === candidate.sector
    ).length;
    if (sectorCount >= policy.maxPerSector) return false;
  }

  if (candidate.correlationGroup) {
    const correlatedCount = selectedCandidates.filter((item) =>
      isCorrelated(candidate, item, policy)
    ).length;
    if (correlatedCount >= policy.maxCorrelatedAssets) return false;
  } else if (
    selectedCandidates.filter((item) => isCorrelated(candidate, item, policy)).length >=
    policy.maxCorrelatedAssets
  ) {
    return false;
  }

  return true;
}

function findReplacement(
  incoming: UniverseSelectionCandidate,
  selected: Set<string>,
  byId: Map<string, UniverseSelectionCandidate>,
  policy: DiscoveryPolicy,
  now: Date
) {
  const selectedCandidates = [...selected].map((id) => byId.get(id)).filter(isCandidate);
  const sameClass = selectedCandidates.filter(
    (item) =>
      item.assetType === incoming.assetType &&
      !item.isCore &&
      !item.isPinned &&
      !item.isManual &&
      canRemove(item, policy, now)
  );
  const conflicts = sameClass.filter(
    (item) =>
      (incoming.sector &&
        item.sector === incoming.sector &&
        selectedCandidates.filter((selectedItem) => selectedItem.sector === incoming.sector)
          .length >= policy.maxPerSector) ||
      (incoming.correlationGroup &&
        isCorrelated(incoming, item, policy) &&
        selectedCandidates.filter(
          (selectedItem) => isCorrelated(incoming, selectedItem, policy)
        ).length >= policy.maxCorrelatedAssets) ||
      (!incoming.correlationGroup &&
        isCorrelated(incoming, item, policy) &&
        selectedCandidates.filter((selectedItem) =>
          isCorrelated(incoming, selectedItem, policy)
        ).length >= policy.maxCorrelatedAssets) ||
      selectedCandidates.filter((selectedItem) => selectedItem.assetType === incoming.assetType)
        .length >= policy.activeLimits[incoming.assetType]
  );
  const weakest = conflicts.sort((left, right) => left.score - right.score)[0];
  return weakest && incoming.score >= weakest.score + policy.replacementScoreDelta
    ? weakest
    : null;
}

function canRemove(candidate: UniverseSelectionCandidate, policy: DiscoveryPolicy, now: Date) {
  if (candidate.isCore || candidate.isPinned || candidate.isManual) return false;
  if (!candidate.activeSince) return true;
  const activeDays = (now.getTime() - candidate.activeSince.getTime()) / 86_400_000;
  return activeDays >= policy.minimumDaysActive;
}

function removalReason(candidate: UniverseSelectionCandidate, policy: DiscoveryPolicy) {
  if (!candidate.eligible) return "NO_LONGER_ELIGIBLE";
  if (candidate.dataQuality < policy.minimumDataQuality) return "DATA_QUALITY_BELOW_MINIMUM";
  if (candidate.liquidity < policy.minimumLiquidity) return "LIQUIDITY_BELOW_MINIMUM";
  if (candidate.score < policy.minimumScore) return "SCORE_BELOW_MINIMUM";
  return "OUTSIDE_DIVERSIFIED_SELECTION";
}

function mandatoryReason(candidate: UniverseSelectionCandidate) {
  if (candidate.isCore) return "CORE_PROTECTED";
  if (candidate.isPinned) return "USER_PIN_PROTECTED";
  return "MANUAL_SELECTION_PROTECTED";
}

function decision(
  candidate: UniverseSelectionCandidate,
  action: UniverseSelectionDecision["action"],
  reason: string
): UniverseSelectionDecision {
  return {
    assetId: candidate.assetId,
    symbol: candidate.symbol,
    action,
    reason,
    score: candidate.score
  };
}

function isCandidate(
  value: UniverseSelectionCandidate | undefined
): value is UniverseSelectionCandidate {
  return value !== undefined;
}

function isCorrelated(
  left: UniverseSelectionCandidate,
  right: UniverseSelectionCandidate,
  policy: DiscoveryPolicy
) {
  const explicit = left.correlations?.[right.assetId] ?? right.correlations?.[left.assetId];
  if (explicit !== undefined && Math.abs(explicit) >= policy.correlationThreshold) return true;
  return Boolean(
    left.correlationGroup &&
      right.correlationGroup &&
      left.correlationGroup === right.correlationGroup
  );
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

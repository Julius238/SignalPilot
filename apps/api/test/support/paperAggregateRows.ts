import { aggregateEvaluations, type PaperEvaluationLike } from "@signalpilot/performance-intelligence";

/** What PostgreSQL returns for the paper aggregate query, for an in-memory database double. */
export function paperAggregateRows(evaluations: PaperEvaluationLike[]): Array<Record<string, unknown>> {
  const all = 0b11111111;
  const grouping = (position: number) => all ^ (1 << (7 - position));
  const dimensions = ["signalType", "timeframe", "symbol", "status", "riskLevel", "evaluationKind"] as const;
  const keyed: Array<{ bits: number; key: string | null; rows: Array<[number, PaperEvaluationLike]> }> = [];
  const entries = evaluations.map((evaluation, index): [number, PaperEvaluationLike] => [index, evaluation]);
  const group = (bits: number, key: (evaluation: PaperEvaluationLike) => string) => {
    const groups = new Map<string, Array<[number, PaperEvaluationLike]>>();
    for (const entry of entries) {
      const name = key(entry[1]);
      groups.set(name, [...(groups.get(name) ?? []), entry]);
    }
    for (const [name, rows] of groups) keyed.push({ bits, key: name, rows });
  };

  keyed.push({ bits: all, key: null, rows: entries });
  dimensions.forEach((dimension, position) => group(grouping(position), (e) => String(e[dimension])));
  group(grouping(6), (e) => (e.score < 50 ? "0-49" : e.score < 65 ? "50-64" : e.score < 80 ? "65-79" : "80-100"));
  group(grouping(7), (e) => e.skipReason ?? "Unspecified");

  return keyed.map(({ bits, key, rows }) => {
    const values = rows.map(([, evaluation]) => evaluation);
    const { overall, observation } = aggregateEvaluations(values);
    const outcomes = (outcome: string) => values.filter((e) => e.outcome === outcome).length;
    const row: Record<string, unknown> = {
      grouping: bits,
      key,
      firstTid: rows[0] === undefined ? null : `(0,${rows[0][0] + 1})`,
      firstSkippedTid: tidOf(rows.find(([, e]) => e.evaluationStatus === "SKIPPED")),
      total: overall.total,
      evaluatedCount: overall.evaluatedCount,
      skippedCount: overall.skippedCount,
      positiveCount: overall.positiveCount,
      negativeCount: overall.negativeCount,
      neutralCount: overall.neutralCount,
      targetReachedCount: overall.targetReachedCount,
      invalidatedCount: overall.invalidatedCount,
      observationTotal: observation.total,
      observationEvaluated: observation.evaluatedCount,
      observationPositive: observation.positiveMovementCount,
      observationNeutral: observation.neutralCount,
      observationNegative: observation.negativeCount,
      observationAbsSum: observation.absReturnAfter1d.sum,
      observationAbsCount: observation.absReturnAfter1d.count,
      openCount: values.filter((e) => e.evaluationStatus === "OPEN").length,
      positiveAllCount: outcomes("POSITIVE"),
      negativeAllCount: outcomes("NEGATIVE"),
      neutralAllCount: outcomes("NEUTRAL"),
      targetReachedAllCount: outcomes("TARGET_REACHED"),
      invalidatedAllCount: outcomes("INVALIDATED")
    };
    for (const metric of [
      "returnAfter1h",
      "returnAfter4h",
      "returnAfter1d",
      "returnAfter3d",
      "maxFavorableMove",
      "maxAdverseMove"
    ] as const) {
      row[`${metric}Sum`] = overall[metric].sum;
      row[`${metric}Count`] = overall[metric].count;
      const numbers = values.map((e) => e[metric]).filter((value): value is number => typeof value === "number");
      row[`${metric}AllSum`] = numbers.reduce((sum, value) => sum + value, 0);
      row[`${metric}AllCount`] = numbers.length;
    }
    return row;
  });
}

function tidOf(entry: [number, PaperEvaluationLike] | undefined) {
  return entry === undefined ? null : `(0,${entry[0] + 1})`;
}

/**
 * Regenerates the risk-engine golden fixtures.
 *
 * Run with: `node_modules/.bin/tsx test/support/generate-fixtures.ts`
 *
 * The files pin the exact verdict, size and both hashes, so a change in a rule,
 * a limit or the cost model shows up as a failing golden test instead of a
 * silent drift (docs/trading/06, "Risk-Engine-Goldenfälle").
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateRisk } from "../../src/index.js";

import { CRITICAL_CASES } from "./critical-cases.js";
import { buildApprovableSnapshot } from "./build-risk-snapshot.js";

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

const passSnapshot = buildApprovableSnapshot();
const passResult = evaluateRisk(passSnapshot);
writeFileSync(
  resolve(fixtureDir, "pass-10000-usdt.json"),
  `${JSON.stringify({ snapshot: passSnapshot, expected: passResult }, null, 2)}\n`,
  "utf8"
);

const criticalCases = CRITICAL_CASES.map((testCase) => {
  const result = evaluateRisk(testCase.build());
  return {
    name: testCase.name,
    expectedOutcome: testCase.expectedOutcome,
    expectedReasonCode: testCase.expectedReasonCode,
    outcome: result.outcome,
    directive: result.directive,
    primaryReasonCode: result.primaryReasonCode,
    approvedQuantity: result.assessment.approvedQuantity,
    riskAmount: result.assessment.riskAmount,
    netRewardRisk: result.assessment.sizing.netRewardRisk,
    failedRules: result.ruleResults
      .filter((rule) => rule.outcome !== "PASS")
      .map((rule) => `${rule.ruleCode}:${rule.reasonCode}`),
    inputHash: result.inputHash,
    outputHash: result.outputHash
  };
});

writeFileSync(
  resolve(fixtureDir, "critical-cases.json"),
  `${JSON.stringify(criticalCases, null, 2)}\n`,
  "utf8"
);

process.stdout.write(
  `pass-10000-usdt.json: ${passResult.outcome} qty=${passResult.assessment.approvedQuantity} ${passResult.outputHash}\n` +
    `critical-cases.json: ${criticalCases.length} cases\n`
);

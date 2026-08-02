import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DecimalValue, canonicalize } from "@signalpilot/trading-domain";

import {
  RISK_LIMIT_SET_SPECIFICATION_HASH,
  RISK_POLICY_HASH,
  evaluateRisk,
  type RiskEvaluationResultV1,
  type RiskInputSnapshotV1
} from "../src/index.js";

import { CRITICAL_CASES } from "./support/critical-cases.js";

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(fixtureDir, name), "utf8")) as T;

interface CriticalFixture {
  readonly name: string;
  readonly expectedOutcome: string;
  readonly expectedReasonCode: string;
  readonly outcome: string;
  readonly directive: string;
  readonly primaryReasonCode: string;
  readonly approvedQuantity: string;
  readonly riskAmount: string;
  readonly netRewardRisk: string;
  readonly failedRules: readonly string[];
  readonly inputHash: string;
  readonly outputHash: string;
}

describe("golden fixtures", () => {
  const pass = readFixture<{
    snapshot: RiskInputSnapshotV1;
    expected: RiskEvaluationResultV1;
  }>("pass-10000-usdt.json");

  it("reproduces pass-10000-usdt.json byte for byte", () => {
    assert.equal(canonicalize(evaluateRisk(pass.snapshot)), canonicalize(pass.expected));
  });

  it("keeps the worst-case risk at or below 25 USDT on 10 000 USDT equity", () => {
    // docs/trading/06, golden case 1.
    const result = evaluateRisk(pass.snapshot);
    assert.equal(result.outcome, "APPROVED");
    assert.equal(result.assessment.equity, "10000.000000000000");
    assert.ok(DecimalValue.fromString(result.assessment.riskAmount).lte(DecimalValue.fromString("25")));
  });

  it("pins the policy and limit-set hashes", () => {
    const result = evaluateRisk(pass.snapshot);
    assert.equal(result.policyHash, RISK_POLICY_HASH);
    assert.equal(result.policyHash.length, 64);
    assert.equal(RISK_LIMIT_SET_SPECIFICATION_HASH.length, 64);
    assert.equal(result.inputHash, pass.expected.inputHash);
    assert.equal(result.outputHash, pass.expected.outputHash);
  });

  it("produces no order, fill, position or ledger artefact", () => {
    const serialised = canonicalize(evaluateRisk(pass.snapshot));
    for (const forbidden of [
      "shadowOrderId",
      "shadowFillId",
      "shadowPositionId",
      "entryKey",
      "ledgerEntry",
      "exitPlan"
    ]) {
      assert.ok(!serialised.includes(forbidden), `output must not contain ${forbidden}`);
    }
  });

  it("reproduces every critical-cases.json entry", () => {
    const fixtures = readFixture<readonly CriticalFixture[]>("critical-cases.json");
    assert.equal(fixtures.length, CRITICAL_CASES.length);

    for (const fixture of fixtures) {
      const testCase = CRITICAL_CASES.find((entry) => entry.name === fixture.name);
      assert.ok(testCase, `unknown fixture case ${fixture.name}`);

      const result = evaluateRisk(testCase.build());
      assert.equal(result.outcome, fixture.outcome, fixture.name);
      assert.equal(result.outcome, fixture.expectedOutcome, fixture.name);
      assert.equal(result.directive, fixture.directive, fixture.name);
      assert.equal(result.inputHash, fixture.inputHash, fixture.name);
      assert.equal(result.outputHash, fixture.outputHash, fixture.name);
      assert.equal(result.assessment.approvedQuantity, "0.000000000000", fixture.name);

      const failed = result.ruleResults
        .filter((rule) => rule.outcome !== "PASS")
        .map((rule) => `${rule.ruleCode}:${rule.reasonCode}`);
      assert.deepEqual(failed, [...fixture.failedRules], fixture.name);
      assert.ok(
        failed.some((entry) => entry.endsWith(`:${fixture.expectedReasonCode}`)),
        `${fixture.name} expected ${fixture.expectedReasonCode}, got ${failed.join(",")}`
      );
      assert.equal(result.ruleResults.length, 26, fixture.name);
    }
  });
});

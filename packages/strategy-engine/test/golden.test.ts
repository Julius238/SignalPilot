import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalize } from "@signalpilot/trading-domain";

import {
  evaluateStrategy,
  type StrategyEvaluationResultV1,
  type StrategyInputSnapshotV1
} from "../src/index.js";

import { ETH_BASE_SNAPSHOT, REJECTION_CASES } from "./support/rejection-cases.js";

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

const readFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(fixtureDir, name), "utf8")) as T;

interface RejectionFixture {
  readonly name: string;
  readonly expectedOutcome: string;
  readonly expectedReasonCode: string;
  readonly outcome: string;
  readonly primaryReasonCode: string | null;
  readonly reasonCodes: readonly string[];
  readonly inputHash: string;
  readonly outputHash: string;
}

describe("golden fixtures", () => {
  const btc = readFixture<{
    snapshot: StrategyInputSnapshotV1;
    expected: StrategyEvaluationResultV1;
  }>("btc-pass.json");

  it("reproduces btc-pass.json byte for byte", () => {
    const result = evaluateStrategy(btc.snapshot);
    assert.equal(canonicalize(result), canonicalize(btc.expected));
  });

  it("keeps the pinned btc-pass hashes stable", () => {
    const result = evaluateStrategy(btc.snapshot);
    assert.equal(result.outcome, "CANDIDATE");
    assert.equal(result.inputHash, btc.expected.inputHash);
    assert.equal(result.outputHash, btc.expected.outputHash);
    assert.equal(result.inputHash.length, 64);
    assert.equal(result.outputHash.length, 64);
  });

  it("produces no risk, order, fill or position artefact", () => {
    const result = evaluateStrategy(btc.snapshot);
    const serialised = canonicalize(result);
    for (const forbidden of [
      "riskAssessment",
      "shadowOrder",
      "shadowFill",
      "shadowPosition",
      "ledgerEntry",
      "approvedQuantity"
    ]) {
      assert.ok(!serialised.includes(forbidden), `output must not contain ${forbidden}`);
    }
  });

  it("reproduces every eth-rejections.json case", () => {
    const fixtures = readFixture<readonly RejectionFixture[]>("eth-rejections.json");
    assert.equal(fixtures.length, REJECTION_CASES.length);

    for (const fixture of fixtures) {
      const testCase = REJECTION_CASES.find((entry) => entry.name === fixture.name);
      assert.ok(testCase, `unknown fixture case ${fixture.name}`);

      const result = evaluateStrategy(testCase.mutate(ETH_BASE_SNAPSHOT()));
      assert.equal(result.outcome, fixture.outcome, fixture.name);
      assert.deepEqual([...result.reasonCodes], [...fixture.reasonCodes], fixture.name);
      assert.equal(result.inputHash, fixture.inputHash, fixture.name);
      assert.equal(result.outputHash, fixture.outputHash, fixture.name);
      assert.equal(result.candidate, null, fixture.name);
    }
  });
});

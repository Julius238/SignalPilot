/**
 * Regenerates the golden fixtures.
 *
 * Run with: `node_modules/.bin/tsx test/support/generate-fixtures.ts`
 *
 * The generated files pin the exact engine output including both hashes, so any
 * later change in a formula, a parameter or the canonical serialisation shows up
 * as a failing golden test rather than as a silent semantic drift
 * (docs/trading/12-test-and-acceptance-plan.md, "deterministische Golden Hashes").
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateStrategy } from "../../src/index.js";

import { buildPassingSnapshot } from "./build-snapshot.js";
import { ETH_BASE_SNAPSHOT, REJECTION_CASES } from "./rejection-cases.js";

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

const btcSnapshot = buildPassingSnapshot();
const btcResult = evaluateStrategy(btcSnapshot);

writeFileSync(
  resolve(fixtureDir, "btc-pass.json"),
  `${JSON.stringify({ snapshot: btcSnapshot, expected: btcResult }, null, 2)}\n`,
  "utf8"
);

const rejections = REJECTION_CASES.map((testCase) => {
  const result = evaluateStrategy(testCase.mutate(ETH_BASE_SNAPSHOT()));
  return {
    name: testCase.name,
    expectedOutcome: testCase.expectedOutcome,
    expectedReasonCode: testCase.expectedReasonCode,
    outcome: result.outcome,
    primaryReasonCode: result.outcome === "CANDIDATE" ? null : result.primaryReasonCode,
    reasonCodes: result.reasonCodes,
    inputHash: result.inputHash,
    outputHash: result.outputHash
  };
});

writeFileSync(
  resolve(fixtureDir, "eth-rejections.json"),
  `${JSON.stringify(rejections, null, 2)}\n`,
  "utf8"
);

process.stdout.write(
  `btc-pass.json: ${btcResult.outcome} ${btcResult.outputHash}\neth-rejections.json: ${rejections.length} cases\n`
);

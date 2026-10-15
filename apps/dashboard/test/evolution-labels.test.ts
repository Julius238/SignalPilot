import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLineageTrees, candidateStatus, fmtPct, fmtR, fmtUsd } from "../src/lib/evolution-labels";

describe("evolution labels", () => {
  it("never shows a raw enum for known statuses and falls back to the raw value otherwise", () => {
    assert.equal(candidateStatus("PROPOSED").label, "Zur Prüfung vorgeschlagen");
    assert.equal(candidateStatus("REJECTED").tone, "trading-bad");
    assert.equal(candidateStatus("SOMETHING_NEW").label, "SOMETHING_NEW");
  });

  it("formats R, percent and USD in German and shows a dash for unknown values", () => {
    assert.equal(fmtR(0.25), "+0,25 R");
    assert.equal(fmtR(null), "—");
    assert.equal(fmtPct(12.345), "12,35 %");
    assert.equal(fmtUsd(0.1234, 4), "0,1234 USD");
  });

  it("builds one lineage tree per frozen root", () => {
    const trees = buildLineageTrees([
      { key: "EVO-BRK-0002", parentKey: "EVO-BRK-0001", generation: 2, status: "PROPOSED" },
      { key: "EVO-BRK-0001", parentKey: "ROOT:CRYPTO_TREND_CORE_LONG_V1", generation: 1, status: "RESERVE" },
      { key: "EVO-REG-0001", parentKey: "ROOT:CRYPTO_REGIME_LONG_V1", generation: 1, status: "REJECTED" }
    ]);
    assert.deepEqual(trees.map((tree) => tree.key), ["ROOT:CRYPTO_REGIME_LONG_V1", "ROOT:CRYPTO_TREND_CORE_LONG_V1"]);
    const trend = trees[1]!;
    assert.equal(trend.children[0]!.key, "EVO-BRK-0001");
    assert.equal(trend.children[0]!.children[0]!.key, "EVO-BRK-0002");
  });
});

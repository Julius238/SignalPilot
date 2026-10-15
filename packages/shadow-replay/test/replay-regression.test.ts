import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runShadowReplay } from "../src/index.js";
import { REGRESSION_CASES, fullResultHash } from "./support/regression-matrix.js";

/**
 * Recorded with the single-strategy replay as it was before the portfolio
 * book was extracted (commit 0a2023a). A changed value means an existing
 * backtest would produce a different result — never update these to make a
 * refactor pass.
 */
const RECORDED: Readonly<Record<string, { readonly outputHash: string; readonly fullHash: string }>> = {
  "R1-signal-edge-forced": {
    outputHash: "97d98531d26de11ec0f7fa3be561b3bb6cc373154f97d77c61dc09bc08d52fbb",
    fullHash: "8b6f81292c135b7a084b75a2fe383f2fc1f195dd1cb008279fb71e18d1190a7f"
  },
  "R2-spec-forced": {
    outputHash: "6095a9203ef6a3f75d39c68e587466aea0721bc020d3281aab16460d2253f744",
    fullHash: "b3023185a87a25425fdaf60c3ae284d78bb1dd241fdc71bf60cbd154ba3bc55a"
  },
  "R3-spec-kill-switch": {
    outputHash: "5e236f0eabdcbcff5abe93e6c7436b81dc14ab13732b14f0611193d7c4da6cac",
    fullHash: "cb8ba39502ad3e3b36d46c9e02d59e3fbafce972f31a9ca5706501d412523072"
  },
  "R4-spec-regime-exit-shut": {
    outputHash: "6ecc5847d975af0e7e20d8087d9d3ee4c64c7d08e7287710b1d5bba40a69e0fd",
    fullHash: "2e20a132257c4c2f88f04c9ff4b93f849946b08cf20d3f5bc5e7f573e649e1e9"
  },
  "R5-spec-eth-profile": {
    outputHash: "59d545ed58c056111f2a941c3650d51c0ea875be1b174b9a38c126d02f707fe9",
    fullHash: "41adbf63f24f2614194f5c3b63347f37bbd402c6b4b8f0340cc0d83a62f03c8d"
  },
  "R6-spec-regime-long-native": {
    outputHash: "b16f76bb4f23c118ce5df3b52dfb49e91c8b55668e59a760a386469876d3cd64",
    fullHash: "94b5484db88b1a6076e3899e00389808c2e6c96c630f963fd1b6c1503d8c8704"
  },
  "R7-spec-trend-core-native": {
    outputHash: "9046bb100aa680ded8dbb61c6d716d9231e5724ee10337f55d807d272c56f3d3",
    fullHash: "eb95663cb5948f234efa4138c93e7f42cf385a60f1329d5cd6bee66d726cad25"
  },
  "R8-spec-variant-price-only": {
    outputHash: "b741ca86bf4873b60cb065afac2f584f746a868e98cfdb208a920abc1493d91b",
    fullHash: "388c2ac0d29d27f166d58454c0a0e359e3fd9b7512a956f49137153ab0439262"
  },
  "R9-spec-window-and-split": {
    outputHash: "40a1d79ab070ae9109c50c15dad497f61513a8e7646af438ff4a6d75dd76bcfe",
    fullHash: "5707fa48352d6ec53ef995a803c30f8934990ddeed6f2f81e2444dce7f81357a"
  },
  "R10-spec-bootstrap-costs-all-rejected": {
    outputHash: "f38aead81eb8d0534135508600515af20944cc1247164162092d79e244cb33de",
    fullHash: "302452ba8ee032705ad254f5df540798e1173ed9f82c219505d8e07a45b4fe26"
  }
};

describe("shadow replay — recorded single-strategy results stay identical", () => {
  it("covers every recorded case", () => {
    assert.deepEqual(REGRESSION_CASES.map((entry) => entry.key).sort(), Object.keys(RECORDED).sort());
  });

  for (const entry of REGRESSION_CASES) {
    it(`${entry.key}: same output hash and same full result`, () => {
      const result = runShadowReplay(entry.market(), entry.config, entry.hooks);
      assert.equal(result.outputHash, RECORDED[entry.key]!.outputHash);
      assert.equal(fullResultHash(result), RECORDED[entry.key]!.fullHash);
    });
  }
});

/**
 * Runs one part of the portfolio-replay validation on the real snapshots and
 * writes its JSON report. No database, no API key, no candidate.
 *
 *   tsx src/validation/run.ts --part=equivalence --root=ROOT:CRYPTO_REGIME_LONG_V1 --symbol=BTCUSDT --out=<file>
 *   tsx src/validation/run.ts --part=baseline-group --out=<file>
 *   tsx src/validation/run.ts --part=baseline-none --out=<file>
 *   tsx src/validation/run.ts --part=counterprobe-baseline --out=<file>
 *   tsx src/validation/run.ts --part=counterprobe --probe=EVO-REG-0004 --out=<file>
 *   tsx src/validation/run.ts --part=counterprobe-verdicts --baseline=<file> --probes=<file>,<file> --trials=52 --out=<file>
 *
 * The snapshot directory comes from EVOLUTION_SNAPSHOT_DIR (default
 * ./data/market-snapshots/real); candles from the forward period on are
 * dropped by the loader.
 */

import { readFile, writeFile } from "node:fs/promises";

import { EVOLUTION_DATA_SPLIT_V1 } from "@signalpilot/evolution";

import { loadEvolutionMarket } from "../market/snapshots.js";
import { counterprobeRun, counterprobeVerdicts, validateBaseline, validateEquivalence } from "./portfolioValidation.js";

const flags = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match === null) throw new Error(`Unknown argument ${arg}`);
    return [match[1]!, match[2]!] as const;
  })
);
const required = (name: string): string => {
  const value = flags[name];
  if (value === undefined || value === "") throw new Error(`--${name}=<…> is required.`);
  return value;
};

const snapshotDir = process.env.EVOLUTION_SNAPSHOT_DIR?.trim() || "./data/market-snapshots/real";
const codeVersion = process.env.EVOLUTION_CODE_VERSION?.trim() || "validation";
const part = required("part");

if (part === "counterprobe-verdicts") {
  // Reads stored summaries only: no market data, no replay.
  const read = async (file: string) => (JSON.parse(await readFile(file, "utf8")) as { summary: Parameters<typeof counterprobeVerdicts>[0] }).summary;
  const baseline = await read(required("baseline"));
  const probes = await Promise.all(required("probes").split(",").map(read));
  const verdicts = counterprobeVerdicts(baseline, probes, Number(required("trials")));
  await writeFile(required("out"), `${JSON.stringify({ trials: Number(required("trials")), verdicts }, null, 2)}\n`);
  console.log(`${part} written to ${required("out")}`);
  process.exit(0);
}

const loaded = await loadEvolutionMarket(snapshotDir, EVOLUTION_DATA_SPLIT_V1);
const clock = () => Date.now();
if (part === "counterprobe-baseline" || part === "counterprobe") {
  const summary = counterprobeRun(loaded.market, part === "counterprobe" ? required("probe") : null, codeVersion, clock);
  await writeFile(required("out"), `${JSON.stringify({ dataFingerprint: loaded.fingerprint, cutoffAt: loaded.cutoffAt, codeVersion, summary })}\n`);
  console.log(`${part} written to ${required("out")}`);
  process.exit(0);
}
const report =
  part === "equivalence"
    ? validateEquivalence(loaded.market, required("root"), required("symbol"), codeVersion, clock)
    : part === "baseline-group"
      ? validateBaseline(loaded.market, "GROUP_RISK_V1", codeVersion, clock)
      : part === "baseline-none"
        ? validateBaseline(loaded.market, "NONE", codeVersion, clock)
        : null;
if (report === null) throw new Error(`Unknown part ${part}.`);
await writeFile(required("out"), `${JSON.stringify({ dataFingerprint: loaded.fingerprint, cutoffAt: loaded.cutoffAt, codeVersion, report }, null, 2)}\n`);
console.log(`${part} written to ${required("out")}`);

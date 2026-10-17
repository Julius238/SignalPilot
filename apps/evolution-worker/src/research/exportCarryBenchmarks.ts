/**
 * Writes the benchmark file of the funding carry feasibility study (step 1.4):
 * monthly returns and capital binding of champion and challenger from
 * comparison A, 2020-01 – 2026-09. No database, no API key, no candidate;
 * the snapshot loader drops every candle from the forward period on.
 *
 *   tsx src/research/exportCarryBenchmarks.ts --out=<benchmarks.csv> --meta=<benchmarks.meta.json>
 *
 * The snapshot directory comes from EVOLUTION_SNAPSHOT_DIR (default
 * ./data/market-snapshots/real), the code version from EVOLUTION_CODE_VERSION.
 */

import { writeFile } from "node:fs/promises";

import { EVOLUTION_DATA_SPLIT_V1 } from "@signalpilot/evolution";

import { loadEvolutionMarket } from "../market/snapshots.js";
import { carryBenchmarkCsv, carryBenchmarkMeta, carryBenchmarkRows, runCarryBenchmarkComparisons } from "./carryBenchmarks.js";

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

const out = required("out");
const meta = required("meta");
const snapshotDir = process.env.EVOLUTION_SNAPSHOT_DIR?.trim() || "./data/market-snapshots/real";
const codeVersion = process.env.EVOLUTION_CODE_VERSION?.trim() || "carry-benchmarks";

const loaded = await loadEvolutionMarket(snapshotDir, EVOLUTION_DATA_SPLIT_V1);
const runs = runCarryBenchmarkComparisons(loaded.market, codeVersion);
const rows = carryBenchmarkRows(runs);
await writeFile(out, carryBenchmarkCsv(rows));
await writeFile(meta, `${JSON.stringify(carryBenchmarkMeta(runs, { dataFingerprint: loaded.fingerprint, cutoffAt: loaded.cutoffAt, codeVersion }), null, 2)}\n`);
console.log(`${rows.length} months written to ${out} (provenance in ${meta}).`);

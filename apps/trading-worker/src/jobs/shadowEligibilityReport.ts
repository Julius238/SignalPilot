/**
 * Manual command: print the Shadow-Eligibility-Report (P8, "7.
 * Shadow-Eligibility-Report" — "Stelle ihn über API, Dashboard und manuellen
 * Befehl bereit").
 *
 * `pnpm trading-worker:shadow-eligibility [--portfolio=SHADOW_CHALLENGER_V1]`
 *
 * Read-only in the strongest sense available: it has no feature flag of its
 * own because there is nothing to gate — it writes no row at all, not even a
 * `BotRun`, and cannot activate, enable or unlock anything. Exit code 0 means
 * `READY`, 1 means `NOT_READY`, 2 means the report itself failed.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma, type PrismaClient } from "@signalpilot/database";
import { config } from "dotenv";
import pino from "pino";

import {
  EligibilityStatus,
  buildEligibilityReport,
  type EligibilityReport
} from "../lib/shadowEligibility.js";
import { isShadowPortfolioKey, type ShadowPortfolioKey } from "../lib/shadowPortfolios.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

export const JOB_NAME = "shadowEligibilityReport";

export async function runShadowEligibilityReport(
  database: PrismaClient = prisma,
  options: {
    readonly asOf?: Date;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly portfolioKey?: ShadowPortfolioKey;
  } = {}
): Promise<EligibilityReport> {
  return buildEligibilityReport(database, {
    asOf: options.asOf ?? new Date(),
    env: options.env ?? process.env,
    ...(options.portfolioKey === undefined ? {} : { portfolioKey: options.portfolioKey })
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const portfolioArg = process.argv.find((arg) => arg.startsWith("--portfolio="))?.slice("--portfolio=".length);
  if (portfolioArg !== undefined && !isShadowPortfolioKey(portfolioArg)) {
    logger.error({ portfolioArg }, `${JOB_NAME}: unknown shadow portfolio`);
    process.exit(2);
  }
  runShadowEligibilityReport(prisma, portfolioArg === undefined ? {} : { portfolioKey: portfolioArg })
    .then((report) => {
      logger.info(
        { status: report.status, blockingFailures: report.blockingFailures, warnings: report.warnings },
        `Shadow-Eligibility-Report: ${report.status}`
      );
      for (const check of report.checks) {
        const line = `${check.outcome.padEnd(4)} ${check.code}: ${check.reason}`;
        if (check.outcome === "FAIL") logger.error(line);
        else if (check.outcome === "WARN") logger.warn(line);
        else logger.info(line);
      }
      process.exitCode =
        report.status === EligibilityStatus.READY ? 0 : report.status === EligibilityStatus.NOT_READY ? 1 : 2;
    })
    .catch((error) => {
      logger.error({ error }, `${JOB_NAME} failed`);
      process.exitCode = 2;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

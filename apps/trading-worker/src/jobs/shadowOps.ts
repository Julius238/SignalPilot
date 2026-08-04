/**
 * Manual, explicit operations CLI for portfolio and session lifecycle.
 *
 * Specification: docs/trading/04-state-machines.md, "Aktivierungs-Guards";
 * docs/trading/decisions/0006-fail-closed-session-and-kill-switch.md.
 *
 * There is no "activate everything" shortcut and no single environment flag
 * that performs any of this. Every subcommand requires explicit named
 * arguments (an actor, an idempotency key where the domain guard demands
 * one) and every guard the domain package would enforce on an API/UI command
 * runs here too — see `../lib/shadowSessionOps.ts`.
 *
 * Usage:
 *   tsx src/jobs/shadowOps.ts activate-portfolio --portfolio-id=<id> --actor=<name>
 *   tsx src/jobs/shadowOps.ts enable-btc-assignment --assignment-id=<id> --actor=<name>
 *   tsx src/jobs/shadowOps.ts disable-btc-assignment --assignment-id=<id> --actor=<name>
 *   tsx src/jobs/shadowOps.ts release-kill-switch --session-id=<id> --actor=<name>
 *   tsx src/jobs/shadowOps.ts activate-session --session-id=<id> --actor=<name> --idempotency-key=<key>
 *   tsx src/jobs/shadowOps.ts pause-session --session-id=<id> --actor=<name>
 *   tsx src/jobs/shadowOps.ts engage-kill-switch --session-id=<id> --actor=<name> --reason=<code>
 *   tsx src/jobs/shadowOps.ts unlock-session --session-id=<id> --actor=<name> --idempotency-key=<key> --confirm-cause-resolved
 *   tsx src/jobs/shadowOps.ts manual-risk-close --position-id=<id> --actor=<name> --reason-note=<text> --idempotency-key=<key>
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma, type PrismaClient } from "@signalpilot/database";
import {
  TradingBuildCapability,
  TradingMode
} from "@signalpilot/trading-domain";
import { config } from "dotenv";
import pino from "pino";

import { requestManualRiskClose } from "../lib/manualRiskClose.js";
import {
  activatePortfolio,
  activateSession,
  engageKillSwitch,
  pauseSession,
  releaseKillSwitch,
  setStrategyAssignmentEnabled,
  unlockSessionToStopped,
  type OpsResult
} from "../lib/shadowSessionOps.js";
import { checkShadowBaseAllowed } from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

function parseArgs(argv: readonly string[]): Readonly<Record<string, string>> {
  const args: Record<string, string> = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, ...rest] = token.slice(2).split("=");
    args[key] = rest.length > 0 ? rest.join("=") : "true";
  }
  return args;
}

function requireArg(
  args: Readonly<Record<string, string>>,
  name: string
): string {
  const value = args[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required --${name}.`);
  }
  return value;
}

function requireIntegerArg(
  args: Readonly<Record<string, string>>,
  name: string
): number {
  const raw = requireArg(args, name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`--${name} must be a non-negative integer.`);
  return value;
}

async function run(
  database: PrismaClient,
  argv: readonly string[]
): Promise<OpsResult<unknown>> {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  const asOf = new Date();

  switch (command) {
    case "activate-portfolio":
      return activatePortfolio(database, {
        portfolioId: requireArg(args, "portfolio-id"),
        actorId: requireArg(args, "actor"),
        idempotencyKey: requireArg(args, "idempotency-key"),
        asOf
      });

    case "enable-assignment":
    case "enable-btc-assignment":
      return setStrategyAssignmentEnabled(database, {
        assignmentId: requireArg(args, "assignment-id"),
        actorId: requireArg(args, "actor"),
        enabled: true,
        idempotencyKey: requireArg(args, "idempotency-key"),
        expectedVersion: requireIntegerArg(args, "expected-version"),
        confirmation: requireArg(args, "confirmation"),
        asOf
      });

    case "disable-assignment":
    case "disable-btc-assignment":
      return setStrategyAssignmentEnabled(database, {
        assignmentId: requireArg(args, "assignment-id"),
        actorId: requireArg(args, "actor"),
        enabled: false,
        idempotencyKey: requireArg(args, "idempotency-key"),
        expectedVersion: requireIntegerArg(args, "expected-version"),
        confirmation: requireArg(args, "confirmation"),
        asOf
      });

    case "release-kill-switch":
      return releaseKillSwitch(database, {
        sessionId: requireArg(args, "session-id"),
        actorId: requireArg(args, "actor"),
        idempotencyKey: requireArg(args, "idempotency-key"),
        asOf
      });

    case "activate-session": {
      const env = process.env;
      const base = checkShadowBaseAllowed(env);
      if (!base.allowed) {
        return {
          ok: false,
          reasonCode: base.reasonCode,
          message: base.message
        };
      }
      return activateSession(database, {
        sessionId: requireArg(args, "session-id"),
        actorId: requireArg(args, "actor"),
        idempotencyKey: requireArg(args, "idempotency-key"),
        capability: {
          buildCapability: TradingBuildCapability.SHADOW_ONLY,
          tradingMode: base.flags
            .tradingMode as (typeof TradingMode)[keyof typeof TradingMode],
          enableLiveTrading: base.flags.enableLiveTrading,
          shadowMasterFlagEnabled: base.flags.shadowEnabled
        },
        asOf
      });
    }

    case "pause-session":
      return pauseSession(database, {
        sessionId: requireArg(args, "session-id"),
        actorId: requireArg(args, "actor"),
        idempotencyKey: requireArg(args, "idempotency-key"),
        asOf
      });

    case "engage-kill-switch":
      return engageKillSwitch(database, {
        sessionId: requireArg(args, "session-id"),
        actorId: requireArg(args, "actor"),
        reasonCode: requireArg(args, "reason"),
        idempotencyKey: requireArg(args, "idempotency-key"),
        asOf
      });

    case "unlock-session":
      return unlockSessionToStopped(database, {
        sessionId: requireArg(args, "session-id"),
        actorId: requireArg(args, "actor"),
        idempotencyKey: requireArg(args, "idempotency-key"),
        confirmCauseResolved: args["confirm-cause-resolved"] === "true",
        asOf
      });

    case "manual-risk-close": {
      const result = await requestManualRiskClose(database, {
        shadowPositionId: requireArg(args, "position-id"),
        actorId: requireArg(args, "actor"),
        reasonNote: requireArg(args, "reason-note"),
        idempotencyKey: requireArg(args, "idempotency-key"),
        asOf
      });
      if (!result.ok) return result;
      return { ok: true, result };
    }

    default:
      throw new Error(
        `Unknown command ${JSON.stringify(command)}. Expected one of: activate-portfolio, enable-assignment, disable-assignment, release-kill-switch, activate-session, pause-session, engage-kill-switch, unlock-session, manual-risk-close.`
      );
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  run(prisma, process.argv.slice(2))
    .then((result) => {
      if (!result.ok) {
        logger.error(
          { reasonCode: result.reasonCode, message: result.message },
          "shadowOps command refused"
        );
        process.exitCode = 1;
        return;
      }
      logger.info(result.result, "shadowOps command succeeded");
    })
    .catch((error) => {
      logger.error({ error }, "shadowOps command failed");
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { run as runShadowOps };

/**
 * Operator commands of the SignalPilot Arena (docs/trading/17-arena.md).
 * Every command writes arena tables only; none changes a portfolio, ledger,
 * session, assignment, strategy version or risk limit.
 *
 *   arenaOps.js bootstrap-v1 --actor=<name>
 *   arenaOps.js register-cohort --key=<key> --name=<name> --actor=<name>
 *   arenaOps.js register --cohort=<key> --portfolio=<key> --status=CANDIDATE|ACTIVE|CHAMPION --actor=<name>
 *                        [--strategy-version-id=<id>] [--parent=<participant>]
 *   arenaOps.js evaluate [--cohort=<key>]
 *   arenaOps.js transition --participant=<id|key> --to=<status> --reason=<reason> --actor=<name>
 *                          --idempotency-key=<key> [--note=<text>]
 *   arenaOps.js open-post-mortem --participant=<id|key> --actor=<name>
 *   arenaOps.js export-dossier --participant=<id|key> [--out=<file>]
 *   arenaOps.js record-hypothesis --case=<id> --author=<name> --text=<hypothesis>
 *                                 [--proposed-strategy-key=<key>] [--proposed-specification-hash=<hash>]
 *   arenaOps.js verify-chain --participant=<id|key>
 *   arenaOps.js set-policy --cohort=<key> --file=<policy.json> --actor=<name> --reason=<text>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma, type PrismaClient } from "@signalpilot/database";
import { ArenaParticipantStatus, ArenaTransitionReason } from "@signalpilot/arena";
import { config } from "dotenv";
import pino from "pino";

import {
  ARENA_V1_COHORT_KEY,
  buildArenaPostMortemDossier,
  evaluateArenaCohort,
  openArenaPostMortem,
  recordArenaPostMortemHypothesis,
  registerArenaCohort,
  registerArenaParticipant,
  setArenaCohortPolicy,
  transitionArenaParticipant,
  verifyArenaEvaluationChain,
  type ArenaOpsResult
} from "../lib/arena.js";
import { SHADOW_CHALLENGER_PORTFOLIO_KEY, SHADOW_PORTFOLIO_KEY } from "../lib/shadowPortfolios.js";
import { checkArenaJobAllowed } from "../lib/tradingSafety.js";

const logger = pino({ name: "signalpilot-worker" });
const jobDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(jobDir, "../../../../.env") });
config();

type Args = Readonly<Record<string, string>>;

function parseArgs(argv: readonly string[]): Args {
  const args: Record<string, string> = {};
  for (const token of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(token);
    if (match) args[match[1]!] = match[2] ?? "true";
  }
  return args;
}

function requireArg(args: Args, name: string): string {
  const value = args[name];
  if (value === undefined || value.trim() === "") throw new Error(`--${name} is required.`);
  return value;
}

function oneOf<T extends string>(value: string, allowed: Readonly<Record<string, T>>, name: string): T {
  if (!(Object.values(allowed) as string[]).includes(value)) {
    throw new Error(`--${name} must be one of ${Object.values(allowed).join(", ")}.`);
  }
  return value as T;
}

async function resolveParticipantId(database: PrismaClient, reference: string): Promise<string> {
  const participant = await database.arenaParticipant.findFirst({
    where: { OR: [{ id: reference }, { participantKey: reference }] },
    select: { id: true }
  });
  if (participant === null) throw new Error(`No arena participant ${reference}.`);
  return participant.id;
}

/**
 * The first cohort: the two running forward tests, registered as they are —
 * same forward start, portfolio, capital, ledger and session. No reset.
 */
async function bootstrapV1(database: PrismaClient, actorId: string, asOf: Date): Promise<ArenaOpsResult<unknown>> {
  const cohort = await registerArenaCohort(database, {
    key: ARENA_V1_COHORT_KEY,
    name: "SignalPilot Arena V1",
    description: "Champion CRYPTO_TREND_CORE_LONG_V1 against challenger CRYPTO_REGIME_LONG_V1 on BTCUSDT, shadow only.",
    actorId
  });
  if (!cohort.ok) return cohort;
  const champion = await registerArenaParticipant(database, {
    cohortKey: ARENA_V1_COHORT_KEY,
    portfolioKey: SHADOW_PORTFOLIO_KEY,
    status: "CHAMPION",
    actorId,
    asOf
  });
  if (!champion.ok) return champion;
  const challenger = await registerArenaParticipant(database, {
    cohortKey: ARENA_V1_COHORT_KEY,
    portfolioKey: SHADOW_CHALLENGER_PORTFOLIO_KEY,
    status: "ACTIVE",
    actorId,
    asOf
  });
  if (!challenger.ok) return challenger;
  return { ok: true, result: { cohort: cohort.result, champion: champion.result, challenger: challenger.result } };
}

export async function runArenaOpsCommand(
  database: PrismaClient,
  command: string,
  args: Args,
  asOf: Date = new Date()
): Promise<ArenaOpsResult<unknown>> {
  switch (command) {
    case "bootstrap-v1":
      return bootstrapV1(database, requireArg(args, "actor"), asOf);
    case "register-cohort":
      return registerArenaCohort(database, {
        key: requireArg(args, "key"),
        name: requireArg(args, "name"),
        actorId: requireArg(args, "actor")
      });
    case "register": {
      const status = requireArg(args, "status");
      if (status !== "CANDIDATE" && status !== "ACTIVE" && status !== "CHAMPION") {
        throw new Error("--status must be CANDIDATE, ACTIVE or CHAMPION.");
      }
      return registerArenaParticipant(database, {
        cohortKey: requireArg(args, "cohort"),
        portfolioKey: requireArg(args, "portfolio"),
        status,
        actorId: requireArg(args, "actor"),
        asOf,
        ...(args["strategy-version-id"] === undefined ? {} : { strategyVersionId: args["strategy-version-id"] }),
        ...(args.parent === undefined ? {} : { parentParticipantId: await resolveParticipantId(database, args.parent) })
      });
    }
    case "evaluate":
      return evaluateArenaCohort(database, {
        cohortKey: args.cohort ?? ARENA_V1_COHORT_KEY,
        asOf,
        codeVersion: (process.env.TRADING_CODE_VERSION ?? "").trim() || "unversioned-local-build"
      });
    case "transition":
      return transitionArenaParticipant(database, {
        participantId: await resolveParticipantId(database, requireArg(args, "participant")),
        to: oneOf(requireArg(args, "to"), ArenaParticipantStatus, "to"),
        reason: oneOf(requireArg(args, "reason"), ArenaTransitionReason, "reason"),
        actorId: requireArg(args, "actor"),
        idempotencyKey: requireArg(args, "idempotency-key"),
        ...(args.note === undefined ? {} : { note: args.note }),
        asOf
      });
    case "open-post-mortem": {
      const participantId = await resolveParticipantId(database, requireArg(args, "participant"));
      const participant = await database.arenaParticipant.findUniqueOrThrow({ where: { id: participantId } });
      return openArenaPostMortem(database, {
        participantId,
        triggerStatus: participant.status,
        triggerEvaluationId: null,
        actorId: requireArg(args, "actor"),
        asOf
      });
    }
    case "export-dossier": {
      const dossier = await buildArenaPostMortemDossier(
        database,
        await resolveParticipantId(database, requireArg(args, "participant")),
        asOf
      );
      if (dossier === null) return { ok: false, reasonCode: "ARENA_PARTICIPANT_NOT_FOUND", message: "Participant vanished." };
      const json = `${JSON.stringify(dossier, null, 2)}\n`;
      if (args.out !== undefined) writeFileSync(args.out, json);
      else process.stdout.write(json);
      return { ok: true, result: { written: args.out ?? "stdout" } };
    }
    case "record-hypothesis":
      return recordArenaPostMortemHypothesis(database, {
        postMortemId: requireArg(args, "case"),
        author: requireArg(args, "author"),
        hypothesis: requireArg(args, "text"),
        ...(args["proposed-strategy-key"] === undefined ? {} : { proposedStrategyKey: args["proposed-strategy-key"] }),
        ...(args["proposed-specification-hash"] === undefined
          ? {}
          : { proposedSpecificationHash: args["proposed-specification-hash"] }),
        asOf
      });
    case "verify-chain": {
      const result = await verifyArenaEvaluationChain(
        database,
        await resolveParticipantId(database, requireArg(args, "participant"))
      );
      return result.ok
        ? { ok: true, result }
        : { ok: false, reasonCode: "ARENA_EVALUATION_CHAIN_BROKEN", message: `Chain broken at ${result.brokenAt}.` };
    }
    case "set-policy":
      return setArenaCohortPolicy(database, {
        cohortKey: requireArg(args, "cohort"),
        policy: JSON.parse(readFileSync(requireArg(args, "file"), "utf8")),
        actorId: requireArg(args, "actor"),
        reason: requireArg(args, "reason"),
        asOf
      });
    default:
      throw new Error(
        `Unknown arena command ${JSON.stringify(command)}. Expected bootstrap-v1, register-cohort, register, evaluate, transition, open-post-mortem, export-dossier, record-hypothesis, verify-chain or set-policy.`
      );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [command = "", ...rest] = process.argv.slice(2);
  const gate = checkArenaJobAllowed(process.env);
  if (!gate.allowed) {
    logger.error({ reasonCode: gate.reasonCode }, gate.message);
    process.exit(1);
  }
  runArenaOpsCommand(prisma, command, parseArgs(rest))
    .then((result) => {
      if (!result.ok) {
        logger.error(result, "arena command refused");
        process.exitCode = 1;
        return;
      }
      if (command !== "export-dossier") logger.info(result.result as object, "arena command succeeded");
    })
    .catch((error) => {
      logger.error({ error: error instanceof Error ? error.message : error }, "arena command failed");
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

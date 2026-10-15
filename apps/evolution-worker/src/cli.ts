/**
 * Operator commands of the Evolution Engine.
 *
 *   evolution status
 *   evolution ai-smoke [--tier=STANDARD|ADVANCED]   tiny budget-guarded connection test
 *   evolution run-cycle [--force]           one research cycle now
 *   evolution pause   --actor=<name> [--reason=…]
 *   evolution resume  --actor=<name>
 *   evolution approve --candidate=EVO-BRK-0003 --actor=<name> [--note=…]
 *   evolution reject  --candidate=EVO-BRK-0003 --actor=<name> [--note=…]
 *   evolution report  --candidate=EVO-BRK-0003 | --run=EVO-RUN-…
 *   evolution budget
 *   evolution verify-audit
 *
 * Approval records the operator's decision only. It does not register a
 * strategy, create a portfolio, start a session or touch the arena; those
 * remain deliberate, separately deployed steps (docs/trading/20-evolution-engine.md).
 */

import "dotenv/config";

import { checkOperatorDecision, OPERATOR_DECISIONS, type AiTier, type CandidateStatus } from "@signalpilot/evolution";

import { budgetStatus } from "./ai/budgetedAi.js";
import { runAiSmoke } from "./ai/smoke.js";
import { EvolutionConfigError, describeConfig, loadEvolutionConfig } from "./config.js";
import { runResearchCycle } from "./cycle/researchCycle.js";
import { createEvolutionDatabase, type EvolutionDb } from "./database.js";
import { logger } from "./logger.js";
import { AGENT_KEY, ensureAgentState, setAgentStatus } from "./persistence/agentState.js";
import { recordAuditEvent, verifyEvolutionAuditChain } from "./persistence/audit.js";
import { createBacktestPool, createProvider, loadMarketInfo } from "./runtime.js";

function parseArgs(argv: readonly string[]): { command: string; flags: Record<string, string | true> } {
  const [command = "status", ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (const arg of rest) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match === null) throw new Error(`Unknown argument ${arg}`);
    flags[match[1]!] = match[2] ?? true;
  }
  return { command, flags };
}

const requireFlag = (flags: Record<string, string | true>, name: string): string => {
  const value = flags[name];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`--${name}=<…> is required.`);
  return value.trim();
};

export async function decideCandidate(db: EvolutionDb, input: { candidateKey: string; decision: "APPROVE" | "REJECT"; actor: string; note: string | null; now: Date }) {
  const candidate = await db.evolutionCandidate.findUnique({ where: { candidateKey: input.candidateKey } });
  if (candidate === null) throw new Error(`Unknown candidate ${input.candidateKey}.`);
  const target = OPERATOR_DECISIONS[input.decision];
  const check = checkOperatorDecision(candidate.status as CandidateStatus, target);
  if (!check.ok) throw new Error(check.reason);
  const updated = await db.evolutionCandidate.updateMany({
    where: { id: candidate.id, version: candidate.version, status: "PROPOSED" },
    data: { status: target, decidedAt: input.now, decidedBy: input.actor, decisionNote: input.note, version: { increment: 1 } }
  });
  if (updated.count !== 1) throw new Error("Candidate changed concurrently; decision not recorded.");
  await recordAuditEvent(db, {
    eventKey: `candidate:${candidate.candidateKey}:${target}`,
    eventType: input.decision === "APPROVE" ? "CANDIDATE_APPROVED_FOR_FORWARD_TEST" : "CANDIDATE_REJECTED_BY_OPERATOR",
    aggregateType: "EvolutionCandidate",
    aggregateId: candidate.id,
    actorType: "OPERATOR",
    actorId: input.actor,
    payload: { key: candidate.candidateKey, decision: target, note: input.note, genomeHash: candidate.genomeHash },
    occurredAt: input.now
  });
  return target;
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const config = loadEvolutionConfig();
  if (config.databaseUrl === null) throw new EvolutionConfigError("EVOLUTION_DATABASE_URL (or DATABASE_URL) is required.");
  const db = createEvolutionDatabase(config.databaseUrl);
  const now = () => new Date();
  try {
    switch (command) {
      case "status": {
        const state = await ensureAgentState(db);
        const budget = await budgetStatus(db, config, now());
        const lastRun = await db.evolutionRun.findFirst({ orderBy: { startedAt: "desc" } });
        const counts = await db.evolutionCandidate.groupBy({ by: ["status"], _count: true });
        console.log(JSON.stringify({ agent: { status: state.status, reason: state.statusReason, lastRunAt: state.lastRunAt, nextRunAt: state.nextRunAt }, budget, lastRun: lastRun && { runKey: lastRun.runKey, status: lastRun.status, startedAt: lastRun.startedAt }, candidates: counts, config: describeConfig(config) }, null, 2));
        return;
      }
      case "ai-smoke": {
        const tier: AiTier[] = flags.tier === "STANDARD" || flags.tier === "ADVANCED" ? [flags.tier] : ["STANDARD", "ADVANCED"];
        const results = await runAiSmoke({ db, provider: createProvider(config), config, now, log: logger }, tier);
        console.log(JSON.stringify({ provider: config.provider, results, budget: await budgetStatus(db, config, now()) }, null, 2));
        if (results.some((entry) => !entry.ok)) process.exitCode = 1;
        return;
      }
      case "run-cycle": {
        const provider = createProvider(config);
        const runner = createBacktestPool(config);
        try {
          const market = await loadMarketInfo(config);
          const outcome = await runResearchCycle({ db, config, provider, runner, market, log: logger, now }, { trigger: "MANUAL", force: flags.force === true });
          console.log(JSON.stringify(outcome, null, 2));
        } finally {
          await runner.close();
        }
        return;
      }
      case "pause":
      case "resume": {
        const actor = requireFlag(flags, "actor");
        const state = await setAgentStatus(db, {
          status: command === "pause" ? "PAUSED" : "ACTIVE",
          reason: typeof flags.reason === "string" ? flags.reason : command === "pause" ? "Vom Betreiber pausiert." : "Vom Betreiber aktiviert.",
          actor,
          actorType: "OPERATOR",
          now: now()
        });
        console.log(JSON.stringify({ agent: AGENT_KEY, status: state.status }, null, 2));
        return;
      }
      case "approve":
      case "reject": {
        const target = await decideCandidate(db, {
          candidateKey: requireFlag(flags, "candidate"),
          decision: command === "approve" ? "APPROVE" : "REJECT",
          actor: requireFlag(flags, "actor"),
          note: typeof flags.note === "string" ? flags.note : null,
          now: now()
        });
        console.log(JSON.stringify({ candidate: flags.candidate, status: target }, null, 2));
        return;
      }
      case "report": {
        if (typeof flags.candidate === "string") {
          const candidate = await db.evolutionCandidate.findUnique({ where: { candidateKey: flags.candidate } });
          console.log(candidate?.reportMarkdown ?? `Unknown candidate ${flags.candidate}.`);
        } else {
          const run = await db.evolutionRun.findUnique({ where: { runKey: requireFlag(flags, "run") } });
          console.log(run?.reportMarkdown ?? "Unknown run.");
        }
        return;
      }
      case "budget": {
        console.log(JSON.stringify(await budgetStatus(db, config, now()), null, 2));
        return;
      }
      case "verify-audit": {
        const result = await verifyEvolutionAuditChain(db);
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) process.exitCode = 1;
        return;
      }
      default:
        throw new Error(`Unknown command ${command}.`);
    }
  } finally {
    await db.$disconnect();
  }
}

const invokedDirectly = process.argv[1] !== undefined && /cli\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((error: unknown) => {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "evolution command failed");
    process.exitCode = 1;
  });
}

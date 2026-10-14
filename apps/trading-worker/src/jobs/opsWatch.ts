/**
 * External 24/7 watch (host cron, docs/trading/18-vps-24-7-shadow-runbook.md).
 *
 * The trading worker alerts on almost everything itself (outbox → n8n). What
 * it cannot report is its own absence: a dead worker, an unreachable database
 * or a stopped container. This command runs in a one-off container (never the
 * scheduler), reads the same health model and sends a direct n8n alert only
 * when the in-process alert path is down — so a healthy system never alerts
 * twice for the same thing.
 *
 *   node dist/jobs/opsWatch.js [--alert] [--state-file=<path>] [--container-problem=<text> …]
 *
 * Exit code 0 healthy, 1 problems found. Writes nothing to the database.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BotRunStatus, prisma, type PrismaClient } from "@signalpilot/database";
import { buildMarketEventAlertPayload } from "@signalpilot/alerts";
import { config } from "dotenv";

import { collectOpsHealth, type OpsHealthReport } from "../lib/opsHealth.js";

const jobDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(jobDir, "../../../../.env") });
config();

/** The in-process alert path ticks every two minutes. */
const ALERT_PATH_MAX_AGE_MS = 10 * 60_000;
/** The same unresolved problem is re-sent at most this often. */
const RESEND_AFTER_MS = 6 * 3_600_000;

export interface OpsWatchResult {
  readonly ok: boolean;
  /** Set only when the in-process alert path cannot report them itself. */
  readonly alertWorthy: readonly string[];
  readonly problems: readonly string[];
  readonly health: OpsHealthReport | null;
}

export async function runOpsWatch(
  database: PrismaClient,
  input: { readonly asOf: Date; readonly containerProblems: readonly string[] }
): Promise<OpsWatchResult> {
  const problems = [...input.containerProblems];
  let health: OpsHealthReport | null = null;
  let alertPathAlive = false;
  try {
    health = await collectOpsHealth(database, input.asOf);
    const outbox = await database.botRun.findFirst({
      where: { jobName: "trading:alert-outbox", status: BotRunStatus.SUCCESS },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true }
    });
    alertPathAlive = outbox !== null && input.asOf.getTime() - outbox.startedAt.getTime() <= ALERT_PATH_MAX_AGE_MS;
    if (!alertPathAlive) problems.push("ALERT_PATH_DOWN: trading worker sends no alerts (alert outbox stale)");
    for (const entry of health.marketData) {
      if (!entry.ok) problems.push(`MARKET_DATA_${entry.problem}: ${entry.symbol} last ${entry.latestCloseTime ?? "never"}`);
    }
    for (const job of health.jobs) {
      if (!job.ok) problems.push(`JOB_STALE: ${job.label} last success ${job.lastSuccessAt ?? "never"}`);
    }
    for (const session of health.sessions) {
      if (session.unacknowledgedCriticalRiskEvents > 0) {
        problems.push(`CRITICAL_RISK_EVENTS: ${session.portfolioKey} ${session.unacknowledgedCriticalRiskEvents}`);
      }
      if (session.killSwitchEngaged === true && session.killReasonCode !== null) {
        problems.push(`KILL_SWITCH: ${session.portfolioKey} ${session.killReasonCode}`);
      }
    }
  } catch (error) {
    problems.push(`DATABASE_UNREACHABLE: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  // A living worker already alerts on data, jobs, kill switches and risk
  // events; only container problems and a dead alert path are ours to send.
  const alertWorthy = alertPathAlive ? [...input.containerProblems] : problems;
  return { ok: problems.length === 0, alertWorthy, problems, health };
}

async function sendDirectAlert(problems: readonly string[], asOf: Date): Promise<string> {
  const webhookUrl = process.env.N8N_WEBHOOK_SIGNAL_URL;
  if (webhookUrl === undefined || webhookUrl.trim() === "") return "NO_WEBHOOK_CONFIGURED";
  const payload = buildMarketEventAlertPayload({
    id: `ops-watch-${asOf.toISOString()}`,
    alertType: "urgent_event",
    severity: "CRITICAL",
    title: "SignalPilot 24/7: Betriebsproblem",
    summary: problems.slice(0, 8).join(" · ").slice(0, 600),
    reasoning: `Externer Watch auf ${hostname()}: der Trading-Worker kann diese Probleme nicht selbst melden.`,
    sourceName: "SignalPilot Ops Watch",
    detectedAt: asOf
  });
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000)
  });
  return response.ok ? "SENT" : `HTTP_${response.status}`;
}

function shouldSend(stateFile: string | undefined, signature: string, asOf: Date): boolean {
  if (stateFile === undefined) return true;
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8")) as { signature?: string; sentAt?: string };
    if (state.signature === signature && state.sentAt !== undefined) {
      return asOf.getTime() - new Date(state.sentAt).getTime() >= RESEND_AFTER_MS;
    }
  } catch {
    // No state yet.
  }
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const containerProblems = args
    .filter((arg) => arg.startsWith("--container-problem="))
    .map((arg) => arg.slice("--container-problem=".length))
    .filter((problem) => problem.trim() !== "");
  const stateFile = args.find((arg) => arg.startsWith("--state-file="))?.slice("--state-file=".length);
  const asOf = new Date();
  runOpsWatch(prisma, { asOf, containerProblems })
    .then(async (result) => {
      let delivery: string | null = null;
      if (args.includes("--alert") && result.alertWorthy.length > 0) {
        const signature = [...result.alertWorthy].map((problem) => problem.split(":")[0]).sort().join("|");
        if (shouldSend(stateFile, signature, asOf)) {
          delivery = await sendDirectAlert(result.alertWorthy, asOf);
          if (stateFile !== undefined && delivery === "SENT") {
            writeFileSync(stateFile, JSON.stringify({ signature, sentAt: asOf.toISOString() }));
          }
        } else {
          delivery = "THROTTLED";
        }
      }
      process.stdout.write(`${JSON.stringify({ ...result, delivery }, null, 2)}\n`);
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((error) => {
      process.stderr.write(`ops watch failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect().catch(() => undefined);
    });
}

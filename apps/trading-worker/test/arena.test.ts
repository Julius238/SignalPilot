/**
 * SignalPilot Arena against real PostgreSQL (the test database): registration
 * without reset, evaluation with hard stops and a tamper-evident chain,
 * guarded transitions, post-mortem dossier and lineage.
 *
 * Every row is created under a run-unique prefix and removed afterwards.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@signalpilot/database";

import {
  ARENA_DOSSIER_VERSION,
  buildArenaPostMortemDossier,
  evaluateArenaCohort,
  recordArenaPostMortemHypothesis,
  registerArenaCohort,
  registerArenaParticipant,
  transitionArenaParticipant,
  verifyArenaEvaluationChain
} from "../src/lib/arena.js";

const RUN = randomUUID().slice(0, 8);
const COHORT = `TEST_ARENA_${RUN}`;
const FORWARD_START = new Date("2026-09-01T00:00:00.000Z");
const ASOF = new Date("2026-09-03T00:20:00.000Z");
const created = { portfolios: [] as string[], strategies: [] as string[], assets: [] as string[] };

async function seedPortfolio(label: string, options: { versions?: number } = {}) {
  const key = `TEST_${label}_${RUN}`;
  const asset =
    created.assets.length > 0
      ? { id: created.assets[0]! }
      : await prisma.asset.create({
          data: { symbol: `ARENA${RUN}`, name: "Arena test asset", assetType: "CRYPTO", exchange: "TEST" }
        });
  if (created.assets.length === 0) created.assets.push(asset.id);
  const portfolio = await prisma.portfolio.create({
    data: {
      key,
      name: key,
      status: "ACTIVE",
      startingCash: "10000",
      availableCash: "10000",
      equity: "10000",
      highWaterMark: "10000",
      ledgerSequence: 1,
      lastReconciledAt: ASOF
    }
  });
  created.portfolios.push(portfolio.id);
  await prisma.portfolioLedgerEntry.create({
    data: {
      entryKey: `${key}:initial`,
      portfolioId: portfolio.id,
      sequence: 1,
      type: "INITIAL_CASH",
      availableCashDelta: "10000",
      balanceAfterJson: { availableCash: "10000" },
      occurredAt: FORWARD_START
    }
  });
  const session = await prisma.tradingSession.create({
    data: {
      sessionKey: `${key}:session`,
      portfolioId: portfolio.id,
      status: "SHADOW_ACTIVE",
      killSwitchEngaged: false,
      startedAt: FORWARD_START,
      activePortfolioKey: `${key}:active`
    }
  });
  const strategy = await prisma.strategy.create({
    data: { key: `${key}_STRATEGY`, name: key, description: "arena test", status: "ACTIVE" }
  });
  created.strategies.push(strategy.id);
  const versions = [];
  for (let index = 1; index <= (options.versions ?? 1); index += 1) {
    const version = await prisma.strategyVersion.create({
      data: {
        strategyId: strategy.id,
        version: index,
        status: "ACTIVE",
        engineVersion: "test/1.0.0",
        codeVersion: "test",
        parametersJson: { index },
        specificationHash: `hash-${key}-${index}`,
        createdBy: "test"
      }
    });
    await prisma.strategyAssignment.create({
      data: {
        strategyId: strategy.id,
        strategyVersionId: version.id,
        portfolioId: portfolio.id,
        assetId: asset.id,
        timeframe: "1h",
        enabled: true,
        assignmentConfigJson: { direction: "LONG" },
        createdBy: "test"
      }
    });
    versions.push(version);
  }
  return { portfolio, session, strategy, versions, key };
}

let champion: Awaited<ReturnType<typeof seedPortfolio>>;
let challenger: Awaited<ReturnType<typeof seedPortfolio>>;

before(async () => {
  champion = await seedPortfolio("CHAMP");
  challenger = await seedPortfolio("CHALL");
  const cohort = await registerArenaCohort(prisma, { key: COHORT, name: "test cohort", actorId: "test" });
  assert.equal(cohort.ok, true);
});

after(async () => {
  const participants = await prisma.arenaParticipant.findMany({ where: { cohort: { key: COHORT } }, select: { id: true } });
  const ids = participants.map((participant) => participant.id);
  await prisma.arenaPostMortem.deleteMany({ where: { participantId: { in: ids } } });
  await prisma.arenaEvaluation.deleteMany({ where: { participantId: { in: ids } } });
  await prisma.arenaParticipantEvent.deleteMany({ where: { participantId: { in: ids } } });
  await prisma.arenaParticipant.updateMany({ where: { id: { in: ids } }, data: { parentParticipantId: null } });
  await prisma.arenaParticipant.deleteMany({ where: { id: { in: ids } } });
  await prisma.arenaCohort.deleteMany({ where: { key: COHORT } });
  await prisma.portfolioLedgerEntry.deleteMany({ where: { portfolioId: { in: created.portfolios } } });
  await prisma.tradingSession.deleteMany({ where: { portfolioId: { in: created.portfolios } } });
  await prisma.strategyAssignment.deleteMany({ where: { portfolioId: { in: created.portfolios } } });
  await prisma.strategyVersion.deleteMany({ where: { strategyId: { in: created.strategies } } });
  await prisma.strategy.deleteMany({ where: { id: { in: created.strategies } } });
  await prisma.portfolio.deleteMany({ where: { id: { in: created.portfolios } } });
  await prisma.asset.deleteMany({ where: { id: { in: created.assets } } });
  await prisma.$disconnect();
});

describe("arena registration", () => {
  it("registers running portfolios as they are — forward start, capital and ledger untouched", async () => {
    const before = await prisma.portfolio.findUniqueOrThrow({ where: { id: champion.portfolio.id } });
    const ledgerBefore = await prisma.portfolioLedgerEntry.count({ where: { portfolioId: champion.portfolio.id } });

    const registered = await registerArenaParticipant(prisma, {
      cohortKey: COHORT,
      portfolioKey: champion.key,
      status: "CHAMPION",
      actorId: "test",
      asOf: ASOF
    });
    assert.equal(registered.ok, true);
    if (!registered.ok) return;
    const participant = await prisma.arenaParticipant.findUniqueOrThrow({
      where: { id: registered.result.participantId },
      include: { events: true }
    });
    assert.equal(participant.status, "CHAMPION");
    assert.equal(participant.forwardStartAt?.toISOString(), FORWARD_START.toISOString());
    assert.equal(participant.initialCapital.toString(), "10000");
    assert.equal(participant.strategyVersionId, champion.versions[0]!.id);
    assert.deepEqual(
      participant.events.map((event) => [event.eventType, event.toStatus, event.reasonCode]),
      [["REGISTERED", "CHAMPION", "OPERATOR_DESIGNATION"]]
    );

    const afterRow = await prisma.portfolio.findUniqueOrThrow({ where: { id: champion.portfolio.id } });
    assert.deepEqual({ ...afterRow, updatedAt: null }, { ...before, updatedAt: null }, "registration never writes the portfolio");
    assert.equal(await prisma.portfolioLedgerEntry.count({ where: { portfolioId: champion.portfolio.id } }), ledgerBefore);

    const again = await registerArenaParticipant(prisma, {
      cohortKey: COHORT,
      portfolioKey: champion.key,
      status: "CHAMPION",
      actorId: "test",
      asOf: ASOF
    });
    assert.equal(again.ok && again.result.created, false, "idempotent");
  });

  it("refuses a second champion and a portfolio that trades two strategy versions", async () => {
    const secondChampion = await registerArenaParticipant(prisma, {
      cohortKey: COHORT,
      portfolioKey: challenger.key,
      status: "CHAMPION",
      actorId: "test",
      asOf: ASOF
    });
    assert.equal(secondChampion.ok, false);
    if (!secondChampion.ok) assert.equal(secondChampion.reasonCode, "ARENA_CHAMPION_EXISTS");

    const mixed = await seedPortfolio("MIXED", { versions: 2 });
    const ambiguous = await registerArenaParticipant(prisma, {
      cohortKey: COHORT,
      portfolioKey: mixed.key,
      status: "ACTIVE",
      actorId: "test",
      asOf: ASOF
    });
    assert.equal(ambiguous.ok, false);
    if (!ambiguous.ok) assert.equal(ambiguous.reasonCode, "ARENA_PORTFOLIO_STRATEGY_AMBIGUOUS");

    const ok = await registerArenaParticipant(prisma, {
      cohortKey: COHORT,
      portfolioKey: challenger.key,
      status: "ACTIVE",
      actorId: "test",
      asOf: ASOF
    });
    assert.equal(ok.ok, true);
  });
});

describe("arena evaluation", () => {
  it("evaluates, ranks and recommends from forward data only, idempotently and hash-chained", async () => {
    const first = await evaluateArenaCohort(prisma, { cohortKey: COHORT, asOf: ASOF, codeVersion: "test" });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const written = first.result.entries.filter((entry) => entry.outcome === "WRITTEN");
    assert.equal(written.length, 2);
    for (const entry of written) {
      assert.equal(entry.evidence, "PROVISIONAL");
      assert.equal(entry.recommendation, "HOLD");
      assert.equal(entry.fitness, 50, "no trade yet: exactly neutral");
    }
    // Both exactly neutral: they share the first rank instead of an alphabetical order.
    assert.deepEqual(written.map((entry) => entry.rank), [1, 1]);

    const repeat = await evaluateArenaCohort(prisma, { cohortKey: COHORT, asOf: ASOF, codeVersion: "test" });
    assert.ok(repeat.ok && repeat.result.entries.every((entry) => entry.outcome !== "WRITTEN"));

    await evaluateArenaCohort(prisma, { cohortKey: COHORT, asOf: new Date(ASOF.getTime() + 3_600_000), codeVersion: "test" });
    const participant = await prisma.arenaParticipant.findFirstOrThrow({ where: { portfolioId: champion.portfolio.id } });
    const chain = await verifyArenaEvaluationChain(prisma, participant.id);
    assert.deepEqual([chain.ok, chain.checked], [true, 2]);

    // Rewriting history is detected.
    const [oldest] = await prisma.arenaEvaluation.findMany({
      where: { participantId: participant.id },
      orderBy: { asOf: "asc" },
      take: 1
    });
    await prisma.$executeRaw`UPDATE "ArenaEvaluation" SET "fitness" = 99 WHERE "id" = ${oldest!.id}`;
    const tampered = await verifyArenaEvaluationChain(prisma, participant.id);
    assert.equal(tampered.ok, false);
    assert.equal(tampered.brokenAt, oldest!.id);
    await prisma.$executeRaw`UPDATE "ArenaEvaluation" SET "fitness" = ${new Prisma.Decimal(50)} WHERE "id" = ${oldest!.id}`;
    assert.equal((await verifyArenaEvaluationChain(prisma, participant.id)).ok, true);
  });

  it("stops at once on capital from nowhere or a swapped strategy version, whatever the evidence", async () => {
    await prisma.portfolioLedgerEntry.create({
      data: {
        entryKey: `${challenger.key}:topup`,
        portfolioId: challenger.portfolio.id,
        sequence: 2,
        type: "CORRECTION",
        availableCashDelta: "5000",
        balanceAfterJson: { availableCash: "15000" },
        occurredAt: ASOF
      }
    });
    const other = await prisma.strategyVersion.create({
      data: {
        strategyId: challenger.strategy.id,
        version: 2,
        status: "ACTIVE",
        engineVersion: "test/2.0.0",
        codeVersion: "test",
        parametersJson: { changed: true },
        specificationHash: `hash-${challenger.key}-silent`,
        createdBy: "test"
      }
    });
    await prisma.strategyAssignment.updateMany({
      where: { portfolioId: challenger.portfolio.id },
      data: { strategyVersionId: other.id }
    });

    const asOf = new Date(ASOF.getTime() + 2 * 3_600_000);
    const result = await evaluateArenaCohort(prisma, { cohortKey: COHORT, asOf, codeVersion: "test" });
    assert.equal(result.ok, true);
    const participant = await prisma.arenaParticipant.findFirstOrThrow({ where: { portfolioId: challenger.portfolio.id } });
    const evaluation = await prisma.arenaEvaluation.findFirstOrThrow({ where: { participantId: participant.id, asOf } });
    assert.equal(evaluation.hardStop, true);
    assert.equal(evaluation.evidenceStatus, "PROVISIONAL");
    assert.equal(evaluation.recommendation, "PROBATION");
    assert.ok(evaluation.reasonCodes.includes("CAPITAL_INTEGRITY_UNEXPLAINED_ENTRY"));
    assert.ok(evaluation.reasonCodes.includes("STRATEGY_VERSION_DRIFT"));
    const unchanged = await prisma.arenaParticipant.findUniqueOrThrow({ where: { id: participant.id } });
    assert.equal(unchanged.status, "ACTIVE", "Arena V1 only recommends");
  });
});

describe("arena transitions and post-mortems", () => {
  it("guards every status change and opens a frozen dossier on probation", async () => {
    const participant = await prisma.arenaParticipant.findFirstOrThrow({ where: { portfolioId: challenger.portfolio.id } });
    const base = { participantId: participant.id, actorId: "test", asOf: new Date(ASOF.getTime() + 3 * 3_600_000) };

    const proven = await transitionArenaParticipant(prisma, {
      ...base,
      to: "PROVEN",
      reason: "PERFORMANCE",
      idempotencyKey: "t-proven"
    });
    assert.equal(proven.ok, false);
    if (!proven.ok) assert.equal(proven.reasonCode, "ARENA_EVIDENCE_INSUFFICIENT");

    const probation = await transitionArenaParticipant(prisma, {
      ...base,
      to: "PROBATION",
      reason: "HARD_STOP",
      idempotencyKey: "t-probation",
      note: "Unexplained top-up and a silent version swap."
    });
    assert.equal(probation.ok, true);
    if (!probation.ok) return;
    assert.ok(probation.result.postMortemId !== null);
    const postMortem = await prisma.arenaPostMortem.findUniqueOrThrow({ where: { id: probation.result.postMortemId! } });
    assert.equal(postMortem.status, "OPEN");
    assert.equal(postMortem.dossierVersion, ARENA_DOSSIER_VERSION);
    const dossier = postMortem.dossierJson as Record<string, unknown>;
    assert.ok(Array.isArray(dossier.trades) && Array.isArray(dossier.evaluationsDaily) && Array.isArray(dossier.lifecycle));

    const retireWhileTrading = await transitionArenaParticipant(prisma, {
      ...base,
      to: "RETIRED",
      reason: "STRATEGY_DEFECT",
      idempotencyKey: "t-retire"
    });
    assert.equal(retireWhileTrading.ok, false);
    if (!retireWhileTrading.ok) assert.equal(retireWhileTrading.reasonCode, "ARENA_SESSION_STILL_ACTIVE");

    await prisma.tradingSession.update({ where: { id: challenger.session.id }, data: { status: "PAUSED" } });
    const retired = await transitionArenaParticipant(prisma, {
      ...base,
      to: "RETIRED",
      reason: "STRATEGY_DEFECT",
      idempotencyKey: "t-retire"
    });
    assert.equal(retired.ok, true);

    const events = await prisma.arenaParticipantEvent.findMany({
      where: { participantId: participant.id },
      orderBy: { occurredAt: "asc" }
    });
    assert.deepEqual(
      events.map((event) => [event.fromStatus, event.toStatus, event.reasonCode]),
      [
        [null, "ACTIVE", "FORWARD_TEST_STARTED"],
        ["ACTIVE", "PROBATION", "HARD_STOP"],
        ["PROBATION", "RETIRED", "STRATEGY_DEFECT"]
      ]
    );
    const evaluated = await evaluateArenaCohort(prisma, {
      cohortKey: COHORT,
      asOf: new Date(ASOF.getTime() + 4 * 3_600_000),
      codeVersion: "test"
    });
    assert.ok(
      evaluated.ok &&
        evaluated.result.entries.some((entry) => entry.participantKey === participant.participantKey && entry.outcome === "SKIPPED")
    );
  });

  it("records a hypothesis and links the successor version as a new participant", async () => {
    const retired = await prisma.arenaParticipant.findFirstOrThrow({ where: { portfolioId: challenger.portfolio.id } });
    const [postMortem] = await prisma.arenaPostMortem.findMany({
      where: { participantId: retired.id, status: "OPEN" },
      orderBy: { createdAt: "asc" }
    });
    const recorded = await recordArenaPostMortemHypothesis(prisma, {
      postMortemId: postMortem!.id,
      author: "claude",
      hypothesis: "Entries in a MIXED regime lost; require RISK_ON for two consecutive days.",
      proposedStrategyKey: "TEST_V2",
      asOf: ASOF
    });
    assert.equal(recorded.ok, true);

    const successorPortfolio = await seedPortfolio("V2");
    const successor = await registerArenaParticipant(prisma, {
      cohortKey: COHORT,
      portfolioKey: successorPortfolio.key,
      status: "ACTIVE",
      actorId: "test",
      asOf: ASOF,
      parentParticipantId: retired.id
    });
    assert.equal(successor.ok, true);
    if (!successor.ok) return;
    const linked = await prisma.arenaPostMortem.findUniqueOrThrow({ where: { id: postMortem!.id } });
    assert.equal(linked.status, "SUCCESSOR_REGISTERED");
    assert.equal(linked.successorParticipantId, successor.result.participantId);

    const dossier = await buildArenaPostMortemDossier(prisma, retired.id, ASOF);
    assert.equal((dossier?.participant as { status: string }).status, "RETIRED");
  });
});

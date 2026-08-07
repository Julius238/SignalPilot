import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  decimalTone,
  formatDecimalAmount,
  formatSignedDecimal,
  formatUnknownableDecimal,
  formatUtcDateTime,
  isDataStale,
  UNKNOWN_LABEL
} from "../src/lib/trading-format";
import {
  CONFIRM_PHRASES,
  RUN_JOB_ALLOWLIST,
  isAllowedJobName,
  parseVersionFromConflictMessage
} from "../src/lib/trading-api";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = (path: string) => readFile(resolve(appDir, path), "utf8");

const TRADING_PAGES = [
  "src/app/dashboard/trading/page.tsx",
  "src/app/dashboard/trading/candidates/page.tsx",
  "src/app/dashboard/trading/candidates/[id]/page.tsx",
  "src/app/dashboard/trading/positions/page.tsx",
  "src/app/dashboard/trading/positions/[id]/page.tsx",
  "src/app/dashboard/trading/orders/page.tsx",
  "src/app/dashboard/trading/performance/page.tsx",
  "src/app/dashboard/trading/risk/page.tsx",
  "src/app/dashboard/trading/audit/page.tsx",
  "src/app/dashboard/trading/operations/page.tsx"
];

describe("trading dashboard feature flag", () => {
  it("defaults to disabled in both env examples", async () => {
    const example = await readSrc("../../.env.example");
    const productionExample = await readSrc("../../.env.production.example");

    assert.match(example, /NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED=false/);
    assert.match(
      productionExample,
      /NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED=false/
    );
  });

  it("only treats the literal string 'true' as enabled", async () => {
    const source = await readSrc("src/lib/trading-flag.ts");
    assert.match(
      source,
      /process\.env\.NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED === "true"/
    );
  });

  it("gates the navigation group behind the flag", async () => {
    const source = await readSrc("src/components/nav-bar.tsx");
    assert.match(
      source,
      /import \{ TRADING_DASHBOARD_ENABLED \} from "\.\.\/lib\/trading-flag"/
    );
    assert.match(source, /\.\.\.\(TRADING_DASHBOARD_ENABLED/);
    assert.match(source, /label: "Shadow Trading"/);
  });

  it("gates every trading page and layout against unconditional fetching", async () => {
    for (const page of [
      ...TRADING_PAGES,
      "src/app/dashboard/trading/layout.tsx"
    ]) {
      const source = await readSrc(page);
      assert.match(
        source,
        /TRADING_DASHBOARD_ENABLED/,
        `${page} must reference the feature flag`
      );
      assert.match(
        source,
        /if \(!TRADING_DASHBOARD_ENABLED\)/,
        `${page} must early-return before fetching when disabled`
      );
    }
  });

  it("never renders trading data fetch calls before the flag check in a page body", async () => {
    for (const page of TRADING_PAGES) {
      const source = await readSrc(page);
      const guardIndex = source.indexOf("if (!TRADING_DASHBOARD_ENABLED)");
      const fetchIndex = source.search(
        /fetch(TradeCandidates|TradeCandidateDetail|TradingOverview|ShadowOrders|ShadowFills|ShadowPositions|ShadowPositionDetail|RiskAssessments|RiskEvents|TradingSessions|TradingAudit|WorkerStatus|StrategyPerformance|TradingPortfolio(Snapshots)?)\(/
      );
      assert.ok(guardIndex >= 0, `${page} is missing the flag guard`);
      if (fetchIndex >= 0) {
        assert.ok(
          guardIndex < fetchIndex,
          `${page} calls a trading fetch before the flag guard`
        );
      }
    }
  });

  it("shows the disabled state without rendering trading content in the shared layout", async () => {
    const source = await readSrc("src/app/dashboard/trading/layout.tsx");
    assert.match(source, /TradingDisabled/);
    assert.match(source, /ShadowBanner/);
    assert.match(source, /TradingSubnav/);
  });
});

describe("shadow trading banner and disabled state", () => {
  it("labels the section clearly as shadow trading with no real exchange orders", async () => {
    const source = await readSrc("src/components/trading/shadow-banner.tsx");
    assert.match(source, /SHADOW TRADING/);
    assert.match(source, /Keine echten Börsenorders/);
  });

  it("explains why the dashboard is inaccessible when disabled", async () => {
    const source = await readSrc("src/components/trading/trading-disabled.tsx");
    assert.match(source, /Shadow Trading ist deaktiviert/);
    assert.match(source, /NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED/);
  });
});

describe("auth protection", () => {
  it("keeps /dashboard/trading/* under the existing dashboard auth matcher", async () => {
    const source = await readSrc("src/middleware.ts");
    assert.match(source, /"\/dashboard\/:path\*"/);
  });
});

describe("decimal and UTC formatting", () => {
  it("formats decimal strings for display using German locale grouping", () => {
    const expected = new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(1234.5);
    assert.equal(formatDecimalAmount("1234.5"), expected);
  });

  it("never silently treats missing decimals as zero", () => {
    assert.equal(formatDecimalAmount(null), "—");
    assert.equal(formatDecimalAmount(undefined), "—");
    assert.equal(formatUnknownableDecimal(null), UNKNOWN_LABEL);
  });

  it("signs positive values explicitly and lets negatives keep their own sign", () => {
    assert.match(formatSignedDecimal("5"), /^\+/);
    assert.ok(!formatSignedDecimal("-5").startsWith("+"));
    assert.equal(formatSignedDecimal(null), "—");
  });

  it("derives good/bad/neutral tone from the decimal sign only", () => {
    assert.equal(decimalTone("5"), "good");
    assert.equal(decimalTone("-5"), "bad");
    assert.equal(decimalTone("0"), "neutral");
    assert.equal(decimalTone(null), "neutral");
  });

  it("formats timestamps explicitly in UTC with an explicit UTC label", () => {
    const iso = "2026-08-02T13:45:00.000Z";
    const formatted = formatUtcDateTime(iso);

    assert.match(formatted, / UTC$/);
    // Vierstelliges Jahr wie im übrigen Dashboard — nicht "02.08.26".
    assert.match(formatted, /02\.08\.2026/);
    assert.match(formatted, /13:45:00/);
    assert.equal(formatUtcDateTime(null), "—");
  });

  it("treats missing timestamps as stale rather than fresh", () => {
    const now = new Date("2026-08-02T00:00:00.000Z");
    assert.equal(isDataStale(null, 60_000, now), true);
    assert.equal(isDataStale("2026-08-01T23:00:00.000Z", 60_000, now), true);
    assert.equal(isDataStale("2026-08-01T23:59:50.000Z", 60_000, now), false);
  });
});

describe("operations require reason, confirmation, version, CSRF and idempotency", () => {
  it("fetches a fresh CSRF token and attaches it to every operation POST", async () => {
    const source = await readSrc("src/lib/trading-api.ts");
    assert.match(source, /fetchTradingCsrfToken/);
    assert.match(source, /"x-trading-csrf-token": csrf\.data\.csrfToken/);
    assert.match(source, /method: "POST"/);
  });

  it("requires a non-empty reason and an exact confirmation phrase before enabling submit", async () => {
    const source = await readSrc(
      "src/components/trading/operation-confirm.tsx"
    );
    assert.match(source, /reason\.trim\(\)\.length > 0/);
    assert.match(source, /confirmInput === confirmPhrase/);
    assert.match(source, /idempotencyKeyRef/);
  });

  it("regenerates the idempotency key only for a fresh attempt, not on retry", async () => {
    const source = await readSrc(
      "src/components/trading/operation-confirm.tsx"
    );
    assert.match(source, /function openPanel/);
    assert.match(source, /idempotencyKeyRef\.current = newIdempotencyKey\(\)/);
    assert.match(
      source,
      /const idempotencyKey = idempotencyKeyRef\.current \?\? newIdempotencyKey\(\)/
    );
  });

  it("round-trips the current entity version for every versioned operation", async () => {
    const source = await readSrc(
      "src/app/dashboard/trading/operations/page.tsx"
    );
    assert.match(source, /expectedVersion: portfolio\?\.version/);
    assert.match(source, /expectedVersion: session\.version/);
    // The position operation carries its version through the serialisable
    // split spec rather than an inline callback.
    assert.match(source, /versionKey: "expectedVersion"/);
  });

  it("does not send expectedVersion for the non-versioned run-job operation", async () => {
    const source = await readSrc(
      "src/app/dashboard/trading/operations/page.tsx"
    );
    const start = source.indexOf('endpoint="/trading/operations/run-job"');
    assert.ok(start > 0, "run-job operation panel not found");
    const bodyStart = source.indexOf("body={{", start);
    assert.ok(bodyStart > start, "run-job body spec not found");
    const bodyEnd = source.indexOf("/>", bodyStart);
    const bodySnippet = source.slice(bodyStart, bodyEnd);
    assert.doesNotMatch(bodySnippet, /expectedVersion/);
  });

  it("marks the confirm-phrase constants exactly as the API expects", () => {
    assert.equal(CONFIRM_PHRASES.engageKillSwitch, "ENGAGE_KILL_SWITCH");
    assert.equal(CONFIRM_PHRASES.manualRiskClose, "MANUAL_RISK_CLOSE");
    assert.equal(CONFIRM_PHRASES.runJob, "RUN_JOB");
  });

  it("visually marks dangerous operations", async () => {
    const source = await readSrc(
      "src/app/dashboard/trading/operations/page.tsx"
    );
    assert.match(
      source,
      /title="Kill-Switch aktivieren"[\s\S]{0,400}dangerous/
    );
    assert.match(
      source,
      /title="Position risikoreduzierend schließen"[\s\S]{0,400}dangerous/
    );
  });
});

describe("version conflicts and API errors", () => {
  it("extracts the current version from the 409 conflict message", () => {
    assert.equal(
      parseVersionFromConflictMessage(
        "Current version is 5. Reload and retry with the current version."
      ),
      5
    );
    assert.equal(parseVersionFromConflictMessage("Forbidden"), null);
  });

  it("shows the raw API error message and marks status as error, without optimistic success", async () => {
    const source = await readSrc(
      "src/components/trading/operation-confirm.tsx"
    );
    assert.match(source, /setStatus\("error"\)/);
    assert.match(source, /setMessage\(result\.error/);
    assert.doesNotMatch(
      source,
      /setStatus\("success"\)[\s\S]{0,40}result\.error/
    );
  });

  it("treats a disabled operations API (404) as unavailable, not a hard crash", async () => {
    const source = await readSrc("src/lib/trading-api.ts");
    assert.match(source, /Operationen sind derzeit nicht verfügbar/);
  });
});

describe("manual risk close only offers currently open positions", () => {
  it("fetches positions with open=true for the manual risk close selector", async () => {
    const source = await readSrc(
      "src/app/dashboard/trading/operations/page.tsx"
    );
    assert.match(
      source,
      /fetchShadowPositions\(\{ open: "true", limit: 100 \}\)/
    );
    assert.doesNotMatch(source, /fetchShadowPositions\(\{ open: "false"/);
  });

  it("encodes the selected position's own version instead of a shared/static one", async () => {
    const source = await readSrc(
      "src/app/dashboard/trading/operations/page.tsx"
    );
    assert.match(
      source,
      /value: `\$\{position\.id\}::\$\{position\.version\}`/
    );
    // Decoded by the client component from a declarative spec — the id and the
    // version must still come from the SAME selected option, never from a
    // separate field that could drift apart.
    assert.match(source, /from: "positionId"/);
    assert.match(source, /separator: "::"/);
    assert.match(source, /idKey: "shadowPositionId"/);
    assert.match(source, /versionKey: "expectedVersion"/);
  });
});

describe("server/client component boundary stays serialisable", () => {
  // Regression guard for the build failure that only appeared once
  // NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED=true made Next.js actually prerender
  // /dashboard/trading/operations: the page is a Server Component, and React
  // cannot serialise a function prop across the boundary
  // ("Functions cannot be passed directly to Client Components").
  it("passes no function prop from the operations page into OperationConfirm", async () => {
    const source = await readSrc(
      "src/app/dashboard/trading/operations/page.tsx"
    );
    assert.doesNotMatch(
      source,
      /buildBody=/,
      "buildBody was a function prop and must not come back"
    );
    assert.doesNotMatch(
      source,
      /\b(body|extraFields|options)=\{\s*\([^)]*\)\s*=>/,
      "no arrow function may be handed to the client component as a prop"
    );
  });

  it("declares the request body as data, not as a callback", async () => {
    const component = await readSrc(
      "src/components/trading/operation-confirm.tsx"
    );
    assert.match(component, /export type OperationBodySpec/);
    assert.match(component, /export function buildOperationBody/);
    assert.doesNotMatch(
      component,
      /buildBody:/,
      "the callback prop must be gone"
    );
  });

  it("keeps the trading pages server components so no data fetch moves into the browser", async () => {
    for (const page of TRADING_PAGES) {
      const source = await readSrc(page);
      assert.doesNotMatch(
        source,
        /^"use client"/m,
        `${page} must stay a server component`
      );
    }
  });
});

describe("manual job trigger only allows the fixed allowlist", () => {
  it("exposes exactly the allowlisted shadow jobs and mirrors the API's own list", () => {
    assert.deepEqual(RUN_JOB_ALLOWLIST, [
      "shadow-start-trading-day",
      "shadow-generate-candidates",
      "shadow-assess-risk",
      "shadow-create-orders",
      "shadow-process-fills",
      "shadow-monitor-positions",
      "shadow-reconcile-portfolio",
      // P8. Reporting and operations jobs; each enforces its own feature flag
      // server-side, and shadow-retention is dry-run-only over this route.
      "shadow-performance-refresh",
      "shadow-alert-outbox",
      "shadow-retention"
    ]);
  });

  it("rejects anything outside the allowlist, including shell-injection-style payloads", () => {
    assert.equal(isAllowedJobName("shadow-start-trading-day"), true);
    assert.equal(isAllowedJobName("rm -rf /"), false);
    assert.equal(isAllowedJobName("shadow-start-trading-day; rm -rf /"), false);
    assert.equal(isAllowedJobName(""), false);
  });

  it("renders the job picker as a fixed select, never a free-text input", async () => {
    const source = await readSrc(
      "src/app/dashboard/trading/operations/page.tsx"
    );
    assert.match(source, /name: "jobName"[\s\S]{0,120}type: "select"/);
    assert.match(source, /options: RUN_JOB_ALLOWLIST\.map/);
    assert.doesNotMatch(source, /<input[^>]*jobName/);
  });

  it("only lets the OperationConfirm select render options from the fixed list, never free text", async () => {
    const source = await readSrc(
      "src/components/trading/operation-confirm.tsx"
    );
    const selectBranchStart = source.indexOf('field.type === "select"');
    const selectBranchEnd = source.indexOf(") : (", selectBranchStart);
    const branch = source.slice(selectBranchStart, selectBranchEnd);
    assert.match(branch, /field\.options/);
    assert.doesNotMatch(branch, /<input/);
  });
});

describe("no secrets or unfiltered audit payloads in the DOM", () => {
  it("never renders audit state in the paginated list view", async () => {
    const source = await readSrc("src/app/dashboard/trading/audit/page.tsx");
    // The list comes straight from GET /trading/audit, which does not
    // sanitise — so the list table must not render any state at all.
    const listStart = source.indexOf("{events.map(");
    assert.ok(listStart > 0, "the audit list table should still exist");
    const listEnd = source.indexOf("</SectionCard>", listStart);
    const listBlock = source.slice(listStart, listEnd);
    assert.doesNotMatch(listBlock, /beforeState/);
    assert.doesNotMatch(listBlock, /afterState/);
    assert.match(source, /bewusst nicht als Rohdaten/);
  });

  it("renders drilldown state only from the server-sanitised drilldown route", async () => {
    const source = await readSrc("src/app/dashboard/trading/audit/page.tsx");
    // P8's incident review does show before/after — but only the payload the
    // API already stripped server-side (`getAuditDrilldown` -> `sanitiseState`),
    // never the unsanitised list payload.
    const drilldownStart = source.indexOf("{drilldown.events.map(");
    assert.ok(drilldownStart > 0, "the drilldown event table should exist");
    assert.match(source, /fetchAuditDrilldown/);
    assert.match(source, /serverseitig bereinigt/);

    // Every actual state *rendering* (`event.beforeState`, `event.afterState`)
    // must sit inside the drilldown block. The words also appear in the list
    // card's own subtitle, which is prose, not a rendered value.
    for (const match of source.matchAll(/event\.(before|after)State/g)) {
      assert.ok(
        (match.index ?? 0) >= drilldownStart,
        "audit state may only be rendered inside the sanitised drilldown block"
      );
    }
  });

  it("routes the drilldown through the API rather than assembling the chain in the browser", async () => {
    const apiClient = await readSrc("src/lib/trading-api.ts");
    assert.match(apiClient, /\/trading\/audit\/drilldown/);
    const source = await readSrc("src/app/dashboard/trading/audit/page.tsx");
    // The page must not query domain tables itself; it only calls the client.
    assert.doesNotMatch(source, /prisma/i);
  });

  it("only reads the trading dashboard flag from process.env, nowhere else in trading pages", async () => {
    for (const page of TRADING_PAGES) {
      const source = await readSrc(page);
      assert.doesNotMatch(
        source,
        /process\.env/,
        `${page} should not read process.env directly`
      );
    }
    const flagSource = await readSrc("src/lib/trading-flag.ts");
    assert.match(
      flagSource,
      /process\.env\.NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED/
    );
  });
});

describe("server-side filters and pagination", () => {
  it("bounds every list fetch to a fixed, small limit", async () => {
    for (const page of TRADING_PAGES) {
      const source = await readSrc(page);
      const limitMatches = [...source.matchAll(/limit:\s*(\d+)/g)].map(
        (match) => Number(match[1])
      );
      const constLimitMatches = [
        ...source.matchAll(/const LIMIT = (\d+);/g)
      ].map((match) => Number(match[1]));
      for (const value of [...limitMatches, ...constLimitMatches]) {
        assert.ok(
          value > 0 && value <= 200,
          `${page} uses an out-of-range limit: ${value}`
        );
      }
    }
  });

  it("derives has-more-pages from result count instead of a nonexistent total field", async () => {
    const source = await readSrc(
      "src/components/trading/trading-pagination.tsx"
    );
    assert.match(source, /count === limit/);
  });

  it("clamps offset to a non-negative number derived from the query string", async () => {
    for (const page of [
      "src/app/dashboard/trading/candidates/page.tsx",
      "src/app/dashboard/trading/positions/page.tsx",
      "src/app/dashboard/trading/orders/page.tsx",
      "src/app/dashboard/trading/audit/page.tsx"
    ]) {
      const source = await readSrc(page);
      assert.match(
        source,
        /Math\.max\(0, Number\(params\.\w+Offset\) \|\| 0\)|Math\.max\(0, Number\(params\.offset\) \|\| 0\)/
      );
    }
  });
});

describe("status is never color-only", () => {
  it("every trading status badge renders a German text label", async () => {
    const source = await readSrc("src/components/trading/trading-status.tsx");
    assert.match(source, /SHADOW_ACTIVE: "Shadow aktiv"/);
    assert.match(source, /STOPPED: "Gestoppt"/);
    assert.match(source, /PAUSED: "Pausiert"/);
    assert.match(source, /KILLED: "Kill-Switch aktiv"/);
    assert.match(source, /ERROR_LOCKED: "Fehler-Sperre"/);
    assert.match(source, /Circuit Breaker: blockiert/);
    assert.match(source, /Reconcile: veraltet/);
  });

  it("overview shows unknown, not zero, for missing daily P&L", async () => {
    const source = await readSrc("src/app/dashboard/trading/page.tsx");
    assert.match(source, /overview\.dailyPnl === null/);
    assert.match(source, /UNKNOWN_LABEL/);
  });
});

describe("responsive tables", () => {
  it("defines the table-to-card media query", async () => {
    const source = await readSrc("src/app/globals.css");
    assert.match(source, /\.responsive-table/);
    assert.match(source, /@media \(max-width: 640px\)/);
  });

  it("applies the responsive table class to the densest mobile-facing lists", async () => {
    const candidates = await readSrc(
      "src/app/dashboard/trading/candidates/page.tsx"
    );
    const positions = await readSrc(
      "src/app/dashboard/trading/positions/page.tsx"
    );
    assert.match(candidates, /className="responsive-table"/);
    assert.match(positions, /className="responsive-table"/);
  });
});

describe("loading, empty and error states", () => {
  it("provides a route-level loading skeleton", async () => {
    const source = await readSrc("src/app/dashboard/trading/loading.tsx");
    assert.match(source, /skeleton-block/);
  });

  it("every trading page renders explicit empty and error states", async () => {
    for (const page of TRADING_PAGES) {
      const source = await readSrc(page);
      assert.match(
        source,
        /EmptyState|ErrorState/,
        `${page} must render an empty or error state`
      );
    }
  });
});

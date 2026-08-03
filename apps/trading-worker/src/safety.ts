/**
 * Process-level startup guard for `apps/trading-worker`.
 *
 * Mirrors `apps/worker/src/lib/safety.ts` exactly: `ENABLE_LIVE_TRADING=true`
 * is the one condition severe enough to refuse to start the process at all
 * rather than simply idling. Every other "not configured" state (worker
 * disabled, scheduler disabled, an individual job flag off — all safe
 * defaults) is handled by `index.ts` staying up and not starting the
 * scheduler, so a normal safe-default deployment does not crash-loop.
 */

export type SafetyCheckResult = { readonly safe: true } | { readonly safe: false; readonly reason: string };

export function checkProductionSafety(env: Readonly<Record<string, string | undefined>> = process.env): SafetyCheckResult {
  if (env.ENABLE_LIVE_TRADING === "true") {
    return {
      safe: false,
      reason:
        "ENABLE_LIVE_TRADING=true is not allowed. " +
        "apps/trading-worker only ever simulates shadow trades. Set ENABLE_LIVE_TRADING=false."
    };
  }
  return { safe: true };
}

export function assertProductionSafety(env: Readonly<Record<string, string | undefined>> = process.env): void {
  const result = checkProductionSafety(env);
  if (!result.safe) {
    process.stderr.write(`\nSTARTUP ABORTED: ${result.reason}\n\n`);
    process.exit(1);
  }
}

export type SafetyCheckResult = { safe: true } | { safe: false; reason: string };

export function checkProductionSafety(): SafetyCheckResult {
  if (process.env.ENABLE_LIVE_TRADING === "true") {
    return {
      safe: false,
      reason:
        "ENABLE_LIVE_TRADING=true is not allowed. " +
        "SignalPilot does not execute real trades. Set ENABLE_LIVE_TRADING=false."
    };
  }
  return { safe: true };
}

export function assertProductionSafety(): void {
  const result = checkProductionSafety();
  if (!result.safe) {
    process.stderr.write(`\nSTARTUP ABORTED: ${result.reason}\n\n`);
    process.exit(1);
  }
}

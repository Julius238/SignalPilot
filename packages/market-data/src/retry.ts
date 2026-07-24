import { ProviderRequestError } from "./provider-errors.js";

export type ProviderRetryEvent = {
  attempt: number;
  delayMs: number;
  kind: string;
  statusCode: number | null;
};

export type ProviderRetryOptions<T = unknown> = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetryResult?: (value: T) => boolean;
  resultKind?: (value: T) => string;
  onRetry?: (event: ProviderRetryEvent) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

export type ProviderRetryOutcome<T> = {
  value: T;
  retryCount: number;
};

export async function retryProviderRequest<T>(
  operation: (attempt: number) => Promise<T>,
  options: ProviderRetryOptions<T> = {}
): Promise<ProviderRetryOutcome<T>> {
  const maxAttempts = clampInteger(options.maxAttempts ?? 3, 1, 10);
  const baseDelayMs = clampInteger(options.baseDelayMs ?? 500, 0, 60_000);
  const maxDelayMs = clampInteger(options.maxDelayMs ?? 8_000, baseDelayMs, 120_000);
  const sleep = options.sleep ?? delay;
  let retryCount = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await operation(attempt);
      const shouldRetry = options.shouldRetryResult?.(value) === true;

      if (!shouldRetry || attempt === maxAttempts) {
        return { value, retryCount };
      }

      const delayMs = calculateDelay(baseDelayMs, maxDelayMs, attempt);
      retryCount += 1;
      await options.onRetry?.({
        attempt,
        delayMs,
        kind: options.resultKind?.(value) ?? "TEMPORARY_RESULT",
        statusCode: null
      });
      await sleep(delayMs);
    } catch (error) {
      const retryable = error instanceof ProviderRequestError && error.retryable;

      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = calculateDelay(baseDelayMs, maxDelayMs, attempt);
      retryCount += 1;
      await options.onRetry?.({
        attempt,
        delayMs,
        kind: error.kind,
        statusCode: error.statusCode
      });
      await sleep(delayMs);
    }
  }

  throw new Error("Provider retry loop ended unexpectedly.");
}

function calculateDelay(baseDelayMs: number, maxDelayMs: number, attempt: number) {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
}

function clampInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function delay(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

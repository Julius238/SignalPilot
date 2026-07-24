export type ProviderFailureKind =
  | "INVALID_API_KEY"
  | "ENTITLEMENT"
  | "UNSUPPORTED_SYMBOL"
  | "RATE_LIMIT"
  | "TEMPORARY"
  | "PERMANENT";

export class ProviderRequestError extends Error {
  readonly provider: string;
  readonly kind: ProviderFailureKind;
  readonly statusCode: number | null;
  readonly retryable: boolean;

  constructor(input: {
    provider: string;
    kind: ProviderFailureKind;
    statusCode?: number | null;
    retryable: boolean;
    endpoint: string;
  }) {
    const status = input.statusCode ? ` HTTP ${input.statusCode}` : "";
    super(`${input.provider} ${input.endpoint} request failed:${status} ${input.kind}.`);
    this.name = "ProviderRequestError";
    this.provider = input.provider;
    this.kind = input.kind;
    this.statusCode = input.statusCode ?? null;
    this.retryable = input.retryable;
  }
}

export function classifyProviderHttpError(
  provider: string,
  endpoint: string,
  statusCode: number,
  responseHint = ""
): ProviderRequestError {
  const normalizedHint = responseHint.toLowerCase();

  if (statusCode === 401 || normalizedHint.includes("invalid api key") || normalizedHint.includes("api key invalid")) {
    return new ProviderRequestError({
      provider,
      endpoint,
      statusCode,
      kind: "INVALID_API_KEY",
      retryable: false
    });
  }

  if (statusCode === 403) {
    return new ProviderRequestError({
      provider,
      endpoint,
      statusCode,
      kind: "ENTITLEMENT",
      retryable: false
    });
  }

  if (
    (statusCode === 400 || statusCode === 404) &&
    (normalizedHint.includes("symbol") || normalizedHint.includes("ticker"))
  ) {
    return new ProviderRequestError({
      provider,
      endpoint,
      statusCode,
      kind: "UNSUPPORTED_SYMBOL",
      retryable: false
    });
  }

  if (statusCode === 429) {
    return new ProviderRequestError({
      provider,
      endpoint,
      statusCode,
      kind: "RATE_LIMIT",
      retryable: true
    });
  }

  if (statusCode >= 500 || statusCode === 408 || statusCode === 425) {
    return new ProviderRequestError({
      provider,
      endpoint,
      statusCode,
      kind: "TEMPORARY",
      retryable: true
    });
  }

  return new ProviderRequestError({
    provider,
    endpoint,
    statusCode,
    kind: "PERMANENT",
    retryable: false
  });
}

export function toTemporaryProviderError(provider: string, endpoint: string): ProviderRequestError {
  return new ProviderRequestError({
    provider,
    endpoint,
    kind: "TEMPORARY",
    retryable: true
  });
}

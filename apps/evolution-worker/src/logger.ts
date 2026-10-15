import pino from "pino";

/**
 * Structured logger. Secret-bearing paths are redacted by pino itself, so a
 * mistakenly logged config, header or error object can never print the key.
 */
export const logger = pino({
  name: "evolution-worker",
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "apiKey",
      "anthropicApiKey",
      "*.apiKey",
      "*.anthropicApiKey",
      "headers.authorization",
      "headers[\"x-api-key\"]",
      "*.headers.authorization",
      "*.headers[\"x-api-key\"]",
      "databaseUrl",
      "*.databaseUrl"
    ],
    censor: "[REDACTED]"
  }
});

export type Logger = typeof logger;

export const BCRYPT_HASH_PATTERN = /^\$2[aby]\$(?:0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/;

const INVALID_PASSWORD_HASH_MESSAGE =
  "ADMIN_PASSWORD_HASH must be a complete bcrypt hash starting with $2a$, $2b$ or $2y$. Generate it with ADMIN_PASSWORD='your-cleartext-password' pnpm auth:hash-password";

export function validateAuthConfig(): void {
  validateDevLoginConfig();

  if (process.env.API_AUTH_ENABLED === "false") return;

  const sessionSecret = process.env.AUTH_SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("AUTH_SESSION_SECRET must be configured when API auth is enabled");
  }

  if (sessionSecret.length < 32) {
    throw new Error("AUTH_SESSION_SECRET must be at least 32 characters long");
  }

  if (isDevLoginEnabled()) return;

  if (!process.env.ADMIN_USERNAME) {
    throw new Error("ADMIN_USERNAME must be configured when API auth is enabled");
  }

  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!adminPasswordHash) {
    throw new Error("ADMIN_PASSWORD_HASH must be configured when API auth is enabled");
  }

  if (!BCRYPT_HASH_PATTERN.test(adminPasswordHash)) {
    throw new Error(INVALID_PASSWORD_HASH_MESSAGE);
  }
}

export function isProductionEnvironment(): boolean {
  return [process.env.NODE_ENV, process.env.APP_ENV, process.env.VERCEL_ENV].some(
    (value) => value === "production"
  );
}

export function isDevLoginEnabled(): boolean {
  return process.env.DEV_LOGIN_ENABLED === "true" && !isProductionEnvironment();
}

export function getDevLoginUsername(): string {
  return process.env.DEV_LOGIN_USERNAME || "dev-admin";
}

export function getPublicEnvironment(): string {
  return process.env.APP_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
}

export function validateDevLoginConfig(): void {
  if (process.env.DEV_LOGIN_ENABLED === "true" && isProductionEnvironment()) {
    throw new Error("DEV_LOGIN_ENABLED must not be true in production.");
  }
}

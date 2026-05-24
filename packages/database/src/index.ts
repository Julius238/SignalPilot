// Runtime entry point — all exports come from runtime-values which uses
// createRequire so Node.js never attempts a static named re-export from
// the CJS @prisma/client bundle.
// TypeScript type information is provided by dist/types.d.ts (see src/types.ts).
export * from "./runtime-values.js";
// Type-only re-exports needed by internal database package files (e.g. seed.ts)
// that import directly from "./index.js" rather than through the types entry point.
export type { PrismaClient } from "@prisma/client";

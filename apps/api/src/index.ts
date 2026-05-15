import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

const appDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(appDir, "../../../.env") });
config();

const { buildServer } = await import("./server.js");

const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? "0.0.0.0";

const server = await buildServer();

try {
  await server.listen({ port, host });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}

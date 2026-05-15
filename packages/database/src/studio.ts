import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

const studioDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(studioDir, "../../../.env") });
config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Add it to the project root .env file.");
}

const studio = spawn("prisma", ["studio", "--schema", "prisma/schema.prisma"], {
  env: process.env,
  shell: true,
  stdio: "inherit"
});

studio.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

studio.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

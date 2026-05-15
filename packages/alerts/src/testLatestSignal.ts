import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "@signalpilot/database";
import { config } from "dotenv";

import { sendSignalAlertToN8n } from "./index.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(scriptDir, "../../../.env") });
config();

try {
  const signal = await prisma.signal.findFirst({
    where: {
      output: {
        isNot: null
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      asset: true,
      output: true
    }
  });

  if (!signal || !signal.output) {
    throw new Error("No signal with SignalOutput found.");
  }

  if (!signal.output.telegramText.trim()) {
    throw new Error(`SignalOutput ${signal.output.id} has empty telegramText.`);
  }

  const result = await sendSignalAlertToN8n({
    signal,
    signalOutput: signal.output,
    dashboardUrl: process.env.DASHBOARD_URL
  });

  console.log(JSON.stringify(result, null, 2));
} finally {
  await prisma.$disconnect();
}

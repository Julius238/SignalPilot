import "dotenv/config";

import pino from "pino";

const logger = pino({
  name: "signalpilot-worker"
});

logger.info("SignalPilot worker started");

import app from "./app";
import { logger } from "./lib/logger";
import { databaseConfigured } from "@workspace/db";
import { purgeExpiredYahooSessions } from "./lib/yahoo-store";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Delete expired credentials even when no one starts a new authorization.
const purge = () => purgeExpiredYahooSessions().catch(() => {
  logger.warn("Expired Yahoo connection cleanup is temporarily unavailable");
});
if (databaseConfigured) {
  void purge();
  setInterval(() => { void purge(); }, 15 * 60 * 1000).unref();
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

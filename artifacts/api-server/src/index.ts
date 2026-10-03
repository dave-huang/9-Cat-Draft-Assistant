import app from "./app";
import { logger } from "./lib/logger";
import { purgeExpiredYahooSessions } from "./lib/yahoo-store";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Delete expired credentials even when no one starts a new authorization.
const purge = () => purgeExpiredYahooSessions().catch(() => {
  logger.warn("Expired Yahoo connection cleanup is temporarily unavailable");
});
void purge();
setInterval(() => { void purge(); }, 15 * 60 * 1000).unref();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

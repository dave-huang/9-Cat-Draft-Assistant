import path from "node:path";
import { existsSync } from "node:fs";
import express, { type Express, type ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Browser API calls are same-origin: this server also serves the built web app.
// Never allow arbitrary sites to read connection status or private leagues.
// Images are transient request data. Do not raise the body limit for unrelated APIs.
app.use("/api/lineup-screenshot", express.json({ limit: "6mb" }));
const screenshotBodyError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === "entity.too.large") {
    res.status(413).json({ code: "image_too_large", error: "Screenshot too large. Use a smaller crop." }); return;
  }
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({ code: "invalid_image", error: "Invalid screenshot request. Choose the image again." }); return;
  }
  next(error);
};
app.use("/api/lineup-screenshot", screenshotBodyError);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Serve the built web app (pnpm build) with a single-page-app fallback.
// STATIC_DIR overrides the default location next to the bundled server.
const staticDir = path.resolve(
  process.env["STATIC_DIR"] ?? path.join(__dirname, "../../draft-assistant/dist/public"),
);
if (existsSync(path.join(staticDir, "index.html"))) {
  app.use(
    express.static(staticDir, {
      index: false,
      // Hashed build assets are immutable; HTML must always be revalidated.
      setHeaders(res, filePath) {
        res.setHeader(
          "Cache-Control",
          filePath.includes(`${path.sep}assets${path.sep}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // A missing file (e.g. a stale hashed asset) must 404, not return the app shell.
    if (path.extname(req.path)) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(staticDir, "index.html"));
  });
} else {
  logger.warn({ staticDir }, "Web build not found; serving the API only. Run `pnpm build` first.");
}

export default app;

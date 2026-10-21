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
// Browser API calls are same-origin through the shared artifact proxy.
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

export default app;

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import yahooRouter from "./yahoo";
import draftDataRouter from "./draft-data";
import lineupScreenshotRouter from "./lineup-screenshot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(yahooRouter);
router.use(draftDataRouter);
router.use(lineupScreenshotRouter);

export default router;

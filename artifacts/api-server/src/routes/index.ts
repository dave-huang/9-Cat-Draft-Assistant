import { Router, type IRouter } from "express";
import healthRouter from "./health";
import yahooRouter from "./yahoo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(yahooRouter);

export default router;

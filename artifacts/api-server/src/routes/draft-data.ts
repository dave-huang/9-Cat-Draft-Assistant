import { Router, type IRouter } from 'express';
import { createDraftDataService } from '../lib/draft-data';

const router: IRouter = Router();
const service = createDraftDataService();
for (const name of ['projections', 'injuries'] as const) {
  router.get(`/draft-data/${name}`, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await service[name]()); }
    catch {
      // Fixed diagnostics: never reflect third-party response bodies or URLs.
      req.log?.warn({ feed: name }, 'NBA public data feed unavailable');
      res.status(503).json({ code: `nba_${name}_unavailable`, error: `The current NBA ${name} feed is unavailable, stale, or incomplete. Your saved players and picks have not been changed. Try again shortly.` });
    }
  });
}
export default router;

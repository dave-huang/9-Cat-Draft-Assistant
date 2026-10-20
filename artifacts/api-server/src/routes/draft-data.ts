import { Router, type IRouter } from 'express';
import { createDraftDataService } from '../lib/draft-data';
import { createYahooEligibilityService } from '../lib/yahoo-eligibility';
import { createScheduleService, scheduleDates } from '../lib/nba-schedule';

const router: IRouter = Router();
const service = createDraftDataService();
const schedule = createScheduleService();
router.get('/draft-data/schedule', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { scheduleDates(req.query.start, req.query.end); }
  catch { res.status(400).json({ code: 'invalid_matchup_dates', error: 'Choose valid matchup dates spanning 1–14 inclusive days in the current NBA season.' }); return; }
  try { res.json(await schedule(String(req.query.start), String(req.query.end))); }
  catch {
    req.log?.warn({ feed: 'schedule' }, 'Complete NBA schedule unavailable');
    res.status(503).json({ code: 'nba_schedule_unavailable', error: 'The complete NBA schedule could not be verified. No partial game totals were substituted. Your saved rosters are unchanged.' });
  }
});
const feeds = { ...service, eligibility: createYahooEligibilityService() };
for (const name of ['projections', 'injuries', 'eligibility'] as const) {
  router.get(`/draft-data/${name}`, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await feeds[name]()); }
    catch {
      // Fixed diagnostics: never reflect third-party response bodies or URLs.
      req.log?.warn({ feed: name }, 'NBA public data feed unavailable');
      res.status(503).json({ code: `nba_${name}_unavailable`, error: `The current NBA ${name} feed is unavailable, stale, or incomplete. Your saved players and picks have not been changed. Try again shortly.` });
    }
  });
}
export default router;

import { Router, type IRouter } from 'express';
import { ReadLineupScreenshotBody } from '@workspace/api-zod';
import { readScreenshot, ScreenshotError } from '../lib/lineup-screenshot';

const router: IRouter = Router();
// Personal tool: bound paid API usage globally, not only by client-controlled IP.
let active = 0, used = 0, windowStart = Date.now();
router.post('/lineup-screenshot', async (req, res): Promise<void> => {
  res.set('Cache-Control', 'no-store');
  if (req.get('sec-fetch-site') === 'cross-site') {
    res.status(400).json({ code: 'invalid_origin', error: 'Open screenshot import from the app itself.' }); return;
  }
  const parsed = ReadLineupScreenshotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: 'invalid_image', error: 'Upload a PNG, JPEG or WebP screenshot up to 4 MB after resizing.' }); return;
  }
  if (Date.now() - windowStart >= 3_600_000) { used = 0; windowStart = Date.now(); }
  if (active >= 2 || used >= 60) {
    res.set('Retry-After', active >= 2 ? '15' : String(Math.ceil((windowStart + 3_600_000 - Date.now()) / 1000)));
    res.status(429).json({ code: 'screenshot_limit', error: 'Screenshot recognition is busy or its hourly safety limit was reached. Try later; your lineups are unchanged.' }); return;
  }
  active++; used++;
  try { res.json(await readScreenshot(parsed.data)); }
  catch (error) {
    const safe = error instanceof ScreenshotError ? error : new ScreenshotError(503, 'screenshot_unavailable', 'Screenshot recognition is unavailable. Your saved lineups are unchanged.');
    req.log?.warn({ code: safe.code, providerStatus: safe.providerStatus }, 'Screenshot recognition failed');
    res.status(safe.status).json({ code: safe.code, error: safe.message });
  } finally { active--; }
});
export default router;

# Deployment

## Recommendation: one container on Render (or any Docker host)

The app is a single stateless Node process (API + static web build) with **no database required**; all user data
is in the browser. That makes any "run a container / Node service" host suitable. Recommended: **Render web service
from the included `Dockerfile` / `render.yaml`** — git-push deploys, HTTPS and a health check out of the box.

Approximate costs (check the providers' current pricing pages before committing; these are estimates, not quotes):
- Render **Starter** instance: about US$7/month, always on. Recommended for use during a live draft.
- Render **Free** instance: US$0 but it sleeps after ~15 min idle and takes ~a minute to wake. Fine for testing, bad mid-draft.
- Equivalent alternative: Fly.io / Railway with the same Dockerfile, typically a few dollars per month.
- Gemini API (your own key, pay-as-you-go): Flash-Lite image reads are very cheap (cents per many reads); the app
  caps itself at 60 reads/hour and 2 concurrent. Set a budget/quota in Google AI Studio / Cloud as a backstop.
- Custom domain is optional (~US$10–15/year). **Recommended**: your saved data is tied to the site's origin, so a
  domain you own means you never have to migrate again if you change hosts.

Nothing has been created or paid for yet. Creating the service requires your approval and your Render account.

## Steps (Render)
1. Render dashboard → New → Blueprint → connect `dave-huang/9-cat-draft-assistant` → it reads `render.yaml`.
2. Enter `GEMINI_API_KEY` when prompted (stored in Render, never in git). `render.yaml` selects the Free plan; change `plan: free` to `starter` for always-on.
3. Wait for the first deploy; open the `*.onrender.com` URL; `/api/healthz` should return `{"status":"ok"}`.
4. (Optional) Settings → Custom Domains; add the DNS record Render shows.

Other hosts: build the image (`docker build -t nine-cat .`) and run it with `-p 8080:8080 -e GEMINI_API_KEY=...`.
No Docker? Any Node ≥ 22 host: `pnpm install --frozen-lockfile && pnpm build`, then `pnpm start`; set `PORT` if required.

## Updating
Push to the default branch → Render rebuilds and redeploys automatically (`autoDeploy: true`). CI
(`.github/workflows/ci.yml`) runs typecheck, all tests and the build on every push/PR. To rotate the Gemini key,
change the env var in the host dashboard and redeploy. Data feeds are public ESPN/Yahoo endpoints that can change
without notice; if a feed breaks, the app shows an error and keeps saved data (fix in `artifacts/api-server/src/lib/`).

## Moving your saved session from the old Replit site
Draft, roster, weekly, and trade data are stored in your browser **per site address** (localStorage key
`nine-cat-draft-v1`), so the new URL starts empty. Use the built-in backup — format unchanged:
1. **While the old Replit site is still reachable**, open it → **Settings → Export session JSON** (`draft-session.json`).
   Do this *before* stopping/deleting the Replit deployment or letting it lapse.
2. Open the new site → **Settings → Restore from backup JSON** → choose the file → **Confirm restore**.
3. Check Live draft / Weekly / Trades show your roster. Keep the JSON file as a backup.
Use the same browser or another; the JSON file is portable. Repeat export regularly — clearing site data erases the
browser copy, and there is no server-side copy.
If the Replit site is already gone, the data remains only in the browser profile where you used it and cannot be read
from the new site; it can't be recovered from the repository.

## Security notes
- `GEMINI_API_KEY` is read only by the server (`artifacts/api-server/src/lib/lineup-screenshot.ts`); never prefix it
  for the browser and never commit `.env`. Backups contain no credentials.
- The API has no user accounts. Anyone with the URL can use the screenshot endpoint (rate-limited to 60/hour,
  2 concurrent, process-wide). If you want it private, put the site behind your host's access control (e.g. basic auth
  / Cloudflare Access) or keep the URL unshared.

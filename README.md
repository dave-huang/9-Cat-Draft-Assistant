# 9-Cat Draft Assistant

Personal companion for Yahoo head-to-head **nine-category** fantasy basketball: live draft tracking with balanced
(no-punt) recommendations, weekly matchup lineup management/optimization (with a projections-vs-actuals toggle),
bilateral trade suggestions, and screenshot roster import via your own Gemini API key.

All draft/lineup/trade data lives **in your browser** (localStorage, plus JSON backups). The server only supplies
public ESPN/Yahoo data feeds and the Gemini screenshot proxy. No Yahoo sign-in is needed.

## Stack
pnpm workspace · Node ≥ 22 · TypeScript · React 19 + Vite + Tailwind (`artifacts/draft-assistant`) ·
Express 5 API (`artifacts/api-server`, bundled with esbuild) · shared OpenAPI/Zod/client libs (`lib/*`).
In production **one Node process serves both** the API (`/api/*`) and the built web app.

## Run locally
```sh
corepack enable            # provides pnpm (version pinned in package.json)
pnpm install
export GEMINI_API_KEY=...  # optional; only needed for screenshot import (see .env.example)
pnpm dev                   # web http://localhost:5173 (proxies /api), API :8080
```
Nothing reads `.env` automatically; export variables in your shell (`set -a; . ./.env; set +a`) or via your host.

Production-style run (what the host does):
```sh
pnpm build && pnpm start   # http://localhost:8080
```

## Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | For screenshot import | Server-side only; never sent to the browser. Without it, import reports "not configured"; everything else works. |
| `PORT` | No (default 8080) | Port for the server. For `pnpm dev`, the web dev server uses 5173 unless `PORT` is set (don't set it globally for `pnpm dev`). |
| `STATIC_DIR` | No | Override location of the built web files (default: `artifacts/draft-assistant/dist/public`). |
| `LOG_LEVEL` | No | pino level, default `info`. |
| `DATABASE_URL`, `YAHOO_*`, `SESSION_SECRET` | **No** | Only for the legacy Yahoo OAuth connection, which the app does not need. Leave unset. |

## Tests
```sh
pnpm typecheck
pnpm test        # all suites; the Yahoo suite needs DATABASE_URL pointing at a throwaway Postgres
                 # (run `pnpm --filter @workspace/db run push` first). CI does this automatically.
```
Run one suite with e.g. `pnpm --filter @workspace/draft-assistant run test:weekly`
(suite names are listed in `docs/product-notes.md`).

## Deploy
See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): hosting recommendation, costs, steps, updates, and how to move your
saved session from the old Replit site. Maintenance conventions are in [`CLAUDE.md`](CLAUDE.md).

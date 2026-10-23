# CLAUDE.md — 9-Cat Draft Assistant

Personal Yahoo H2H nine-category fantasy basketball tool. Hosted independently of Replit. See `README.md`,
`docs/DEPLOYMENT.md`, and `docs/product-notes.md` (history/decisions; code is the source of truth).

## Layout
- `artifacts/draft-assistant` — React/Vite web app. Logic in `src/lib/*-engine.ts`, state in `src/hooks/use-draft.ts`.
- `artifacts/api-server` — Express 5 API (`src/routes`, `src/lib`), esbuild bundle; also serves the built web app.
- `lib/api-spec/openapi.yaml` → Orval generates `lib/api-zod` and `lib/api-client-react` (`pnpm --filter @workspace/api-spec run codegen`; commit generated output).
- `lib/db` — Drizzle; used only by the legacy, optional Yahoo OAuth sessions. DB is lazy: the server runs without `DATABASE_URL`.

## Commands
`pnpm install` · `pnpm dev` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm start`.
`pnpm test` includes the Yahoo suite, which needs `DATABASE_URL` (throwaway Postgres + `pnpm --filter @workspace/db run push`).
Run typecheck + relevant tests before every commit; CI runs all of it.

## League rules and invariants (do not change without asking)
- No intentional category punts: all nine categories stay positively weighted (attention to weak cats is capped).
- Weekly lineups lock; roster = 12 non-IL players + 2 IL slots; more than two players may be benched.
- FG%/FT% are weighted by makes and attempts (totals of makes ÷ totals of attempts, with expected games), never averaged percentages.
- Yahoo is for position eligibility, ESPN for projections/injuries/ADP. No Yahoo login/API needed; don't restart Yahoo OAuth work.
- Screenshot import uses Gemini (Flash-Lite) with the user's own server-side `GEMINI_API_KEY`; images are never stored.
- Preserve browser-saved data: localStorage key `nine-cat-draft-v1` and the JSON backup format must stay backward compatible
  (add migrations rather than breaking old backups). Never show demo data as real data.

## Conventions
- Match surrounding code style; keep changes small and focused. No new features/refactors unless requested.
- Never commit secrets or `.env`; never expose server env vars to the browser (no `VITE_` secrets).
- The build artifact is one Node process: `/api/*` is the API, everything else is the SPA. Keep it same-origin.
- Live feeds (ESPN/Yahoo public endpoints) can change; parsing tests use fixtures, so a green test run does not prove feeds work — smoke test after deploy.
- Deployment: push to default branch → host auto-deploys (see `docs/DEPLOYMENT.md`). Ask before creating paid resources.

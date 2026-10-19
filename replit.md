# 9-Cat Draft Assistant

A personal live-draft companion for Yahoo Fantasy Basketball head-to-head nine-category leagues.

## Run & Operate

- API managed workflow: `artifacts/api-server: API Server` (uses its injected `PORT`)
- Frontend managed workflow: `artifacts/draft-assistant: web`
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Manual drafting stays browser-local and requires no Yahoo credentials. Current public ESPN projection/injury feeds use the API server. Legacy Yahoo OAuth remains on the server but is no longer exposed as a setup step.
- `pnpm --filter @workspace/api-server run test:yahoo` — synthetic-provider security, state, encryption and HTTP flow tests; no real Yahoo calls
- `pnpm --filter @workspace/api-server run test:draft-data` — current-season forecast parsing, zero-three centers, shooting validation, report freshness and request caching
- `pnpm --filter @workspace/draft-assistant run test:draft` — nine-category scoring, manual pick correction, eligibility overrides, refresh-safe identities and draft persistence

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/draft-assistant/src/lib/draft-types.ts` — domain contracts
- `artifacts/draft-assistant/src/lib/draft-engine.ts` — nine-category ranking and roster matching
- `artifacts/draft-assistant/src/lib/projections.ts` — CSV and draft backup validation
- `artifacts/draft-assistant/src/hooks/use-draft.ts` — shared browser state and persistence
- `artifacts/draft-assistant/src/pages/` — live draft, roster, and settings

## Architecture decisions

- Keep all nine categories positively weighted; increase attention to weak categories only within a cap. **Why:** the user explicitly does not want a punt strategy.
- Use a client-side shared store and downloadable JSON backups for the personal manual draft assistant. **Why:** it should be usable during a draft without accounts, network latency, or a successful Yahoo connection. Browser storage is device/origin-specific, not cloud sync.
- Clearly separate illustrative demo data from supplied season forecasts. **Why:** made-up or stale projections can cause irreversible bad draft picks. Importing a CSV validates its structure, not its forecasting accuracy.
- Use stable draftable-pool baselines rather than renormalizing after each player is taken. **Why:** changing baselines would make roster category strength shift even when the user's roster has not changed.
- Prioritize manual Mine/Taken tracking independently of snake order. **Why:** the user explicitly abandoned Yahoo API connection attempts and wants an easy second-screen companion during the Yahoo live draft. Do not restart Yahoo integration work unless asked.
- Preserve existing draft picks when current data is refreshed, with explicit provenance and separate injury-report times. **Why:** a feed update during a live draft must not erase selections or misrepresent retrieval time as a newly published forecast.
- Keep any legacy Yahoo credentials/tokens secure and out of draft backups; do not delete them as part of a manual-mode UI change. **Why:** abandoning setup is not consent to delete an existing connection.

## Product

Manual Mine/Taken tracking (with optional legacy snake mode), roster-aware nine-category recommendations, positional filters, shortlist, undo and correction of prior picks, league settings, current ESPN season projections, separately refreshed injury reports, CSV projection imports, and browser persistence with JSON backup/restore. This app neither submits Yahoo picks nor promises calibrated win odds or mathematically optimal picks. Yahoo syncing is out of the current product scope.

## User preferences

The user plays a standard Head-to-Head 9 Category Yahoo Fantasy Basketball league and does not want to punt any categories.
The user's currently requested draft season is 2026–27, explicitly confirmed by the user. Reconfirm for later drafts rather than assuming this remains current.

## Gotchas

- Never represent demo player stats, teams, eligibility, ADP, or availability as verified current-season data.
- Projection CSV numbers are per-game averages; include projected games and makes/attempts for both shooting percentages.
- Changing draft order or replacing a CSV pool after drafting requires an explicit reset; export a backup first. Current-feed refreshes preserve picks and player identities.
- ESPN eligibility and ADP are not Yahoo eligibility and ADP. Position buttons on the board accept manual corrections from the user's Yahoo draft; these survive feed refreshes.
- Public projection retrieval time is not a forecast publication date. The current ESPN feed does not supply the latter. Show that limitation rather than inventing a date.
- Injury reports are checked separately every five minutes while the board/settings screen is visible. Absence from the report is unknown, not medical clearance.
- Moving from preview to the published URL changes the browser storage origin. Export the existing draft backup and restore it on the published site before drafting there.
- Yahoo setup needs a published HTTPS callback ending in `/api/yahoo/callback`, a Yahoo Web Application with private Fantasy Sports Read (`fspt-r`), `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI`, and a strong `SESSION_SECRET`. Configure credentials through Secrets, not source files. Start authorization from the published app in its own browser tab, not an embedded preview.
- Legacy Yahoo OAuth/NBA reads remain implemented but Fantasy access was refused after successful sign-in. Do not claim automatic pick sync or resume troubleshooting as a prerequisite for manual use.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

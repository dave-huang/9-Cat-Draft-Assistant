# 9-Cat Draft Assistant

A personal live-draft companion for Yahoo Fantasy Basketball head-to-head nine-category leagues.

## Run & Operate

- API managed workflow: `artifacts/api-server: API Server` (uses its injected `PORT`)
- Frontend managed workflow: `artifacts/draft-assistant: web`
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Manual drafting stays browser-local and requires no Yahoo credentials. The optional Yahoo connection uses the API server and PostgreSQL.
- `pnpm --filter @workspace/api-server run test:yahoo` — synthetic-provider security, state, encryption and HTTP flow tests; no real Yahoo calls

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
- Use direct, app-owned Yahoo OAuth rather than the managed connector. Keep tokens encrypted on the server and browser-bound, separate from draft backups. **Why:** the user selected direct authorization after repeated connector setup failures; the manual draft must remain independent.

## Product

Manual snake-draft tracking, roster-aware nine-category recommendations, positional filters, shortlist, pick undo, editable league settings, CSV projection imports, and browser persistence with JSON backup/restore. This app neither auto-submits Yahoo picks nor promises calibrated season win odds. Yahoo synchronization requires a successful connection and verification of live draft-result freshness.

## User preferences

The user plays a standard Head-to-Head 9 Category Yahoo Fantasy Basketball league and does not want to punt any categories.
The user's currently requested draft season is 2026–27, explicitly confirmed by the user. Reconfirm for later drafts rather than assuming this remains current.

## Gotchas

- Never represent demo player stats, teams, eligibility, ADP, or availability as verified current-season data.
- Projection CSV numbers are per-game averages; include projected games and makes/attempts for both shooting percentages.
- Changing draft order or replacing projections after drafting requires an explicit reset; export a backup first.
- Moving from preview to the published URL changes the browser storage origin. Export the existing draft backup and restore it on the published site before drafting there.
- Yahoo setup needs a published HTTPS callback ending in `/api/yahoo/callback`, a Yahoo Web Application with private Fantasy Sports Read (`fspt-r`), `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI`, and a strong `SESSION_SECRET`. Configure credentials through Secrets, not source files. Start authorization from the published app in its own browser tab, not an embedded preview.
- Yahoo connection status and NBA reads are implemented, but real-account access is not verified until credentials and a public callback are configured. Do not claim automatic pick sync: it is not implemented and live draft-result freshness remains unverified.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

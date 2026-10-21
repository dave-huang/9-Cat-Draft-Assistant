# 9-Cat Draft Assistant

A personal draft and weekly-lineup companion for Yahoo Fantasy Basketball head-to-head nine-category leagues.

## Run & Operate

- API managed workflow: `artifacts/api-server: API Server` (uses its injected `PORT`)
- Frontend managed workflow: `artifacts/draft-assistant: web`
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Manual drafting stays browser-local and requires no Yahoo credentials. The API server supplies public ESPN projections/injuries and standard Yahoo eligibility from public Draft Analysis data. Legacy OAuth is not a setup step.
- `pnpm --filter @workspace/api-server run test:yahoo` — synthetic-provider security, state, encryption and HTTP flow tests; no real Yahoo calls
- `pnpm --filter @workspace/api-server run test:draft-data` — current-season forecast parsing, zero-three centers, shooting validation, report freshness and request caching
- `pnpm --filter @workspace/api-server run test:eligibility` — anonymous public Yahoo discovery, actual eligibility, season/format checks, complete pagination, caching and denied-access failures
- `pnpm --filter @workspace/draft-assistant run test:draft` — nine-category scoring, manual pick correction, eligibility overrides, refresh-safe identities and draft persistence
- `pnpm --filter @workspace/draft-assistant run test:weekly` — weekly game-weighted totals, shooting ratios, availability, exhaustive lineup selection and weekly backups
- `pnpm --filter @workspace/api-server run test:schedule` — inclusive date windows, Eastern game dates, season/status validation, complete schedule retrieval and cache behavior

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
- `artifacts/draft-assistant/src/lib/weekly-engine.ts` — weekly projections and exhaustive legal-lineup optimization under an explicitly simplified model
- `artifacts/draft-assistant/src/lib/projections.ts` — CSV and draft backup validation
- `artifacts/draft-assistant/src/hooks/use-draft.ts` — shared browser state and persistence
- `artifacts/draft-assistant/src/pages/` — live draft, roster, weekly matchup and settings

## Architecture decisions

- Keep all nine categories positively weighted; increase attention to weak categories only within a cap. **Why:** the user explicitly does not want a punt strategy.
- Use a client-side shared store and downloadable JSON backups for the personal manual draft assistant. **Why:** it should be usable during a draft without accounts, network latency, or a successful Yahoo connection. Browser storage is device/origin-specific, not cloud sync.
- Clearly separate illustrative demo data from supplied season forecasts. **Why:** made-up or stale projections can cause irreversible bad draft picks. Importing a CSV validates its structure, not its forecasting accuracy.
- Use stable draftable-pool baselines rather than renormalizing after each player is taken. **Why:** changing baselines would make roster category strength shift even when the user's roster has not changed.
- Prioritize manual Mine/Taken tracking independently of snake order. **Why:** the user explicitly abandoned Yahoo API connection attempts and wants an easy second-screen companion during the Yahoo live draft. Do not restart Yahoo integration work unless asked.
- Preserve existing draft picks when current data is refreshed, with explicit provenance and separate injury-report times. **Why:** a feed update during a live draft must not erase selections or misrepresent retrieval time as a newly published forecast.
- Use Yahoo for position eligibility and ESPN for projections, injuries and ADP. Manual position corrections take priority. **Why:** the user explicitly chose Yahoo eligibility after the public, no-sign-in route was verified; ESPN eligibility differs from the Yahoo draft.
- Keep any legacy Yahoo credentials/tokens secure and out of draft backups; do not delete them as part of a manual-mode UI change. **Why:** abandoning setup is not consent to delete an existing connection.
- Weekly starters lock for the entire matchup; each category win counts separately in the standings. **Why:** the user confirmed both league rules. Optimize the sum of nine equally valued expected category points, not the chance of at least five wins.
- Keep the current weekly roster separate from draft history after initially seeding from Mine picks. **Why:** the draft is over and the user now needs week-to-week management, including roster changes; editing the weekly team must not rewrite draft picks.
- Keep manually selected weekly slots separate from the optimizer's recommendation. **Why:** the user wants to tweak both lineups, see projections for those exact starters, and explicitly apply the optimal own lineup with a button; recommendations must not silently overwrite edits.

## Product

Manual Mine/Taken tracking (with optional legacy snake mode), roster-aware nine-category recommendations, positional filters, shortlist, undo and correction of prior picks, league settings, current ESPN season projections, separately refreshed injury reports, CSV projection imports, and browser persistence with JSON backup/restore. This app neither submits Yahoo picks nor promises calibrated win odds or mathematically optimal picks. Yahoo syncing is out of the current product scope.

The Weekly page supports explicit positional slots for both teams, including two BN and two separate IL slots, matchup dates, injury-aware expected-game overrides and recommended weekly starters. Moves to occupied slots are atomic swaps only if both players fit; IL requires manual confirmation of actual Yahoo IL eligibility, not an ESPN Out label. Existing manually selected IL placements migrate as prior user confirmations. Slot maps and confirmations are backed up; incompatible legacy players remain visible for repair rather than being discarded. Counting stats are per-game projections multiplied by expected active games. FG% and FT% are total projected makes divided by total projected attempts; neither player percentages nor season GP are averaged into weekly totals. Only the exact currently selected active players score. Schedules use Eastern game dates; postponed/canceled and non-regular-season games are excluded. Matchup dates are user-specified (1–14 inclusive days) to accommodate shortened/extended Yahoo weeks.

Weekly optimization exhaustively searches legal subsets, allowing vacancies only if every remaining regular player fits the available bench slots, using independent Poisson counting and conditional-binomial shooting normal approximations. Zero-game players still require roster slots; IL placements remain fixed during optimization. Current lineup totals are separate from recommended totals; Apply optimal lineup changes only the own active/bench slots and preserves opponent slots, IL and game overrides. It is optimal only under that simplified stated objective/model, not calibrated real-world odds. Out/injured players conservatively default to zero games; questionable/day-to-day default to the schedule with a warning. The user can override availability; no injury label or return date is medical clearance. Weekly state is included in existing browser persistence and JSON backups. Failed or partial schedule windows must never be presented as valid zero-game forecasts. The tool does not submit lineups or change already-locked Yahoo starters.

## User preferences

The user plays a standard Head-to-Head 9 Category Yahoo Fantasy Basketball league and does not want to punt any categories.
The user's currently requested draft season is 2026–27, explicitly confirmed by the user. Reconfirm for later drafts rather than assuming this remains current.

## Gotchas

- Never represent demo player stats, teams, eligibility, ADP, or availability as verified current-season data.
- Projection CSV numbers are per-game averages; include projected games and makes/attempts for both shooting percentages.
- Changing draft order or replacing a CSV pool after drafting requires an explicit reset; export a backup first. Current-feed refreshes preserve picks and player identities.
- Yahoo eligibility is layered independently over ESPN stats and applied by unique normalized player identity. Source labels distinguish Yahoo, manual corrections and unverified fallbacks. Corrections on the board and roster survive refreshes and resets.
- Use only actual `eligible_positions`, never `eligible_positions_to_add`. Generic G/F/Util roster slots must not be expanded into new PG/SG/SF/PF/C eligibility. Validate the current season, complete pagination and standard position format.
- If new eligibility would invalidate the already-drafted roster, preserve picks and previous positions and visibly flag the affected players; do not silently drop or unassign them.
- Public Yahoo data needs no user sign-in, but is not a guaranteed stable API. On failure keep saved positions, show an error, and never relabel ESPN fallbacks as Yahoo-verified. Standard eligibility may differ from commissioner-specific league overrides.
- Public projection retrieval time is not a forecast publication date. The current ESPN feed does not supply the latter. Show that limitation rather than inventing a date.
- Injury reports are checked separately every five minutes while the board/settings screen is visible. Absence from the report is unknown, not medical clearance.
- Moving from preview to the published URL changes the browser storage origin. Export the existing draft backup and restore it on the published site before drafting there.
- Yahoo setup needs a published HTTPS callback ending in `/api/yahoo/callback`, a Yahoo Web Application with private Fantasy Sports Read (`fspt-r`), `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI`, and a strong `SESSION_SECRET`. Configure credentials through Secrets, not source files. Start authorization from the published app in its own browser tab, not an embedded preview.
- Legacy Yahoo OAuth/NBA reads remain implemented but Fantasy access was refused after successful sign-in. Do not claim automatic pick sync or resume troubleshooting as a prerequisite for manual use.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

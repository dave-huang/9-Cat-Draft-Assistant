import type { LineupScreenshotReading } from '@workspace/api-client-react';
import type { Player, WeeklyPlannerState } from './draft-types';
import { normalizePlayerName } from './eligibility';
import { lineupErrors, syncWeeklyLineups, type WeeklySlot } from './weekly-lineup';

export interface LineupImportRow {
  name: string;
  team: string;
  uncertain: boolean;
  playerId: string;
  slotId: string;
  skip: boolean;
}

/** Only unique full-name matches are automatic. Initials and fuzzy OCR require review. */
export function screenshotReviewRows(reading: LineupScreenshotReading, players: Player[], slots: WeeklySlot[]): LineupImportRow[] {
  const counts: Record<string, number> = {};
  return reading.rows.map(row => {
    const matches = players.filter(p => normalizePlayerName(p.name) === normalizePlayerName(row.name));
    const n = counts[row.slot] = (counts[row.slot] ?? 0) + 1;
    const slotId = `${row.slot}-${n}`;
    return { ...row, playerId: matches.length === 1 ? matches[0]!.id : '',
      slotId: slots.some(s => s.id === slotId) ? slotId : '', skip: false };
  });
}

/** Revalidate against CURRENT state at confirmation, then replace only the opponent atomically. */
export function importOpponentLineup(
  planner: WeeklyPlannerState, rows: LineupImportRow[], players: Player[], slots: WeeklySlot[], ilConfirmed: boolean,
): WeeklyPlannerState {
  const selected = rows.filter(r => !r.skip);
  if (!selected.length) throw new Error('Select at least one player to import.');
  const byId = new Map(players.map(p => [p.id, p]));
  const lineup: Record<string, string> = {};
  const roster: string[] = [], reserves: string[] = [];
  for (const row of selected) {
    const p = byId.get(row.playerId);
    if (!p) throw new Error(`Match "${row.name}" to a player, or skip that row.`);
    const slot = slots.find(s => s.id === row.slotId);
    if (!slot) throw new Error(`Choose a roster slot for ${p.name}.`);
    if (planner.myRosterIds.includes(p.id)) throw new Error(`${p.name} is already on your team. Resolve this before importing.`);
    if (roster.includes(p.id)) throw new Error(`${p.name} is listed more than once. Skip or correct the duplicate.`);
    if (lineup[slot.id]) throw new Error(`${slot.label} has two players. Choose a different slot.`);
    if (slot.kind === 'il') reserves.push(p.id);
    lineup[slot.id] = p.id;
    roster.push(p.id);
  }
  if (reserves.length && !ilConfirmed) throw new Error('Confirm that the imported IL players really occupy Yahoo IL slots.');
  const ilEligibleIds = [...new Set([
    ...(planner.ilEligibleIds ?? []).filter(id => planner.myRosterIds.includes(id) || roster.includes(id)),
    ...reserves,
  ])];
  const errors = lineupErrors(lineup, roster.map(id => byId.get(id)!), slots, ilEligibleIds);
  if (errors.length) throw new Error(errors[0]);
  // Keep overrides for retained players; remove only departed opponent overrides.
  const removed = new Set(planner.opponentRosterIds.filter(id => !roster.includes(id)));
  const expectedGames = Object.fromEntries(Object.entries(planner.expectedGames).filter(([id]) => !removed.has(id)));
  return syncWeeklyLineups({ ...planner, opponentRosterIds: roster, ilEligibleIds, expectedGames },
    planner.myLineup ?? {}, lineup, slots);
}

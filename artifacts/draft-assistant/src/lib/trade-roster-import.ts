import type { LineupScreenshotRow } from '@workspace/api-client-react';
import type { DraftState, Player, TradeWorkspace } from './draft-types';
import { screenshotReviewRows, type LineupImportRow } from './lineup-import';
import type { WeeklySlot } from './weekly-lineup';

// Trades value the full roster, not a particular week's starting positions.
export const tradeImportSlots: WeeklySlot[] = [
  { id: 'regular', label: 'Regular (active / bench)', slot: 'BN', kind: 'bench' },
  { id: 'il', label: 'IL', slot: 'IL', kind: 'il' },
];

export function tradeScreenshotReviewRows(rows: LineupScreenshotRow[], players: Player[]): LineupImportRow[] {
  return screenshotReviewRows({ rows, warnings: [] }, players, []).map((row, i) => ({
    ...row,
    slotId: rows[i]!.slot === 'IL' ? 'il' : rows[i]!.slot === 'UNKNOWN' ? '' : 'regular',
  }));
}

/** Validate against the latest complete state; return only a new trade workspace. */
export function importTradePartnerRoster(
  state: DraftState, partnerId: string, rows: LineupImportRow[], ilConfirmed: boolean,
): TradeWorkspace {
  const workspace = state.trades;
  if (!workspace?.partners.some(p => p.id === partnerId)) throw new Error('This trade partner no longer exists. Close import and select a saved team.');
  const selected = rows.filter(r => !r.skip);
  if (!selected.length) throw new Error('Select at least one player to import.');
  const byId = new Map(state.players.map(p => [p.id, p]));
  const own = new Set(state.matchup?.myRosterIds ?? state.picks.filter(p => p.team === state.settings.myPosition).map(p => p.playerId));
  const otherOwners = new Map(workspace.partners.filter(p => p.id !== partnerId).flatMap(p => p.rosterIds.map(id => [id, p.name] as const)));
  const rosterIds: string[] = [], reserveIds: string[] = [];
  for (const row of selected) {
    const player = byId.get(row.playerId);
    if (!player) throw new Error(`Match "${row.name}" to a player, or skip that row.`);
    if (rosterIds.includes(player.id)) throw new Error(`${player.name} is listed more than once. Skip or correct the duplicate.`);
    if (own.has(player.id)) throw new Error(`${player.name} is already on your team. Correct or skip that row.`);
    if (otherOwners.has(player.id)) throw new Error(`${player.name} is already on ${otherOwners.get(player.id)}. Correct that saved roster or skip this row.`);
    if (!tradeImportSlots.some(s => s.id === row.slotId)) throw new Error(`Choose Regular or IL for ${player.name}.`);
    rosterIds.push(player.id);
    if (row.slotId === 'il') reserveIds.push(player.id);
  }
  if (reserveIds.length > state.settings.injuryReserveSlots) throw new Error(`This roster exceeds the ${state.settings.injuryReserveSlots}-player IL limit.`);
  if (rosterIds.length - reserveIds.length > state.settings.rosterSlots.length) throw new Error(`This roster exceeds the ${state.settings.rosterSlots.length}-player non-IL limit. Bench players count toward this limit.`);
  if (reserveIds.length && !ilConfirmed) throw new Error('Confirm that the imported IL players really occupy Yahoo IL slots.');
  return {
    ...workspace,
    partners: workspace.partners.map(p => p.id === partnerId ? { ...p, rosterIds, reserveIds } : p),
  };
}

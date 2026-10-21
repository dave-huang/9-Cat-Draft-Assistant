import type { Player } from './draft-types';
import { moveWeeklyPlayer, type WeeklyLineup, type WeeklySide, type WeeklySlot } from './weekly-lineup';

export interface WeeklyMoveSource {
  side: WeeklySide;
  id: string;
}

export interface WeeklyMoveTarget {
  state: 'idle' | 'source' | 'allowed' | 'blocked';
  reason?: string;
}

/** Dragging and click-to-move must use exactly the same rules as the editor.
 * Previewing a destination never mutates the saved lineup. */
export function weeklyMoveTarget(
  source: WeeklyMoveSource | null,
  side: WeeklySide,
  slotId: string,
  lineup: WeeklyLineup,
  roster: Player[],
  slots: WeeklySlot[],
  ilEligible: readonly string[],
): WeeklyMoveTarget {
  if (!source) return { state: 'idle' };
  if (source.side !== side) return { state: 'blocked', reason: 'Players can only move within their own team.' };
  try {
    moveWeeklyPlayer(lineup, roster, slots, ilEligible, source.id, slotId);
    return lineup[slotId] === source.id
      ? { state: 'source', reason: 'This is the player’s current slot.' }
      : { state: 'allowed' };
  } catch (e) {
    return { state: 'blocked', reason: e instanceof Error ? e.message : String(e) };
  }
}

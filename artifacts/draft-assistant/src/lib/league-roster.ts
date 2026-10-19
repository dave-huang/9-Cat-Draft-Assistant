import { assignRoster } from './draft-engine';
import type { DraftState, RosterSlot } from './draft-types';

export const LEAGUE_ROSTER_SLOTS: RosterSlot[] = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL', 'UTIL', 'BN', 'BN'];
export const LEAGUE_IL_SLOTS = 2;
const PREVIOUS_DEFAULT = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'C', 'UTIL', 'UTIL', 'BN', 'BN', 'BN'];

export function isPreviousDefaultRoster(slots: RosterSlot[]) {
  return slots.join(',') === PREVIOUS_DEFAULT.join(',');
}

/** Upgrade the old app default without dropping picks or changing a live snake order. */
export function migrateLeagueRoster(state: DraftState): DraftState {
  if (!isPreviousDefaultRoster(state.settings.rosterSlots)) return state;
  if (state.settings.trackingMode === 'snake' && state.picks.length) return state;
  const mine = state.picks.filter(p => p.team === state.settings.myPosition)
    .map(p => state.players.find(player => player.id === p.playerId)!);
  if (mine.length > LEAGUE_ROSTER_SLOTS.length || assignRoster(mine, LEAGUE_ROSTER_SLOTS).fitted !== mine.length) return state;
  return { ...state, settings: { ...state.settings, rosterSlots: [...LEAGUE_ROSTER_SLOTS], injuryReserveSlots: LEAGUE_IL_SLOTS } };
}

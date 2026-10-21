import type { SeasonActualsFeed } from '@workspace/api-client-react';
import type { Player } from './draft-types';
import { normalizePlayerName } from './eligibility';

export type StatsBasis = 'projections' | 'actuals';
const statKeys = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'threes', 'turnovers', 'fgm', 'fga', 'ftm', 'fta'] as const;

/** Overlay only rates on stable base players. Never change identity, eligibility,
 * injuries, projected season GP, draft data, roster assignments or game overrides.
 */
export function playersForWeeklyBasis(players: Player[], basis: StatsBasis, season: string, feed?: SeasonActualsFeed): Player[] {
  const available = feed?.season === season ? feed : undefined;
  const byId = new Map(available?.players.map(p => [p.id, p]) ?? []);
  const byName = new Map<string, NonNullable<typeof available>['players']>();
  for (const p of available?.players ?? []) {
    const key = normalizePlayerName(p.name);
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  const baseNameCounts = new Map<string, number>();
  for (const p of players) {
    const key = normalizePlayerName(p.name);
    baseNameCounts.set(key, (baseNameCounts.get(key) ?? 0) + 1);
  }
  return players.map(p => {
    if (basis === 'projections') return { ...p, weeklyStats: { basis } };
    const name = normalizePlayerName(p.name), matches = byName.get(name) ?? [];
    // ESPN IDs take priority; imported IDs may use an unambiguous exact normalized name.
    const actual = byId.get(p.id) ?? (matches.length === 1 && baseNameCounts.get(name) === 1 ? matches[0] : undefined);
    if (!actual) return { ...p, weeklyStats: { basis: 'projections',
      fallbackReason: !feed ? 'Actual statistics are not loaded.' : !available ? 'Actual statistics are for a different season.' :
        'No usable current-season games/stats reported; using the saved projection, not zero.' } };
    const rates = Object.fromEntries(statKeys.map(key => [key, actual[key]]));
    return { ...p, ...rates, weeklyStats: { basis: 'actuals', gamesPlayed: actual.gamesPlayed } };
  });
}

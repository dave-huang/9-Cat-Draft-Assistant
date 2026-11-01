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

/** Players with real current-season games but no projection in the saved pool.
 * Requires explicit team and positions from the feed; nothing is guessed. Not added to the saved
 * pool until a weekly/trade roster actually uses them, and never used by the draft board.
 */
export function actualsOnlyCandidates(players: Player[], season: string, feed?: SeasonActualsFeed): Player[] {
  if (!feed || feed.season !== season) return [];
  const ids = new Set(players.map(p => p.id));
  const names = new Set(players.map(p => normalizePlayerName(p.name)));
  return feed.players.flatMap(a => {
    if (!a.team || !a.positions?.length || ids.has(a.id) || names.has(normalizePlayerName(a.name))) return [];
    const rates = Object.fromEntries(statKeys.map(key => [key, a[key]])) as Pick<Player, typeof statKeys[number]>;
    return [{
      id: a.id, name: a.name, team: a.team, positions: [...a.positions], games: Math.min(82, a.gamesPlayed), ...rates,
      positionsSource: 'ESPN' as const, projectionUnavailable: true, actualsOnly: true,
      note: `No ESPN projection. Season-to-date averages from ${a.gamesPlayed} games when added.`,
    }];
  });
}

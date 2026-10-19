import type { DraftEligibilityFeed, DraftEligibilityPlayer } from '@workspace/api-client-react';
import type { DraftState, Player } from './draft-types';
import { assignRoster } from './draft-engine';

export const normalizePlayerName = (name: string) => name.normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z0-9]/g, '');

export function positionSourceLabel(p: Player, demo = false) {
  if (p.positionsVerified || p.positionsSource === 'Manual') return 'Manual';
  if (p.positionsConflict) return 'Check Yahoo';
  if (p.yahooEligibilityMissing && p.positionsSource === 'Yahoo') return 'Yahoo · saved';
  if (p.positionsSource === 'Yahoo') return 'Yahoo';
  if (demo) return 'Demo';
  return p.positionsSource === 'Imported' ? 'Imported · unverified' : 'ESPN · unverified';
}

/** Name matches must be unique; never fuzzy-match similar players.
 * Preserve every pick and manual correction, including when a new Yahoo
 * position would make an existing draft impossible to slot.
 */
export function withYahooEligibility(state: DraftState, feed: DraftEligibilityFeed, checkedAt: string): DraftState {
  if (state.source.isDemo) throw new Error('Load real season projections before Yahoo eligibility.');
  if (state.source.season.replace(/[–—]/g, '-') !== feed.season) throw new Error(`Yahoo eligibility is for ${feed.season}; it was not applied to a different or unspecified projection season.`);
  if (feed.players.length < 150 || !Number.isFinite(Date.parse(feed.fetchedAt))) throw new Error('Yahoo eligibility coverage is incomplete.');
  const byName = new Map<string, DraftEligibilityPlayer[]>(), byId = new Map<string, DraftEligibilityPlayer>();
  for (const record of feed.players) {
    if (byId.has(record.yahooId)) throw new Error('Yahoo eligibility has duplicate player identities.');
    byId.set(record.yahooId, record);
    const key = normalizePlayerName(record.name);
    byName.set(key, [...(byName.get(key) ?? []), record]);
  }
  let matchedPlayers = 0;
  let players = state.players.map(p => {
    const candidates = byName.get(normalizePlayerName(p.name));
    const record = (p.yahooId ? byId.get(p.yahooId) : undefined) ?? (candidates?.length === 1 ? candidates[0] : undefined);
    if (!record) return { ...p, yahooEligibilityMissing: true };
    matchedPlayers++;
    const manual = p.positionsVerified || p.positionsSource === 'Manual';
    return { ...p, yahooId: record.yahooId, yahooPositions: [...record.positions], positionsFetchedAt: feed.fetchedAt,
      yahooEligibilityMissing: false, positionsConflict: false,
      positions: manual ? p.positions : [...record.positions],
      positionsSource: manual ? 'Manual' as const : 'Yahoo' as const };
  });
  if (!matchedPlayers) throw new Error('No projection players could be matched to Yahoo. Existing eligibility was kept.');
  const mineIds = new Set(state.picks.filter(p => p.team === state.settings.myPosition).map(p => p.playerId));
  const mine = players.filter(p => mineIds.has(p.id));
  if (assignRoster(mine, state.settings.rosterSlots).fitted !== mine.length) {
    // Do not hide/unassign an already-drafted player. Preserve prior positions
    // for all Mine players affected by the update and flag them for correction.
    const old = new Map(state.players.map(p => [p.id, p]));
    players = players.map(p => {
      const previous = old.get(p.id)!;
      if (!mineIds.has(p.id) || p.positions.join(',') === previous.positions.join(',')) return p;
      return { ...p, positions: previous.positions, positionsSource: previous.positionsSource ?? 'ESPN', positionsConflict: true };
    });
  }
  return { ...state, players, eligibilityFeed: {
    season: feed.season, source: feed.source, fetchedAt: feed.fetchedAt, checkedAt,
    totalPlayers: feed.players.length, matchedPlayers, unmatchedPlayers: state.players.length - matchedPlayers,
  } };
}

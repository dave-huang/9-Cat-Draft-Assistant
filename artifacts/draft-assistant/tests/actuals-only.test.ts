import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SeasonActualsFeed } from '@workspace/api-client-react';
import { analyzeDraft } from '../src/lib/draft-engine';
import { createInitialState, parseSession, playerSchema } from '../src/lib/projections';
import { actualsOnlyCandidates, playersForWeeklyBasis } from '../src/lib/weekly-stats';
import type { Player } from '../src/lib/draft-types';

const players: Player[] = Array.from({ length: 170 }, (_, i) => ({
  id: `espn-${i + 1}`, name: `Test Player ${i}`, team: 'BOS', positions: ['PG', 'SG', 'SF', 'PF', 'C'],
  games: 70, points: 15 + i % 15, rebounds: 4 + i % 8, assists: 2 + i % 8, steals: 1, blocks: 1, threes: 2,
  turnovers: 2, fgm: 6, fga: 12, ftm: 3, fta: 4,
}));
const source = { label: 'Synthetic forecasts', season: '2026-27', isDemo: false, provider: 'ESPN', fetchedAt: new Date().toISOString() };
const line = { gamesPlayed: 6, points: 9.5, rebounds: 6.5, assists: 1.5, steals: 0.5, blocks: 1.5, threes: 1, turnovers: 0.8, fgm: 3.8, fga: 6.5, ftm: 1.2, fta: 1.6 };
const feed = (extra: SeasonActualsFeed['players'] = []): SeasonActualsFeed => ({
  label: 'ESPN actuals', provider: 'ESPN', season: '2026-27', fetchedAt: '2026-11-02T12:00:00Z', statsThroughDate: null,
  skippedPlayers: 0, totalPlayers: 200,
  players: [
    { id: 'espn-1', name: 'Test Player 0', team: 'BOS', positions: ['PG'], ...line },   // already in the pool
    { id: 'espn-9001', name: 'Jay Huff', team: 'IND', positions: ['C'], ...line },     // actuals only
    { id: 'espn-9002', name: 'No Team Guy', positions: ['C'], ...line },                // no team: unusable
    { id: 'espn-9003', name: 'No Positions Guy', team: 'IND', ...line },               // no positions: unusable
    { id: 'espn-9004', name: 'Test Player 5', team: 'BOS', positions: ['SF'], ...line }, // same name as a pool player, different id
    ...extra,
  ],
});

test('only players with real games, a team and positions, and no pool match become candidates', () => {
  const found = actualsOnlyCandidates(players, '2026-27', feed());
  assert.deepEqual(found.map(p => p.name), ['Jay Huff']);
  const huff = found[0]!;
  assert.equal(huff.id, 'espn-9001'); assert.equal(huff.team, 'IND'); assert.deepEqual(huff.positions, ['C']);
  assert.equal(huff.points, 9.5); assert.equal(huff.fga, 6.5, 'Shooting volumes are real actual makes/attempts per game');
  assert.equal(huff.actualsOnly, true); assert.equal(huff.projectionUnavailable, true);
  assert.equal(huff.adp, undefined);
  assert.doesNotThrow(() => playerSchema.parse(huff));
  assert.deepEqual(actualsOnlyCandidates(players, '2026-27'), [], 'No feed, no candidates');
  assert.deepEqual(actualsOnlyCandidates(players, '2025-26', feed()), [], 'Wrong season, no candidates');
});

test('actuals-only players never enter draft rankings, recommendations or baselines', () => {
  const base = { ...createInitialState(), players, source };
  const huff = { ...actualsOnlyCandidates(players, '2026-27', feed())[0]!, points: 60, rebounds: 30 };   // would dominate any ranking
  const withHuff = { ...base, players: [...players, huff] };
  assert.deepEqual(analyzeDraft(withHuff), analyzeDraft(base));
});

test('a saved actuals-only player follows the weekly basis: projection fallback label, real rates in actuals mode', () => {
  const huff = actualsOnlyCandidates(players, '2026-27', feed())[0]!;
  const stored = { ...huff, points: 8 };    // rates as of when he was added
  const proj = playersForWeeklyBasis([stored], 'projections', '2026-27', feed())[0]!;
  assert.equal(proj.points, 8); assert.equal(proj.weeklyStats?.basis, 'projections');
  const act = playersForWeeklyBasis([stored], 'actuals', '2026-27', feed())[0]!;
  assert.equal(act.points, 9.5); assert.equal(act.weeklyStats?.basis, 'actuals'); assert.equal(act.weeklyStats?.gamesPlayed, 6);
  assert.equal(act.actualsOnly, true);
});

test('store saves an actuals-only player only with the roster that uses him, and refresh/backup keep him', async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) }, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: { addEventListener() {} }, configurable: true });
  const { draftActions: d, getDraftSnapshot: get } = await import('../src/hooks/use-draft');
  d.loadCurrentProjections(players, source);
  const huff = actualsOnlyCandidates(players, '2026-27', feed())[0]!;
  const weekly = { start: '2026-11-02', end: '2026-11-08', myRosterIds: ['espn-2'], myReserveIds: [], opponentRosterIds: [huff.id], opponentStarterIds: [huff.id], expectedGames: {} };

  assert.throws(() => d.updateMatchup(weekly), /missing/i, 'Unknown players still cannot be rostered without being supplied');
  assert.throws(() => d.updateMatchup(weekly, [{ ...huff, actualsOnly: undefined }]), /cannot be added/, 'Only actuals-only players may be added this way');
  assert.throws(() => d.updateMatchup(weekly, [{ ...huff, id: 'espn-9777', name: 'Test Player 3' }]), /cannot be added/, 'No duplicate names');
  assert.equal(get().state.players.length, 170);

  d.updateMatchup(weekly, [huff]);
  assert.equal(get().state.players.length, 171);
  assert.equal(get().state.players.find(p => p.id === huff.id)?.actualsOnly, true);
  assert.equal(get().analysis.draftedIds.has(huff.id), false);
  assert.equal(get().analysis.recommendations.some(r => r.player.id === huff.id), false, 'Not on the draft board');

  const restored = parseSession(d.exportSession());
  assert.equal(restored.players.find(p => p.id === huff.id)?.actualsOnly, true, 'Survives JSON backup and restore');
  assert.deepEqual(restored.matchup?.opponentRosterIds, [huff.id]);

  d.loadCurrentProjections(players, source);
  assert.ok(get().state.players.some(p => p.id === huff.id), 'A rostered player survives a projection refresh');

  d.updateTrades({ partners: [{ id: 'p1', name: 'Other', rosterIds: ['espn-9005'], reserveIds: [] }], lockedPlayerIds: [], packageSize: 'both' },
    [{ ...huff, id: 'espn-9005', name: 'Other Reserve Big' }]);
  assert.ok(get().state.players.some(p => p.id === 'espn-9005'));

  d.updateMatchup({ ...weekly, opponentRosterIds: [], opponentStarterIds: [] });
  d.updateTrades({ partners: [], lockedPlayerIds: [], packageSize: 'both' });
  d.loadCurrentProjections(players, source);
  assert.equal(get().state.players.some(p => p.actualsOnly), false, 'Unrostered actuals-only players are dropped at the next refresh');
  assert.equal(get().state.players.length, 170);
});

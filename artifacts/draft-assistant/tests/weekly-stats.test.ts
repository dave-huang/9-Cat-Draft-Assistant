import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SeasonActualsFeed } from '@workspace/api-client-react';
import type { Player } from '../src/lib/draft-types';
import { playersForWeeklyBasis } from '../src/lib/weekly-stats';
import { createInitialState, matchupSchema, parseSession } from '../src/lib/projections';
import { createMatchup, totalWeeklyStats, type WeeklyPlayer } from '../src/lib/weekly-engine';
import { currentWeeklyAnalysis } from '../src/lib/weekly-lineup';

const player = (id: string, name = id): Player => ({
  id, name, team: 'BOS', positions: ['PG', 'C'], games: 70,
  points: 20, rebounds: 5, assists: 4, steals: 1, blocks: 1, threes: 2, turnovers: 2,
  fgm: 7, fga: 14, ftm: 4, fta: 5, injuryStatus: 'Day-to-day', positionsSource: 'Yahoo',
});
const feed: SeasonActualsFeed = {
  label: 'ESPN actuals', provider: 'ESPN', season: '2026-27', fetchedAt: '2026-10-21T12:00:00Z',
  statsThroughDate: null, skippedPlayers: 1, totalPlayers: 150,
  players: [
    { id: 'espn-1', name: 'First Player', gamesPlayed: 2, points: 30, rebounds: 8, assists: 6, steals: 2, blocks: 2, threes: 3, turnovers: 4, fgm: 10, fga: 20, ftm: 7, fta: 10 },
    { id: 'espn-2', name: 'Second Player', gamesPlayed: 3, points: 12, rebounds: 4, assists: 2, steals: 1, blocks: 0, threes: 0, turnovers: 1, fgm: 4, fga: 5, ftm: 4, fta: 4 },
  ],
};
const row = (p: Player, games: number, reserve = false): WeeklyPlayer => ({
  player: p, scheduledGames: 4, expectedGames: reserve ? 0 : games, override: true, reserve, dates: [],
});

test('actuals overlay rates without changing base projections, identities, injuries, eligibility or season GP', () => {
  const base = [player('espn-1', 'First Player'), player('missing')];
  const original = structuredClone(base);
  const actual = playersForWeeklyBasis(base, 'actuals', '2026-27', feed);
  assert.equal(actual[0]!.points, 30); assert.equal(actual[0]!.weeklyStats?.gamesPlayed, 2);
  for (const key of ['id', 'positions', 'games', 'injuryStatus', 'positionsSource'] as const)
    assert.deepEqual(actual[0]![key], base[0]![key]);
  assert.equal(actual[1]!.points, 20);
  assert.equal(actual[1]!.weeklyStats?.basis, 'projections');
  assert.match(actual[1]!.weeklyStats!.fallbackReason!, /No usable/);
  assert.deepEqual(base, original);
  assert.deepEqual(playersForWeeklyBasis(base, 'projections', '2026-27', feed).map(p => p.points), [20, 20]);
});

test('imported IDs match exact normalized unique names; initials and ambiguous names do not guess', () => {
  const base = [player('imported', 'First Player'), player('short', 'S. Player')];
  assert.equal(playersForWeeklyBasis(base, 'actuals', '2026-27', feed)[0]!.points, 30);
  assert.equal(playersForWeeklyBasis(base, 'actuals', '2026-27', feed)[1]!.weeklyStats?.basis, 'projections');
  const ambiguous = { ...feed, players: [...feed.players, { ...feed.players[0]!, id: 'duplicate' }] };
  assert.equal(playersForWeeklyBasis(base, 'actuals', '2026-27', ambiguous)[0]!.weeklyStats?.basis, 'projections');
  assert.equal(playersForWeeklyBasis(base, 'actuals', '2025-26', feed)[0]!.points, 20);
  assert.equal(playersForWeeklyBasis(base, 'actuals', '2026-27')[0]!.points, 20);
});

test('actuals keep game and attempt weighted math, while bench and IL are excluded on both teams', () => {
  const actual = playersForWeeklyBasis([player('espn-1'), player('espn-2'), player('fallback')], 'actuals', '2026-27', feed);
  const mine = [row(actual[0]!, 2), row(actual[1]!, 4), row(actual[2]!, 4, true)];
  const total = totalWeeklyStats(mine.slice(0, 2));
  assert.equal(total.points, 30 * 2 + 12 * 4);
  assert.equal(total.fg, (10 * 2 + 4 * 4) / (20 * 2 + 5 * 4));
  assert.equal(total.ft, (7 * 2 + 4 * 4) / (10 * 2 + 4 * 4));
  const slots = [{ id: 'UTIL-1', label: 'UTIL', slot: 'UTIL' as const, kind: 'active' as const },
    { id: 'BN-1', label: 'BN', slot: 'BN' as const, kind: 'bench' as const },
    { id: 'IL-1', label: 'IL', slot: 'IL' as const, kind: 'il' as const }];
  const analysis = currentWeeklyAnalysis(mine, [row(actual[1]!, 3), row(actual[0]!, 4)], {
    'UTIL-1': 'espn-1', 'BN-1': 'espn-2', 'IL-1': 'fallback',
  }, { 'UTIL-1': 'espn-2', 'BN-1': 'espn-1' }, slots);
  assert.equal(analysis.myTotals.points, 60);
  assert.equal(analysis.opponentTotals.points, 36);
});

test('projections default and chosen actuals survive backup/reload without roster or override changes', () => {
  const state = createInitialState(), planner = createMatchup(state);
  assert.equal(matchupSchema.parse(planner).statsBasis, 'projections');
  const players = [player('espn-1'), player('espn-2')];
  const matchup = { ...planner, statsBasis: 'actuals' as const, myRosterIds: ['espn-1'], opponentRosterIds: ['espn-2'],
    myLineup: { 'UTIL-1': 'espn-1' }, opponentLineup: { 'BN-1': 'espn-2' }, expectedGames: { 'espn-1': 2 } };
  const restored = parseSession(JSON.stringify({ ...state, players, matchup }));
  assert.equal(restored.matchup?.statsBasis, 'actuals');
  assert.deepEqual(restored.matchup?.myLineup, matchup.myLineup);
  assert.deepEqual(restored.matchup?.opponentLineup, matchup.opponentLineup);
  assert.deepEqual(restored.matchup?.expectedGames, matchup.expectedGames);
  assert.equal(restored.players[0]!.points, 20, 'A backup retains the original projection rates');
});

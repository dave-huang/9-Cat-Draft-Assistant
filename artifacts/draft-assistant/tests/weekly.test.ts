import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NbaSchedule } from '@workspace/api-client-react';
import type { Player, RosterSlot } from '../src/lib/draft-types';
import { compareWeekly, createMatchup, matchupDates, optimizeWeekly, totalWeeklyStats, validMatchupDates, weeklyPlayers, type WeeklyPlayer } from '../src/lib/weekly-engine';
import { assignRoster } from '../src/lib/draft-engine';
import { createInitialState, parseSession } from '../src/lib/projections';

const player = (id: string, overrides: Partial<Player> = {}): Player => ({
  id, name: `Player ${id}`, team: 'BOS', positions: ['PG', 'SG', 'SF', 'PF', 'C'], games: 60,
  points: 20, rebounds: 5, assists: 4, steals: 1, blocks: .7, threes: 2, turnovers: 2,
  fgm: 7, fga: 15, ftm: 4, fta: 5, ...overrides,
});
const row = (p: Player, games = 3): WeeklyPlayer => ({ player: p, scheduledGames: games, expectedGames: games, dates: [], override: false });
const schedule: NbaSchedule = {
  start: '2026-10-19', end: '2026-10-25', season: '2026-27', fetchedAt: new Date().toISOString(), source: 'https://www.espn.com/nba/schedule',
  games: ['2026-10-20', '2026-10-22', '2026-10-24'].map((date, i) => ({ id: String(i), date, homeTeam: 'BOS', awayTeam: 'NY', status: 'scheduled' })),
};

test('weekly counts use actual expected active games, not season GP; shooting ratios weight total attempts and games', () => {
  const a = row(player('a', { games: 40, points: 10, fgm: 5, fga: 10, ftm: 2, fta: 2 }), 3);
  const b = row(player('b', { points: 20, fgm: 0, fga: 5, ftm: 4, fta: 10 }), 1);
  const totals = totalWeeklyStats([a, b]);
  assert.equal(totals.points, 50);
  assert.equal(totals.games, 4);
  assert.equal(totals.fgm, 15); assert.equal(totals.fga, 35);
  assert.equal(totals.fg, 15 / 35);
  assert.equal(totals.ft, 10 / 16);
  assert.notEqual(totals.fg, .25);
  const reserve = { ...row(player('reserve', { points: 100 }), 4), reserve: true };
  assert.equal(totalWeeklyStats([a, b, reserve]).points, 50);
});

test('team aliases, canceled/postponed games, zero-game teams, fractional overrides and injuries are explicit', () => {
  const feed = { ...schedule, games: [...schedule.games, { id: 'off', date: '2026-10-25', homeTeam: 'BOS', awayTeam: 'NYK', status: 'postponed' as const }] };
  const [healthy, out, dtd, noGames, unknown] = weeklyPlayers([
    player('ny', { team: 'NYK' }), player('out', { injuryStatus: 'Out' }),
    player('dtd', { injuryStatus: 'Day-to-day' }), player('lakers', { team: 'LAL' }), player('unknown', { team: 'FA' }),
  ], feed, { ny: 1.5 });
  assert.equal(healthy!.scheduledGames, 3); assert.equal(healthy!.expectedGames, 1.5);
  assert.equal(out!.expectedGames, 0); assert.match(out!.warning!, /conservatively/);
  assert.equal(dtd!.expectedGames, 3); assert.match(dtd!.warning!, /uncertain/);
  assert.equal(noGames!.expectedGames, 0); assert.equal(noGames!.warning, undefined);
  assert.match(unknown!.warning!, /not recognized/);
  assert.equal(weeklyPlayers([player('out', { injuryStatus: 'Out' })], feed, { out: 2 })[0]!.expectedGames, 2);
});

test('all nine category edges count equally, TO is inverted and exact zero-attempt ties count half', () => {
  const a = totalWeeklyStats([row(player('a', { turnovers: 1 }), 2)]);
  const b = totalWeeklyStats([row(player('b', { turnovers: 3 }), 2)]);
  const cats = compareWeekly(a, b);
  assert.equal(cats.length, 9);
  assert.equal(cats.find(c => c.key === 'turnovers')!.edge, 'ahead');
  assert.ok(cats.find(c => c.key === 'turnovers')!.modelWinChance > .5);
  assert.equal(cats.find(c => c.key === 'points')!.modelWinChance, .5);
  const empty = totalWeeklyStats([]);
  assert.ok(compareWeekly(empty, empty).every(c => c.modelWinChance === .5 && c.edge === 'tied'));
});

test('exhaustive weekly lineup score equals independently enumerated legal subsets and excludes IL/bench totals', () => {
  const mine = [
    row(player('pg', { positions: ['PG'], assists: 11 }), 2),
    row(player('c', { positions: ['C'], rebounds: 15, fgm: 8, fga: 12 }), 4),
    row(player('g', { positions: ['PG', 'SG'], threes: 5, turnovers: 4 }), 3),
    row(player('sg', { positions: ['SG'], steals: 2 }), 4),
    { ...row(player('il', { points: 100, assists: 30 }), 4), reserve: true },
  ];
  const opponent = [row(player('o', { positions: ['SG'] }), 4)];
  const slots: RosterSlot[] = ['PG', 'SG', 'C', 'BN', 'BN'];
  const analysis = optimizeWeekly(mine, opponent, slots);
  let max = -Infinity;
  for (let mask = 0; mask < 16; mask++) {
    const subset = mine.slice(0, 4).filter((_, i) => mask & (1 << i));
    if (assignRoster(subset.map(r => r.player), ['PG', 'SG', 'C']).fitted !== subset.length) continue;
    max = Math.max(max, compareWeekly(totalWeeklyStats(subset), totalWeeklyStats(opponent)).reduce((s, c) => s + c.modelWinChance, 0));
  }
  assert.ok(Math.abs(max - analysis.expectedCategoryPoints) < 1e-9);
  const starters = new Set(analysis.starters.flatMap(s => s.player ? [s.player.id] : []));
  assert.ok(!starters.has('il'));
  assert.equal(analysis.myTotals.points, mine.filter(r => starters.has(r.player.id)).reduce((s, r) => s + r.player.points * r.expectedGames, 0));
  assert.equal(analysis.starters.length, 3);
  assert.equal(analysis.bench.length, mine.length - starters.size);
  assert.throws(() => optimizeWeekly(mine, [row(player('invalid', { positions: ['PF'] }))], slots), /Opponent/);
});

test('adding a zero-game/injury reserve never changes the chosen weekly score, and opponent bench is not counted', () => {
  const mine = [row(player('a'), 3), row(player('b'), 4)];
  const active = [row(player('opp'), 3)], bench = row(player('opp-bench', { points: 200 }), 4);
  const baseline = optimizeWeekly(mine, active, ['UTIL']);
  const withUnavailable = optimizeWeekly([...mine, row(player('out', { points: 100 }), 0)], active, ['UTIL']);
  assert.equal(baseline.expectedCategoryPoints, withUnavailable.expectedCategoryPoints);
  assert.equal(baseline.opponentTotals.points, 60);
  assert.notEqual(baseline.opponentTotals.points, totalWeeklyStats([...active, bench]).points);
});

test('date defaults respect Eastern weeks, inclusive short/extended windows validate, and backups preserve separate weekly teams', () => {
  assert.deepEqual(matchupDates(new Date('2026-10-19T02:00:00Z')), { start: '2026-10-12', end: '2026-10-18' });
  assert.deepEqual(matchupDates(new Date('2026-10-19T12:00:00Z')), { start: '2026-10-19', end: '2026-10-25' });
  assert.equal(validMatchupDates('2026-10-20', '2026-10-20'), true);
  assert.equal(validMatchupDates('2026-10-19', '2026-11-01'), true);
  assert.equal(validMatchupDates('2026-10-19', '2026-11-02'), false);
  assert.equal(validMatchupDates('2026-02-30', '2026-03-03'), false);
  const state = createInitialState();
  const [a, b, c] = state.players;
  state.picks = [{ playerId: a!.id, team: state.settings.myPosition, overall: 1 }];
  state.matchup = { ...createMatchup(state), myRosterIds: [a!.id, b!.id], myReserveIds: [b!.id],
    opponentRosterIds: [c!.id], opponentStarterIds: [c!.id], expectedGames: { [a!.id]: 1.5 } };
  const restored = parseSession(JSON.stringify(state));
  assert.deepEqual(restored.matchup, state.matchup);
  assert.deepEqual(restored.picks, state.picks);
  assert.throws(() => parseSession(JSON.stringify({ ...state, matchup: { ...state.matchup, opponentRosterIds: [a!.id] } })), /Weekly|weekly|backup/i);
});

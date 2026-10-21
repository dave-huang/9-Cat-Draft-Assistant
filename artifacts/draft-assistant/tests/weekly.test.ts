import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NbaSchedule } from '@workspace/api-client-react';
import type { Player, RosterSlot } from '../src/lib/draft-types';
import { compareWeekly, createMatchup, matchupDates, optimizeWeekly, totalWeeklyStats, validMatchupDates, weeklyPlayers, type WeeklyPlayer } from '../src/lib/weekly-engine';
import { assignRoster } from '../src/lib/draft-engine';
import { createInitialState, parseSession } from '../src/lib/projections';
import { currentWeeklyAnalysis, eligibleWeeklySlot, lineupErrors, moveWeeklyPlayer, optimalWeeklyLineup, prepareWeeklyPlanner, syncWeeklyLineups, weeklySlots } from '../src/lib/weekly-lineup';

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

test('weekly slots mirror all 10 active positions, exactly two BN and two separate IL', () => {
  const slots = weeklySlots(createInitialState().settings);
  assert.deepEqual(slots.map(s => s.id), ['PG-1', 'SG-1', 'G-1', 'SF-1', 'PF-1', 'F-1', 'C-1', 'UTIL-1', 'UTIL-2', 'UTIL-3', 'BN-1', 'BN-2', 'IL-1', 'IL-2']);
  const pg = player('pg', { positions: ['PG'] }), sf = player('sf', { positions: ['SF'] });
  const fits = (p: Player, id: string) => eligibleWeeklySlot(p, slots.find(s => s.id === id)!, []);
  assert.ok(fits(pg, 'PG-1') && fits(pg, 'G-1') && fits(pg, 'UTIL-3') && fits(pg, 'BN-2'));
  assert.ok(!fits(pg, 'F-1') && !fits(pg, 'C-1') && !fits(pg, 'IL-1'));
  assert.ok(fits(sf, 'F-1') && !fits(sf, 'G-1'));
});

test('moves and occupied swaps enforce eligibility in both directions without discarding players', () => {
  const slots = weeklySlots(createInitialState().settings);
  const pg = player('pg', { positions: ['PG', 'SG'] }), sg = player('sg', { positions: ['PG', 'SG'] }), c = player('c', { positions: ['C'] });
  const roster = [pg, sg, c], lineup = { 'PG-1': pg.id, 'SG-1': sg.id, 'UTIL-1': c.id };
  const swapped = moveWeeklyPlayer(lineup, roster, slots, [], pg.id, 'SG-1');
  assert.equal(swapped['PG-1'], sg.id); assert.equal(swapped['SG-1'], pg.id);
  assert.deepEqual(new Set(Object.values(swapped)), new Set(roster.map(p => p.id)));
  assert.throws(() => moveWeeklyPlayer(lineup, roster, slots, [], pg.id, 'C-1'), /not eligible/);
  assert.throws(() => moveWeeklyPlayer(lineup, roster, slots, [], pg.id, 'UTIL-1'), /Cannot swap/);
  assert.deepEqual(lineup, { 'PG-1': pg.id, 'SG-1': sg.id, 'UTIL-1': c.id });
  const benched = moveWeeklyPlayer(lineup, roster, slots, [], pg.id, 'BN-2');
  assert.equal(benched['BN-2'], pg.id); assert.equal(benched['PG-1'], undefined);
  assert.equal(lineupErrors(benched, roster, slots, []).length, 0);
  assert.throws(() => moveWeeklyPlayer(lineup, roster, slots, [], 'missing', 'BN-1'), /roster player/);
});

test('Out is not proof of Yahoo IL eligibility; IL swaps require confirmation for the displaced player too', () => {
  const slots = weeklySlots(createInitialState().settings);
  const out = player('out', { positions: ['C'], injuryStatus: 'Out' }), healthy = player('healthy', { positions: ['PG'] });
  const roster = [out, healthy], lineup = { 'C-1': out.id, 'PG-1': healthy.id };
  assert.throws(() => moveWeeklyPlayer(lineup, roster, slots, [], out.id, 'IL-1'), /Yahoo IL eligibility/);
  const onIl = moveWeeklyPlayer(lineup, roster, slots, [out.id], out.id, 'IL-1');
  assert.equal(onIl['IL-1'], out.id);
  assert.equal(lineupErrors(onIl, roster, slots, []).length, 1);
  assert.equal(lineupErrors(onIl, roster, slots, [out.id]).length, 0);
  assert.throws(() => moveWeeklyPlayer(onIl, roster, slots, [out.id], out.id, 'PG-1'), /not eligible/);
  const activate = moveWeeklyPlayer(onIl, roster, slots, [out.id], out.id, 'C-1');
  assert.equal(activate['C-1'], out.id); assert.equal(activate['IL-1'], undefined);
  const swap = { 'IL-1': out.id, 'UTIL-1': healthy.id };
  assert.throws(() => moveWeeklyPlayer(swap, roster, slots, [out.id], out.id, 'UTIL-1'), /Cannot swap/);
  assert.equal(moveWeeklyPlayer(swap, roster, slots, roster.map(p => p.id), out.id, 'UTIL-1')['IL-1'], healthy.id);
});

test('manually tweaking either team immediately changes only that team’s active weighted totals', () => {
  const settings = { ...createInitialState().settings, rosterSlots: ['UTIL', 'BN', 'BN'] as RosterSlot[], injuryReserveSlots: 2 };
  const slots = weeklySlots(settings);
  const mine = [row(player('a', { points: 10, fgm: 5, fga: 10 }), 3), row(player('b', { points: 30, fgm: 2, fga: 8 }), 4)];
  const opponent = [row(player('oa', { points: 11 }), 3), row(player('ob', { points: 100 }), 4)];
  const m = { 'UTIL-1': 'a', 'BN-1': 'b' }, o = { 'UTIL-1': 'oa', 'BN-1': 'ob' };
  const before = currentWeeklyAnalysis(mine, opponent, m, o, slots);
  const m2 = moveWeeklyPlayer(m, mine.map(r => r.player), slots, [], 'b', 'UTIL-1');
  const after = currentWeeklyAnalysis(mine, opponent, m2, o, slots);
  assert.equal(before.myTotals.points, 30); assert.equal(after.myTotals.points, 120);
  assert.equal(before.myTotals.fg, .5); assert.equal(after.myTotals.fg, .25);
  assert.deepEqual(before.opponentTotals, after.opponentTotals);
  const o2 = moveWeeklyPlayer(o, opponent.map(r => r.player), slots, [], 'ob', 'UTIL-1');
  const both = currentWeeklyAnalysis(mine, opponent, m2, o2, slots);
  assert.deepEqual(both.myTotals, after.myTotals); assert.equal(both.opponentTotals.points, 400);
  const il = moveWeeklyPlayer(m2, mine.map(r => r.player), slots, ['b'], 'b', 'IL-1');
  assert.equal(currentWeeklyAnalysis(mine, opponent, il, o2, slots).myTotals.points, 0);
});

test('constrained optimization fits every player into active, two BN and fixed IL, even with zero-game players', () => {
  const slots = weeklySlots(createInitialState().settings);
  const mine = Array.from({ length: 12 }, (_, i) => row(player(String(i), { points: 5 + i }), i < 4 ? 0 : 3));
  mine.push({ ...row(player('il-a'), 0), reserve: true }, { ...row(player('il-b'), 0), reserve: true });
  const opponent = [row(player('opp'), 4)];
  const analysis = optimizeWeekly(mine, opponent, slots.filter(s => s.kind === 'active').map(s => s.slot as RosterSlot), 2);
  assert.equal(analysis.starters.filter(s => s.player).length, 10);
  assert.equal(analysis.bench.filter(r => !r.reserve).length, 2);
  assert.equal(analysis.bench.filter(r => r.reserve).length, 2);
  const initial = { 'IL-1': 'il-a', 'IL-2': 'il-b' };
  const applied = optimalWeeklyLineup(analysis, initial, slots);
  assert.equal(Object.values(applied).length, 14);
  assert.equal(new Set(Object.values(applied)).size, 14);
  assert.equal(applied['IL-1'], 'il-a'); assert.equal(applied['IL-2'], 'il-b');
  assert.deepEqual(lineupErrors(applied, mine.map(r => r.player), slots, ['il-a', 'il-b']), []);
  const oppLineup = { 'PG-1': 'opp' };
  const current = currentWeeklyAnalysis(mine, opponent, applied, oppLineup, slots);
  assert.ok(Math.abs(current.expectedCategoryPoints - analysis.expectedCategoryPoints) < 1e-9);
  assert.deepEqual(current.myTotals, analysis.myTotals);
  assert.deepEqual(oppLineup, { 'PG-1': 'opp' });
});

test('an otherwise desirable vacancy cannot create a third bench player', () => {
  const mine = ['a', 'b', 'c'].map(id => row(player(id, {
    points: 1, rebounds: 1, assists: 1, steals: 1, blocks: 1, threes: 1, fgm: 0, fga: 1, ftm: 0, fta: 1, turnovers: 100,
  }), 1));
  const opponent = [row(player('opp', {
    points: 1e8, rebounds: 1e8, assists: 1e8, steals: 1e8, blocks: 1e8, threes: 1e8, fgm: 1, fga: 1, ftm: 1, fta: 1, turnovers: 1,
  }), 1)];
  const unrestricted = optimizeWeekly(mine, opponent, ['UTIL']);
  assert.equal(unrestricted.starters.filter(s => s.player).length, 0);
  const constrained = optimizeWeekly(mine, opponent, ['UTIL'], 2);
  assert.equal(constrained.starters.filter(s => s.player).length, 1);
  assert.equal(constrained.bench.length, 2);
  assert.throws(() => optimizeWeekly([...mine, row(player('d'))], opponent, ['UTIL'], 2), /No legal lineup/);
});

test('legacy teams migrate without losing players or opponent starter choices, and explicit slots survive backups', () => {
  const state = createInitialState(), slots = weeklySlots(state.settings);
  const mine = state.players.slice(0, 12).map(p => ({ ...p, positions: ['PG', 'SG', 'SF', 'PF', 'C'] as Player['positions'] }));
  const opp = state.players.slice(12, 24).map(p => ({ ...p, positions: ['PG', 'SG', 'SF', 'PF', 'C'] as Player['positions'] }));
  state.players = [...mine, ...opp];
  const legacy = { ...createMatchup(state), myRosterIds: mine.map(p => p.id), myReserveIds: [mine[11]!.id],
    opponentRosterIds: opp.map(p => p.id), opponentStarterIds: opp.slice(0, 10).map(p => p.id) };
  const migrated = prepareWeeklyPlanner(legacy, state.players, slots);
  assert.deepEqual(new Set(Object.values(migrated.myLineup!)), new Set(legacy.myRosterIds));
  assert.deepEqual(new Set(Object.values(migrated.opponentLineup!)), new Set(legacy.opponentRosterIds));
  assert.deepEqual(new Set(migrated.opponentStarterIds), new Set(legacy.opponentStarterIds));
  assert.equal(migrated.myLineup!['IL-1'], mine[11]!.id);
  assert.ok(migrated.ilEligibleIds!.includes(mine[11]!.id));
  state.matchup = migrated;
  assert.deepEqual(parseSession(JSON.stringify(state)).matchup, migrated);
  const duplicate = { ...migrated, myLineup: { 'PG-1': mine[0]!.id, 'UTIL-1': mine[0]!.id } };
  assert.throws(() => parseSession(JSON.stringify({ ...state, matchup: duplicate })), /invalid/);
  const foreign = { ...migrated, myLineup: { 'PG-1': opp[0]!.id } };
  assert.throws(() => parseSession(JSON.stringify({ ...state, matchup: foreign })), /invalid/);
  const changed = syncWeeklyLineups(migrated, { ...migrated.myLineup! }, { 'BN-1': opp[0]!.id, 'IL-1': opp[1]!.id }, slots);
  assert.deepEqual(changed.opponentStarterIds, []);
  assert.deepEqual(changed.opponentReserveIds, [opp[1]!.id]);
});

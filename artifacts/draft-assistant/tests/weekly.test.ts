import assert from 'node:assert/strict';
import './weekly-stats.test';
import { test } from 'node:test';
import type { NbaSchedule } from '@workspace/api-client-react';
import type { Player, RosterSlot } from '../src/lib/draft-types';
import { compareWeekly, createMatchup, matchupDates, optimizeWeekly, totalWeeklyStats, validMatchupDates, weeklyPlayers, type WeeklyPlayer } from '../src/lib/weekly-engine';
import { assignRoster } from '../src/lib/draft-engine';
import { createInitialState, parseSession } from '../src/lib/projections';
import { currentWeeklyAnalysis, eligibleWeeklySlot, lineupErrors, moveWeeklyPlayer, optimalWeeklyLineup, prepareWeeklyPlanner, syncWeeklyLineups, visibleWeeklySlots, weeklySlots } from '../src/lib/weekly-lineup';
import { weeklyMoveTarget } from '../src/lib/weekly-interaction';
import { importOpponentLineup, screenshotReviewRows, type LineupImportRow } from '../src/lib/lineup-import';

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

test('screenshot matching normalizes accents and suffixes, but never guesses initials or duplicate names', () => {
  const pool = [player('j', { name: 'Nikola Jokić' }), player('m', { name: 'Michael Porter Jr.' }),
    player('a', { name: 'Duplicate Name' }), player('b', { name: 'Duplicate Name' })];
  const slots = weeklySlots(createInitialState().settings);
  const rows = screenshotReviewRows({ rows: [
    { name: 'Nikola Jokic', slot: 'C', team: 'DEN', uncertain: false },
    { name: 'Michael Porter', slot: 'UTIL', team: '', uncertain: false },
    { name: 'N. Jokic', slot: 'UTIL', team: '', uncertain: true },
    { name: 'Duplicate Name', slot: 'UNKNOWN', team: '', uncertain: true },
  ], warnings: [] }, pool, slots);
  assert.deepEqual(rows.map(r => r.playerId), ['j', 'm', '', '']);
  assert.deepEqual(rows.map(r => r.slotId), ['C-1', 'UTIL-1', 'UTIL-2', '']);
});

test('reviewed screenshot replaces only opponent, preserves own roster, dates, retained overrides and IL', () => {
  const pool = ['mine','keep','depart','new','injured'].map(id => player(id));
  const slots = weeklySlots(createInitialState().settings);
  const planner = { start: '2026-10-19', end: '2026-10-25',
    myRosterIds: ['mine'], myLineup: { 'PG-1': 'mine' }, myReserveIds: [],
    opponentRosterIds: ['keep','depart'], opponentLineup: { 'C-1': 'keep', 'BN-1': 'depart' },
    opponentStarterIds: ['keep'], opponentReserveIds: [], ilEligibleIds: [],
    expectedGames: { mine: 2, keep: 1, depart: 0 } };
  const rows: LineupImportRow[] = [
    { name: 'keep', team: '', uncertain: false, playerId: 'keep', slotId: 'C-1', skip: false },
    { name: 'new', team: '', uncertain: false, playerId: 'new', slotId: 'BN-3', skip: false },
    { name: 'injured', team: '', uncertain: false, playerId: 'injured', slotId: 'IL-1', skip: false },
    { name: 'unreadable', team: '', uncertain: true, playerId: '', slotId: '', skip: true },
  ];
  const before = structuredClone(planner);
  assert.throws(() => importOpponentLineup(planner, rows, pool, slots, false), /Confirm/);
  const next = importOpponentLineup(planner, rows, pool, slots, true);
  assert.deepEqual(next.myRosterIds, ['mine']);
  assert.deepEqual(next.myLineup, planner.myLineup);
  assert.deepEqual(next.opponentRosterIds, ['keep','new','injured']);
  assert.deepEqual(next.opponentStarterIds, ['keep']);
  assert.deepEqual(next.opponentReserveIds, ['injured']);
  assert.deepEqual(next.expectedGames, { mine: 2, keep: 1 });
  assert.deepEqual(next.ilEligibleIds, ['injured']);
  assert.equal(next.start, planner.start); assert.equal(next.end, planner.end);
  assert.deepEqual(planner, before);
  const initial = createInitialState();
  const restored = parseSession(JSON.stringify({ ...initial, players: pool, matchup: next }));
  assert.deepEqual(restored.matchup?.opponentLineup, next.opponentLineup);
});

test('screenshot confirmation rejects duplicates, unknowns, own players, bad positions and capacity without mutation', () => {
  const pool = Array.from({ length: 15 }, (_, i) => player(String(i), { positions: ['C'] }));
  const slots = weeklySlots(createInitialState().settings);
  const planner = { start: '2026-10-19', end: '2026-10-25', myRosterIds: ['14'], myLineup: { 'C-1': '14' },
    opponentRosterIds: [], opponentLineup: {}, opponentStarterIds: [], expectedGames: {} };
  const row = (playerId: string, slotId: string): LineupImportRow => ({ name: playerId, team: '', uncertain: false, playerId, slotId, skip: false });
  const before = structuredClone(planner);
  for (const rows of [
    [], [row('', 'C-1')], [row('14', 'C-1')], [row('0', '')], [row('0','PG-1')],
    [row('0','C-1'),row('0','BN-1')], [row('0','C-1'),row('1','C-1')],
    Array.from({length: 13}, (_,i) => row(String(i), i === 0 ? 'C-1' : `BN-${i}`)),
    [row('0','IL-1'), row('1','IL-2'), row('2','IL-3')],
  ]) assert.throws(() => importOpponentLineup(planner, rows, pool, slots, true));
  assert.deepEqual(planner, before);
  // Any/all 12 regular players can remain on the bench.
  const next = importOpponentLineup(planner, Array.from({length:12}, (_,i) => row(String(i),`BN-${i+1}`)), pool, slots, false);
  assert.equal(next.opponentRosterIds.length, 12);
  assert.deepEqual(next.opponentStarterIds, []);
});

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

test('weekly slots keep 10 active positions and two IL, but any of the 12 regular players may be benched', () => {
  const settings = createInitialState().settings, slots = weeklySlots(settings);
  assert.deepEqual(slots.filter(s => s.kind === 'active').map(s => s.id), ['PG-1', 'SG-1', 'G-1', 'SF-1', 'PF-1', 'F-1', 'C-1', 'UTIL-1', 'UTIL-2', 'UTIL-3']);
  assert.equal(slots.filter(s => s.kind === 'bench').length, 12);
  assert.deepEqual(slots.filter(s => s.kind === 'il').map(s => s.id), ['IL-1', 'IL-2']);
  assert.equal(settings.rosterSlots.length, 12); // Weekly BN flexibility does not expand the draft roster.
  assert.equal(visibleWeeklySlots({}, slots).filter(s => s.kind === 'bench').length, 2);
  assert.deepEqual(visibleWeeklySlots({ 'BN-1': 'a', 'BN-2': 'b' }, slots).filter(s => s.kind === 'bench').map(s => s.id), ['BN-1', 'BN-2', 'BN-3']);
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

test('drag and click destination previews enforce side, position, mutual swap and IL eligibility without mutating lineups', () => {
  const slots = weeklySlots(createInitialState().settings);
  const pg = player('pg', { positions: ['PG', 'SG'] }), sg = player('sg', { positions: ['PG', 'SG'] });
  const c = player('c', { positions: ['C'], injuryStatus: 'Out' });
  const roster = [pg, sg, c], lineup = { 'PG-1': pg.id, 'SG-1': sg.id, 'UTIL-1': c.id };
  const source = { side: 'mine' as const, id: pg.id };
  const target = (id: string) => weeklyMoveTarget(source, 'mine', id, lineup, roster, slots, []);
  assert.equal(weeklyMoveTarget(null, 'mine', 'BN-1', lineup, roster, slots, []).state, 'idle');
  assert.equal(target('PG-1').state, 'source');
  assert.equal(target('SG-1').state, 'allowed');
  assert.equal(target('BN-1').state, 'allowed');
  assert.equal(target('C-1').state, 'blocked');
  assert.match(target('UTIL-1').reason!, /Cannot swap/);
  assert.match(target('IL-1').reason!, /Yahoo IL eligibility/);
  const crossTeam = weeklyMoveTarget(source, 'opponent', 'BN-1', lineup, roster, slots, []);
  assert.equal(crossTeam.state, 'blocked');
  assert.match(crossTeam.reason!, /own team/);
  assert.equal(weeklyMoveTarget({ side: 'mine', id: c.id }, 'mine', 'IL-1', lineup, roster, slots, [c.id]).state, 'allowed');
  assert.equal(weeklyMoveTarget({ side: 'mine', id: 'gone' }, 'mine', 'BN-1', lineup, roster, slots, []).state, 'blocked');
  assert.deepEqual(lineup, { 'PG-1': pg.id, 'SG-1': sg.id, 'UTIL-1': c.id });
});

test('drag previews cannot activate a 13th regular player, but support every flexible bench destination for either team', () => {
  const slots = weeklySlots(createInitialState().settings);
  const roster = Array.from({ length: 12 }, (_, i) => player(`regular-${i}`));
  const il = player('il');
  const all = [...roster, il], confirmed = [il.id];
  const lineup = { ...Object.fromEntries(roster.map((p, i) => [`BN-${i + 1}`, p.id])), 'IL-1': il.id };
  for (const side of ['mine', 'opponent'] as const) {
    const activating = weeklyMoveTarget({ side, id: il.id }, side, 'PG-1', lineup, all, slots, confirmed);
    assert.equal(activating.state, 'blocked');
    assert.match(activating.reason!, /non-IL roster is full/);
    assert.equal(weeklyMoveTarget({ side, id: roster[0]!.id }, side, 'BN-12', lineup, all, slots, confirmed).state, 'allowed');
  }
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

test('optimization may bench more than two players, keeps zero-game players off the active lineup and preserves IL', () => {
  const slots = weeklySlots(createInitialState().settings);
  const mine = Array.from({ length: 12 }, (_, i) => row(player(String(i), { points: 5 + i }), i < 4 ? 0 : 3));
  mine.push({ ...row(player('il-a'), 0), reserve: true }, { ...row(player('il-b'), 0), reserve: true });
  const opponent = [row(player('opp'), 4)];
  const analysis = optimizeWeekly(mine, opponent, slots.filter(s => s.kind === 'active').map(s => s.slot as RosterSlot));
  assert.ok(analysis.starters.filter(s => s.player).every(s => mine.find(r => r.player.id === s.player!.id)!.expectedGames > 0));
  assert.ok(analysis.bench.filter(r => !r.reserve).length >= 4);
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

test('a beneficial vacancy is allowed even when it benches all three regular players', () => {
  const mine = ['a', 'b', 'c'].map(id => row(player(id, {
    points: 1, rebounds: 1, assists: 1, steals: 1, blocks: 1, threes: 1, fgm: 0, fga: 1, ftm: 0, fta: 1, turnovers: 100,
  }), 1));
  const opponent = [row(player('opp', {
    points: 1e8, rebounds: 1e8, assists: 1e8, steals: 1e8, blocks: 1e8, threes: 1e8, fgm: 1, fga: 1, ftm: 1, fta: 1, turnovers: 1,
  }), 1)];
  const analysis = optimizeWeekly(mine, opponent, ['UTIL']);
  assert.equal(analysis.starters.filter(s => s.player).length, 0);
  assert.equal(analysis.bench.length, 3);
  const slots = weeklySlots(createInitialState().settings);
  const applied = optimalWeeklyLineup(analysis, {}, slots);
  assert.deepEqual(applied, { 'BN-1': 'a', 'BN-2': 'b', 'BN-3': 'c' });
  assert.deepEqual(lineupErrors(applied, mine.map(r => r.player), slots, []), []);
});

test('both teams can bench all 12 non-IL players, but neither benching nor an Out label creates a 13th regular spot', () => {
  const slots = weeklySlots(createInitialState().settings);
  for (const side of ['mine', 'opponent']) {
    const roster = Array.from({ length: 12 }, (_, i) => player(`${side}-${i}`, i === 0 ? { injuryStatus: 'Out' } : {}));
    const active = slots.filter(s => s.kind === 'active');
    let lineup = Object.fromEntries(roster.map((p, i) => [active[i]?.id ?? `BN-${i - 9}`, p.id]));
    for (const p of roster.slice(0, 10)) {
      const nextBench = visibleWeeklySlots(lineup, slots).find(s => s.kind === 'bench' && !lineup[s.id])!;
      lineup = moveWeeklyPlayer(lineup, roster, slots, [], p.id, nextBench.id);
    }
    assert.equal(Object.keys(lineup).filter(k => k.startsWith('BN-')).length, 12);
    assert.equal(Object.values(lineup).length, 12);
    assert.deepEqual(lineupErrors(lineup, roster, slots, []), []);
    const extra = player(`${side}-extra`, { injuryStatus: 'Out' });
    assert.match(lineupErrors({ ...lineup, 'PG-1': extra.id }, [...roster, extra], slots, []).join(' '), /12-player non-IL/);
    const reserves = [player(`${side}-il1`), player(`${side}-il2`)];
    const withIl = { ...lineup, 'IL-1': reserves[0]!.id, 'IL-2': reserves[1]!.id };
    const all = [...roster, ...reserves], confirmed = reserves.map(p => p.id);
    assert.deepEqual(lineupErrors(withIl, all, slots, confirmed), []);
    assert.throws(() => moveWeeklyPlayer(withIl, all, slots, confirmed, reserves[0]!.id, 'PG-1'), /non-IL roster is full/);
    assert.throws(() => moveWeeklyPlayer(withIl, all, slots, confirmed, reserves[0]!.id, 'IL-3'), /existing league slot/);
    const totals = currentWeeklyAnalysis(all.map(p => row(p)), [], withIl, {}, slots).myTotals;
    assert.equal(totals.games, 0); assert.equal(totals.points, 0);
  }
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
  const allBench = syncWeeklyLineups(migrated,
    Object.fromEntries(mine.map((p, i) => [`BN-${i + 1}`, p.id])),
    Object.fromEntries(opp.map((p, i) => [`BN-${i + 1}`, p.id])), slots);
  assert.deepEqual(parseSession(JSON.stringify({ ...state, matchup: allBench })).matchup, allBench);
  const duplicate = { ...migrated, myLineup: { 'PG-1': mine[0]!.id, 'UTIL-1': mine[0]!.id } };
  assert.throws(() => parseSession(JSON.stringify({ ...state, matchup: duplicate })), /invalid/);
  const foreign = { ...migrated, myLineup: { 'PG-1': opp[0]!.id } };
  assert.throws(() => parseSession(JSON.stringify({ ...state, matchup: foreign })), /invalid/);
  const changed = syncWeeklyLineups(migrated, { ...migrated.myLineup! }, { 'BN-1': opp[0]!.id, 'IL-1': opp[1]!.id }, slots);
  assert.deepEqual(changed.opponentStarterIds, []);
  assert.deepEqual(changed.opponentReserveIds, [opp[1]!.id]);
});

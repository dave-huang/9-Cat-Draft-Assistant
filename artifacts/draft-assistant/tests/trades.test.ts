import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTradeModel, recommendTrades, tradeCandidate, tradePitch, type TradeInput } from '../src/lib/trade-engine';
import { createInitialState, parseSession } from '../src/lib/projections';
import { createMatchup } from '../src/lib/weekly-engine';
import type { DraftState, Player } from '../src/lib/draft-types';
import { importTradePartnerRoster, tradeScreenshotReviewRows } from '../src/lib/trade-roster-import';
import type { LineupImportRow } from '../src/lib/lineup-import';

const base = (id: string): Player => ({
  id, name: `Synthetic ${id}`, team: 'BOS', positions: ['PG', 'SG', 'SF', 'PF', 'C'],
  games: 72, points: 20, rebounds: 6, assists: 4, steals: 1, blocks: 1, threes: 2,
  turnovers: 2, fgm: 7, fga: 14, ftm: 4, fta: 5, adp: 50, positionsSource: 'Yahoo',
});
function fixture(): TradeInput {
  const mine = Array.from({ length: 12 }, (_, i) => ({ ...base(`a${i}`), rebounds: 10, assists: 2 }));
  const theirs = Array.from({ length: 12 }, (_, i) => ({ ...base(`b${i}`), rebounds: 2, assists: 10 }));
  const rest = Array.from({ length: 160 }, (_, i) => ({
    ...base(`c${i}`), points: 10 + i % 19, rebounds: 2 + i % 9,
    assists: 2 + i % 9, blocks: .2 + i % 17 / 10, threes: .5 + i % 7 / 2,
    steals: .5 + i % 10 / 10, turnovers: 1 + i % 5 / 2,
    fgm: 4 + i % 4, fga: 10 + i % 8, ftm: 2 + i % 3, fta: 5,
  }));
  return { pool: [...mine, ...theirs, ...rest], mine, myReserveIds: [], partners: [{ id: 'team-b', name: 'Other manager', players: theirs, reserveIds: [] }],
    settings: createInitialState().settings, lockedPlayerIds: [], packageSize: 'both' };
}

test('complementary trades improve BOTH balanced builds, respect fair value, and never mutate rosters', () => {
  const input = fixture(), before = JSON.stringify(input);
  const result = recommendTrades(input);
  assert.ok(result.ideas.length > 0, JSON.stringify(result));
  assert.equal(result.teamsAnalyzed, 1);
  assert.ok(result.scanned > 100);
  for (const idea of result.ideas) {
    assert.ok(idea.myGain >= .02 && idea.theirGain >= .02);
    assert.ok(idea.valueGap <= .12);
    assert.ok(idea.adpGap! <= .2);
    assert.equal(idea.give.length, idea.receive.length);
    assert.equal(idea.mineAfter.coverage, 10);
    assert.equal(idea.theirAfter.coverage, 10);
    assert.ok(idea.gains.length && idea.theirGains.length);
    assert.ok(tradePitch(idea).includes('Would you consider'));
    for (const key of Object.keys(idea.mineBefore.z) as (keyof typeof idea.mineBefore.z)[]) {
      assert.ok(idea.mineAfter.z[key] >= .25 || idea.mineAfter.z[key] - idea.mineBefore.z[key] >= -.6);
      assert.ok(idea.theirAfter.z[key] >= .25 || idea.theirAfter.z[key] - idea.theirBefore.z[key] >= -.6);
    }
  }
  assert.equal(JSON.stringify(input), before);
});

test('package filters, untouchables and injury/IL safeguards are enforced for both managers', () => {
  for (const size of ['one', 'two'] as const) {
    const input = fixture(); input.packageSize = size;
    const result = recommendTrades(input);
    assert.ok(result.ideas.length > 0);
    assert.ok(result.ideas.every(t => t.give.length === (size === 'one' ? 1 : 2)));
  }
  const input = fixture();
  input.lockedPlayerIds = input.mine.map(p => p.id);
  assert.equal(recommendTrades(input).ideas.length, 0);
  input.lockedPlayerIds = [];
  input.myReserveIds = [input.mine[0]!.id];
  input.partners[0]!.reserveIds = [input.partners[0]!.players[0]!.id];
  input.mine[1]!.injuryStatus = 'Out';
  input.partners[0]!.players[1]!.injuryStatus = 'Day-To-Day';
  const result = recommendTrades(input);
  const excluded = ['a0', 'a1', 'b0', 'b1'];
  assert.ok(result.ideas.every(t => [...t.give, ...t.receive].every(p => !excluded.includes(p.id))));
  assert.ok(result.warnings.some(s => s.includes('IL players')));
  for (const extra of [{ injuryStatus: 'Questionable' }, { games: 30 }, { projectionUnavailable: true }, { positionsConflict: true }, { injuryStatus: 'Unknown' }]) {
    assert.equal(tradeCandidate({ ...base('x'), ...extra }), false);
  }
});

test('no lopsided reputation trades and no manufactured offer when both sides cannot benefit', () => {
  const input = fixture();
  input.mine.forEach(p => { p.adp = 200; });
  input.partners[0]!.players.forEach(p => { p.adp = 5; });
  assert.equal(recommendTrades(input).ideas.length, 0);
  const same = fixture();
  [...same.mine, ...same.partners[0]!.players].forEach(p => Object.assign(p, base(p.id)));
  assert.equal(recommendTrades(same).ideas.length, 0);
});

test('shooting uses projected makes/attempts and GP; bench-depth is included, IL excluded', () => {
  const input = fixture();
  const a = { ...base('a'), games: 41, fgm: 2, fga: 4, ftm: 1, fta: 2 };
  const b = { ...base('b'), games: 82, fgm: 9, fga: 10, ftm: 9, fta: 10 };
  const il = { ...base('il'), fgm: 0, fga: 100, ftm: 0, fta: 100 };
  const model = buildTradeModel([...input.pool, a, b, il], input.settings);
  const profile = model.profile([a, b, il], ['il']);
  assert.equal(profile.values.fg, 10 / 12);
  assert.equal(profile.values.ft, 9.5 / 11);
  assert.equal(profile.values.points, 30);
  const all = model.profile(input.mine, []);
  assert.ok(Math.abs(all.values.points - 12 * 20 * 72 / 82) < 1e-9);
  const onlyCenter = Array.from({ length: 12 }, (_, i) => ({ ...base(`pos${i}`), positions: ['C'] as Player['positions'] }));
  assert.ok(buildTradeModel([...input.pool, ...onlyCenter], input.settings).profile(onlyCenter, []).coverage < 10);
});

test('partial, over-capacity, invalid/duplicated and unavailable rosters are explicit instead of ranked', () => {
  let input = fixture(); input.mine = input.mine.slice(0, 5);
  assert.match(recommendTrades(input).warnings[0]!, /at least 10/);
  input = fixture(); input.partners[0]!.players = input.mine;
  assert.equal(recommendTrades(input).teamsAnalyzed, 0);
  input = fixture(); input.pool = input.pool.slice(0, 30);
  assert.match(recommendTrades(input).warnings[0]!, /too small/);
  input = fixture(); input.mine = [...input.mine, input.pool[30]!];
  assert.match(recommendTrades(input).warnings[0]!, /capacity/);
  input = fixture(); input.mine[0]!.projectionUnavailable = true;
  assert.match(recommendTrades(input).warnings[0]!, /missing projections/);
});

function session(): DraftState {
  const f = fixture();
  const state: DraftState = { ...createInitialState(), players: f.pool,
    source: { label: 'Synthetic forecast', season: '2026-27', isDemo: false },
    picks: [{ playerId: 'a0', team: 6, overall: 1 }], shortlist: ['c0'] };
  state.matchup = { ...createMatchup(state), statsBasis: 'actuals', myRosterIds: f.mine.map(p => p.id),
    myLineup: { 'UTIL-1': 'a0', 'BN-1': 'a1' }, opponentRosterIds: ['b0'], opponentStarterIds: ['b0'],
    opponentLineup: { 'UTIL-1': 'b0' }, expectedGames: { a0: 2 } };
  state.trades = { partners: [{ id: 'team-b', name: 'Other manager', rosterIds: f.partners[0]!.players.map(p => p.id), reserveIds: [] }],
    lockedPlayerIds: ['a0'], packageSize: 'both' };
  return state;
}

function importRow(id: string, slotId = 'regular'): LineupImportRow {
  return { name: `Synthetic ${id}`, team: 'BOS', uncertain: false, playerId: id, slotId, skip: false };
}

test('trade screenshot review matches full names conservatively and groups starters and bench as regular', () => {
  const state = session();
  const rows = tradeScreenshotReviewRows([
    { name: 'Synthetic b0', slot: 'PG', team: 'BOS', uncertain: false },
    { name: 'Synthetic b1', slot: 'BN', team: 'BOS', uncertain: false },
    { name: 'Synthetic b2', slot: 'IL', team: 'BOS', uncertain: false },
    { name: 'S. b3', slot: 'UNKNOWN', team: '', uncertain: true },
  ], state.players);
  assert.deepEqual(rows.map(r => r.playerId), ['b0', 'b1', 'b2', '']);
  assert.deepEqual(rows.map(r => r.slotId), ['regular', 'regular', 'il', '']);
  assert.equal(rows[3]!.uncertain, true);
  const ambiguous = [...state.players, { ...base('another'), name: 'Synthetic b0' }];
  assert.equal(tradeScreenshotReviewRows([{ name: 'Synthetic b0', slot: 'PG', team: '', uncertain: false }], ambiguous)[0]!.playerId, '');
});

test('trade screenshot import replaces only selected partner, preserves everything else, accepts 12 regular plus 2 confirmed IL', () => {
  const state = session();
  state.trades!.partners.push({ id: 'second', name: 'Another team', rosterIds: ['c20'], reserveIds: [] });
  const before = JSON.stringify(state);
  const rows = [...Array.from({ length: 12 }, (_, i) => importRow(`b${i}`)), importRow('c0', 'il'), importRow('c1', 'il')];
  const next = importTradePartnerRoster(state, 'team-b', rows, true);
  assert.equal(JSON.stringify(state), before);
  assert.equal(next.partners[0]!.rosterIds.length, 14);
  assert.deepEqual(next.partners[0]!.reserveIds, ['c0', 'c1']);
  assert.deepEqual(next.partners[1], state.trades!.partners[1]);
  assert.deepEqual(next.lockedPlayerIds, state.trades!.lockedPlayerIds);
  assert.equal(next.packageSize, state.trades!.packageSize);
  assert.deepEqual(parseSession(JSON.stringify({ ...state, trades: next })).trades, next);
  const fewer = importTradePartnerRoster(state, 'team-b', [importRow('b0'), { ...importRow('b1'), skip: true }], false);
  assert.deepEqual(fewer.partners[0]!.rosterIds, ['b0']);
});

test('trade screenshot rejects unresolved/duplicate/owned players, missing partner, bad designation and excess capacity atomically', () => {
  const state = session();
  state.trades!.partners.push({ id: 'second', name: 'Another team', rosterIds: ['c20'], reserveIds: [] });
  const before = JSON.stringify(state);
  assert.throws(() => importTradePartnerRoster(state, 'gone', [importRow('b0')], false), /no longer exists/);
  assert.throws(() => importTradePartnerRoster(state, 'team-b', [], false), /at least one/);
  assert.throws(() => importTradePartnerRoster(state, 'team-b', [importRow('missing')], false), /Match/);
  assert.throws(() => importTradePartnerRoster(state, 'team-b', [importRow('b0'), importRow('b0')], false), /more than once/);
  assert.throws(() => importTradePartnerRoster(state, 'team-b', [importRow('a0')], false), /your team/);
  assert.throws(() => importTradePartnerRoster(state, 'team-b', [importRow('c20')], false), /Another team/);
  assert.throws(() => importTradePartnerRoster(state, 'team-b', [importRow('b0', '')], false), /Choose Regular or IL/);
  assert.throws(() => importTradePartnerRoster(state, 'team-b', [importRow('b0', 'il')], false), /Confirm/);
  assert.throws(() => importTradePartnerRoster(state, 'team-b', ['b0', 'b1', 'b2'].map(id => importRow(id, 'il')), true), /IL limit/);
  const full = [...Array.from({ length: 12 }, (_, i) => importRow(`b${i}`)), importRow('c0')];
  assert.throws(() => importTradePartnerRoster(state, 'team-b', full, false), /non-IL limit/);
  // Out is never treated as an automatic IL designation.
  state.players.find(p => p.id === 'c0')!.injuryStatus = 'Out';
  assert.throws(() => importTradePartnerRoster(state, 'team-b', full, false), /non-IL limit/);
  state.players.find(p => p.id === 'c0')!.injuryStatus = undefined;
  assert.equal(JSON.stringify(state), before);
});

test('trade rosters and locks survive JSON backup, without rewriting Weekly or legacy sessions', () => {
  const state = session(), restored = parseSession(JSON.stringify(state));
  assert.deepEqual(restored.trades, state.trades);
  assert.deepEqual(restored.matchup, state.matchup);
  assert.deepEqual(restored.picks, state.picks);
  assert.deepEqual(restored.shortlist, state.shortlist);
  const old = { ...state, trades: undefined };
  assert.equal(parseSession(JSON.stringify(old)).trades, undefined);
  const invalid = structuredClone(state); invalid.trades!.partners[0]!.rosterIds.push('missing');
  assert.throws(() => parseSession(JSON.stringify(invalid)), /missing player/);
  const dup = structuredClone(state); dup.trades!.partners.push({ ...dup.trades!.partners[0]!, id: 'second' });
  assert.throws(() => parseSession(JSON.stringify(dup)), /invalid settings/);
});

test('store validates ownership/capacity, preserves partners through feed refresh and keeps analysis read-only', async () => {
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {} } });
  const { draftActions, getDraftSnapshot } = await import('../src/hooks/use-draft');
  const state = session();
  draftActions.importSession(JSON.stringify(state));
  const priorWeekly = JSON.stringify(getDraftSnapshot().state.matchup);
  const workspace = structuredClone(state.trades!);
  workspace.lockedPlayerIds = ['a1'];
  draftActions.updateTrades(workspace);
  assert.equal(JSON.stringify(getDraftSnapshot().state.matchup), priorWeekly);
  const wrongOwner = structuredClone(workspace); wrongOwner.partners[0]!.rosterIds[0] = 'a0';
  assert.throws(() => draftActions.updateTrades(wrongOwner), /own your player/);
  const extra = structuredClone(workspace); extra.partners[0]!.rosterIds.push('c0');
  assert.throws(() => draftActions.updateTrades(extra), /capacity/);
  const shortFeed = state.players.filter(p => p.id !== 'b11');
  draftActions.loadCurrentProjections(shortFeed, state.source);
  assert.equal(getDraftSnapshot().state.players.find(p => p.id === 'b11')?.projectionUnavailable, true);
  assert.deepEqual(getDraftSnapshot().state.trades, workspace);
  assert.equal(JSON.stringify(getDraftSnapshot().state.matchup), priorWeekly);
  assert.throws(() => draftActions.importProjections('', 'new', '2026-27'), /clear saved/);
  assert.deepEqual(parseSession(saved.get('nine-cat-draft-v1')!).trades, workspace);
  // The action uses current store ownership, not stale state from opening the dialog.
  const current = structuredClone(getDraftSnapshot().state.trades!);
  current.partners.push({ id: 'second', name: 'Second team', rosterIds: ['c1'], reserveIds: [] });
  draftActions.updateTrades(current);
  const beforeInvalid = JSON.stringify(getDraftSnapshot().state);
  assert.throws(() => draftActions.importTradePartner('team-b', [importRow('c1')], false), /Second team/);
  assert.equal(JSON.stringify(getDraftSnapshot().state), beforeInvalid);
  draftActions.importTradePartner('team-b', [importRow('b0'), importRow('c0', 'il')], true);
  const imported = getDraftSnapshot().state;
  assert.equal(JSON.stringify(imported.matchup), priorWeekly);
  assert.deepEqual(imported.trades!.partners[0]!.rosterIds, ['b0', 'c0']);
  assert.deepEqual(imported.trades!.partners[0]!.reserveIds, ['c0']);
  assert.deepEqual(imported.trades!.partners[1], current.partners[1]);
  assert.deepEqual(imported.trades!.lockedPlayerIds, ['a1']);
  assert.deepEqual(imported.picks, state.picks);
  assert.deepEqual(imported.shortlist, state.shortlist);
  assert.deepEqual(parseSession(saved.get('nine-cat-draft-v1')!).trades, imported.trades);
});

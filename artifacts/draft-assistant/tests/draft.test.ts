import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeDraft, assignRoster } from '../src/lib/draft-engine';
import { createInitialState, parseSession } from '../src/lib/projections';
import { LEAGUE_ROSTER_SLOTS, migrateLeagueRoster } from '../src/lib/league-roster';
import type { Player } from '../src/lib/draft-types';

const players: Player[] = Array.from({ length: 170 }, (_, i) => ({
  id: `test-${i}`, name: `Test Player ${i}`, team: 'ABC', positions: ['PG', 'SG', 'SF', 'PF', 'C'],
  games: 70 + i % 10, points: 15 + i % 15, rebounds: 4 + i % 8, assists: 2 + i % 8,
  steals: .5 + (i % 10) / 10, blocks: .2 + (i % 8) / 10, threes: 1 + (i % 6) / 2,
  turnovers: 1 + i % 3, fgm: 5 + i % 4, fga: 12 + i % 4, ftm: 3, fta: 4,
}));
const source = { label: 'Synthetic forecasts', season: '2026-27', isDemo: false, provider: 'ESPN', fetchedAt: new Date().toISOString() };

test('league screenshot gives 12 draftable spots and two separate injury reserves, not 14 picks', () => {
  const state = { ...createInitialState(), players, source };
  assert.deepEqual(state.settings.rosterSlots, ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL', 'UTIL', 'BN', 'BN']);
  assert.equal(state.settings.injuryReserveSlots, 2);
  const a = analyzeDraft(state);
  assert.equal(a.totalPicks, state.settings.teamCount * 12);
  assert.equal(a.rosterAssignment.length, 12);
  state.picks = players.slice(0, 12).map((p, i) => ({ playerId: p.id, team: state.settings.myPosition, overall: i + 1 }));
  assert.equal(analyzeDraft(state).complete, true);
  const restored = parseSession(JSON.stringify(state));
  assert.equal(restored.settings.injuryReserveSlots, 2);
  assert.equal(restored.picks.length, 12);
});

test('existing default roster safely upgrades without deleting a pick, while incompatible old mocks stay intact', () => {
  const oldSlots = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'C', 'UTIL', 'UTIL', 'BN', 'BN', 'BN'] as const;
  const old = { ...createInitialState(), players, source };
  old.settings.rosterSlots = [...oldSlots];
  old.picks = [{ playerId: players[0]!.id, team: old.settings.myPosition, overall: 1 }];
  const updated = migrateLeagueRoster(old);
  assert.deepEqual(updated.settings.rosterSlots, LEAGUE_ROSTER_SLOTS);
  assert.deepEqual(updated.picks, old.picks);
  assert.strictEqual(updated.players, old.players);
  assert.strictEqual(updated.source, old.source);
  const full = { ...old, picks: players.slice(0, 13).map((p, i) => ({ playerId: p.id, team: old.settings.myPosition, overall: i + 1 })) };
  assert.strictEqual(migrateLeagueRoster(full), full);
  const centers = { ...old, players: players.map(p => ({ ...p, positions: ['C'] as Player['positions'] })), picks: full.picks.slice(0, 7) };
  assert.strictEqual(migrateLeagueRoster(centers), centers);
  const snake = { ...old, settings: { ...old.settings, trackingMode: 'snake' as const } };
  assert.strictEqual(migrateLeagueRoster(snake), snake);
  const custom = { ...old, settings: { ...old.settings, rosterSlots: [...LEAGUE_ROSTER_SLOTS, 'BN' as const] } };
  assert.strictEqual(migrateLeagueRoster(custom), custom);
  const restarted = migrateLeagueRoster({ ...full, picks: [], shortlist: [] });
  assert.deepEqual(restarted.settings.rosterSlots, LEAGUE_ROSTER_SLOTS);
});

test('manual recommendations exclude every taken player and adapt to the actual roster, not snake order', () => {
  const state = { ...createInitialState(), players, source };
  const initial = analyzeDraft(state);
  const top = initial.recommendations[0]!;
  state.picks = [{ playerId: top.player.id, team: 0, overall: 1 }, { playerId: players[0]!.id, team: state.settings.myPosition, overall: 2 }];
  const next = analyzeDraft(state);
  assert.equal(next.roster.length, 1);
  assert.equal(next.recommendations.some(r => r.player.id === top.player.id), false);
  assert.equal(next.recommendations.some(r => r.player.id === players[0]!.id), false);
  assert.equal(next.myNextPick, null);
  assert.ok(next.categories.every(c => c.priority >= 1 && c.priority <= 2.5));
  const backup = parseSession(JSON.stringify(state));
  assert.deepEqual(backup.picks, state.picks);
});

test('shooting percentages aggregate attempts and projected games; lower turnovers help', () => {
  const state = { ...createInitialState(), players: players.map(p => ({ ...p })), source };
  state.players[0] = { ...players[0]!, games: 40, fgm: 5, fga: 10 };
  state.players[1] = { ...players[1]!, games: 80, fgm: 8, fga: 20 };
  state.picks = [0, 1].map((n, i) => ({ playerId: players[n]!.id, team: state.settings.myPosition, overall: i + 1 }));
  const a = analyzeDraft(state);
  assert.equal(a.categories.find(c => c.key === 'fg')!.value, (5 * 40 + 8 * 80) / (10 * 40 + 20 * 80));
  const same = state.players.slice(2, 4);
  same[0] = { ...players[2]!, turnovers: 1 };
  same[1] = { ...same[0], id: players[3]!.id, turnovers: 4 };
  const comparison = analyzeDraft({ ...state, players: [...state.players.slice(0, 2), ...same, ...state.players.slice(4)] });
  const low = comparison.recommendations.find(r => r.player.id === same[0]!.id)!;
  const high = comparison.recommendations.find(r => r.player.id === same[1]!.id)!;
  assert.ok(low.categoryZ.turnovers > high.categoryZ.turnovers);
});

test('injury uncertainty affects fit ranking without overwriting projected games', () => {
  const state = { ...createInitialState(), players: players.map(p => ({ ...p })), source };
  const a = analyzeDraft(state);
  const top = a.recommendations[0]!;
  state.players = state.players.map(p => p.id === top.player.id ? { ...p, injuryStatus: 'Out', injuryNote: 'Check this report.' } : p);
  const after = analyzeDraft(state).recommendations.find(r => r.player.id === top.player.id)!;
  assert.ok(after.score <= top.score);
  assert.equal(after.player.games, top.player.games);
  assert.ok(after.warnings.some(w => w.includes('uncertainty discount')));
});

test('roster matching handles flexible positions and refuses extra roster capacity', () => {
  const center = { ...players[0]!, positions: ['C'] as Player['positions'] };
  const flex = { ...players[1]!, positions: ['PG', 'C'] as Player['positions'] };
  assert.equal(assignRoster([flex, center], ['C', 'PG']).fitted, 2);
  assert.equal(assignRoster([flex, center, players[2]!], ['C', 'PG']).fitted, 2);
});

test('legacy backups retain picks and default to the new independent manual workflow', () => {
  const state = createInitialState();
  delete state.settings.trackingMode;
  state.picks = [{ playerId: state.players[0]!.id, team: 1, overall: 1 }];
  const restored = parseSession(JSON.stringify(state));
  assert.equal(restored.settings.trackingMode, 'manual');
  assert.deepEqual(restored.picks, state.picks);
});

test('store actions persist picks, correct earlier marks and refresh data without deleting the draft', async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) }, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: { addEventListener() {} }, configurable: true });
  const { draftActions: d, getDraftSnapshot: get } = await import('../src/hooks/use-draft');
  d.loadCurrentProjections(players, source);
  d.markPick('test-0', 'taken');
  d.markPick('test-1', 'mine');
  d.markPick('test-2', 'taken');
  assert.equal(get().analysis.roster[0]!.id, 'test-1');
  assert.throws(() => d.markPick('test-1', 'taken'), /already/);
  d.undraftPlayer('test-0');
  assert.deepEqual(get().state.picks.map(p => [p.playerId, p.overall]), [['test-1', 1], ['test-2', 2]]);
  d.undoPick();
  assert.equal(get().state.picks.length, 1);
  d.updatePlayerPositions('test-2', ['PG', 'SG']);
  const newSource = { ...source, fetchedAt: new Date().toISOString() };
  d.loadCurrentProjections(players.map(p => ({ ...p, id: `new-provider-${p.id}`, points: p.points + 1 })), newSource);
  assert.equal(get().state.picks[0]!.playerId, 'test-1');
  assert.equal(get().analysis.roster[0]!.points, players[1]!.points + 1);
  assert.deepEqual(get().state.players.find(p => p.id === 'test-2')!.positions, ['PG', 'SG']);
  assert.equal(get().state.players.find(p => p.id === 'test-2')!.positionsVerified, true);
  d.applyInjuries([{ name: 'Test Player 1', status: 'Out', note: 'Dated report.', source: 'Synthetic source' }], new Date().toISOString());
  assert.equal(get().analysis.roster[0]!.injuryStatus, 'Out');
  d.applyInjuries([], new Date().toISOString());
  assert.equal(get().analysis.roster[0]!.injuryStatus, undefined);
  assert.equal(get().state.picks.length, 1);
  const restored = parseSession(d.exportSession());
  assert.deepEqual(restored.picks, get().state.picks);
  assert.ok(storage.has('nine-cat-draft-v1'));
  d.toggleShortlist('test-3');
  const beforeReset = get().state;
  d.resetDraft();
  assert.deepEqual(get().state.picks, []);
  assert.deepEqual(get().state.shortlist, []);
  assert.strictEqual(get().state.players, beforeReset.players);
  assert.strictEqual(get().state.source, beforeReset.source);
  assert.strictEqual(get().state.injuryFeed, beforeReset.injuryFeed);
  assert.deepEqual(get().state.settings, beforeReset.settings);
  assert.equal(get().analysis.roster.length, 0);
  assert.equal(get().analysis.rosterAssignment.filter(s => !s.player).length, 12);
  assert.equal(get().analysis.recommendations.length, players.length);
  assert.deepEqual(parseSession(storage.get('nine-cat-draft-v1')!).picks, []);
  // Injury reserves must not make Mine accept a thirteenth draft pick.
  for (const p of get().state.players.slice(0, 12)) d.markPick(p.id, 'mine');
  assert.equal(get().analysis.complete, true);
  assert.throws(() => d.markPick(get().state.players[12]!.id, 'mine'), /full/);
  d.markPick(get().state.players[12]!.id, 'taken');
  assert.equal(get().state.picks.length, 13);
  d.resetDraft();
  assert.equal(get().analysis.complete, false);
  assert.equal(get().state.picks.length, 0);
});

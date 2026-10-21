import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSeasonActuals, createSeasonActualsService } from '../src/lib/season-actuals';

const fetchedAt = '2026-10-21T12:00:00Z';
const stats = { 0: 100, 1: 2, 2: 3, 3: 20, 6: 24, 11: 8, 13: 35, 14: 70, 15: 20, 16: 25, 17: 10, 42: 4 };
const profile = (id: number) => ({ player: { id, fullName: `Sample ${id}`, stats: [
  { seasonId: 2027, statSourceId: 0, statSplitTypeId: 0, scoringPeriodId: 0, stats: { ...stats } },
  { seasonId: 2027, statSourceId: 1, statSplitTypeId: 0, scoringPeriodId: 0, stats: { ...stats, 0: 999 } },
] } });
const payload = () => ({ players: Array.from({ length: 150 }, (_, i) => profile(i + 1)) });

test('actual rates use exact current-season actual totals / real GP, not projections or rounded percentages', () => {
  const data = payload();
  const feed = parseSeasonActuals(data, 2027, fetchedAt);
  const p = feed.players[0]!;
  assert.equal(p.points, 25); assert.equal(p.fgm, 8.75); assert.equal(p.fga, 17.5);
  assert.equal(p.ftm, 5); assert.equal(p.fta, 6.25); assert.equal(p.gamesPlayed, 4);
  assert.equal(feed.season, '2026-27'); assert.equal(feed.fetchedAt, fetchedAt);
  assert.equal(feed.statsThroughDate, null, 'Never fabricate an included-game date from fetch time');
  assert.deepEqual(data, payload(), 'Parser must not mutate provider data');
});

test('zero/no games and incomplete rows are omitted, never turned into all-zero players', () => {
  const data = payload();
  data.players[0]!.player.stats[0]!.stats[42] = 0;
  data.players[1]!.player.stats[0]!.stats = {} as typeof stats;
  delete (data.players[2]!.player.stats[0]!.stats as Record<number, number>)[14];
  const feed = parseSeasonActuals(data, 2027, fetchedAt);
  assert.equal(feed.players.length, 147); assert.equal(feed.skippedPlayers, 3);
  assert.equal(feed.players.some(p => p.id === 'espn-1'), false);
  for (const row of data.players) row.player.stats[0]!.stats = {} as typeof stats;
  assert.equal(parseSeasonActuals(data, 2027, fetchedAt).players.length, 0, 'A verified preseason feed may have no actual games yet');
});

test('historical years, projections and daily splits cannot masquerade as season-to-date actuals', () => {
  for (const change of [{ seasonId: 2026 }, { statSourceId: 1 }, { statSplitTypeId: 1 }, { scoringPeriodId: 1 }]) {
    const data = payload();
    for (const p of data.players) p.player.stats = [{ ...p.player.stats[0]!, ...change }];
    assert.throws(() => parseSeasonActuals(data, 2027, fetchedAt), /coverage/);
  }
});

test('actuals reject ambiguous identities, inconsistent shooting and partial coverage', () => {
  const data = payload();
  data.players[1]!.player.id = 1;
  assert.throws(() => parseSeasonActuals(data, 2027, fetchedAt), /identities/);
  assert.throws(() => parseSeasonActuals({ players: [profile(1)] }, 2027, fetchedAt), /coverage/);
  const bad = payload(); bad.players[0]!.player.stats[0]!.stats[13] = 100;
  assert.throws(() => parseSeasonActuals(bad, 2027, fetchedAt), /shooting/);
  const sparse = payload();
  const s = sparse.players[0]!.player.stats[0]!.stats;
  delete (s as Record<number, number>)[17]; s[0] = 2 * s[13] + s[15];
  assert.equal(parseSeasonActuals(sparse, 2027, fetchedAt).players[0]!.threes, 0);
});

test('actuals service requests actual profiles and coalesces/caches a validated feed', async () => {
  let calls = 0;
  const service = createSeasonActualsService(async (url, options) => {
    calls++;
    const season = Number(String(url).match(/seasons\/(\d+)/)?.[1]);
    const data = payload();
    for (const p of data.players) for (const s of p.player.stats) s.seasonId = season;
    assert.deepEqual(JSON.parse((options!.headers as Record<string, string>)['X-Fantasy-Filter']!).players.filterStatsForTopScoringPeriodIds.additionalValue, [`00${season}`]);
    return Response.json(data);
  });
  const [a, b] = await Promise.all([service(), service()]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  await service(); assert.equal(calls, 1);
});

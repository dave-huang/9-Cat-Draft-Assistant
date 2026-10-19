import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDraftDataService, nbaSeasonEnd, parseEspnInjuries, parseEspnProjections } from '../src/lib/draft-data';

const checkedAt = '2026-10-19T12:00:00.000Z';
const teams = { settings: { proTeams: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, abbrev: `T${i + 1}` })) } };
function profile(id: number, changes: Record<string, unknown> = {}) {
  return { player: { id, fullName: `Synthetic Player ${id}`, proTeamId: 1, eligibleSlots: [0, 1, 5, 11],
    ownership: { averageDraftPosition: 20 },
    stats: [{ seasonId: 2027, statSourceId: 1, statSplitTypeId: 0,
      stats: { 0: 1600, 1: 40, 2: 80, 3: 400, 6: 320, 11: 160, 13: 560, 14: 1120, 15: 320, 16: 400, 17: 160, 42: 80 }, ...changes }],
  } };
}
const payload = () => ({ players: Array.from({ length: 160 }, (_, i) => profile(i + 1)) });

test('current season and full-season forecast totals convert without historical or percentage substitutes', () => {
  assert.equal(nbaSeasonEnd(new Date(checkedAt)), 2027);
  const feed = parseEspnProjections(payload(), teams, 2027, checkedAt);
  assert.equal(feed.players.length, 160);
  const p = feed.players[0]!;
  assert.equal(p.points, 20);
  assert.equal(p.fgm, 7);
  assert.equal(p.fga, 14);
  assert.equal(p.games, 80);
  assert.deepEqual(p.positions, ['PG', 'SG']);
  assert.equal(feed.source.updatedAt, undefined);
  assert.equal(feed.source.fetchedAt, checkedAt);
  assert.equal(feed.source.positionsPlatform, 'ESPN');
  assert.equal(feed.source.adpPlatform, 'ESPN');
  for (const changes of [{ statSourceId: 0 }, { seasonId: 2026 }, { statSplitTypeId: 1 }]) {
    const bad = payload();
    for (const entry of bad.players) Object.assign(entry.player.stats[0]!, changes);
    assert.throws(() => parseEspnProjections(bad, teams, 2027, checkedAt), /incomplete/);
  }
});

test('zero-three centers stay on the board only when exact season totals independently prove zero', () => {
  const d = payload();
  const stats = d.players[0]!.player.stats[0]!.stats as Record<number, number>;
  delete stats[17]; stats[0] = 2 * stats[13]! + stats[15]!;
  const feed = parseEspnProjections(d, teams, 2027, checkedAt);
  assert.equal(feed.players.find(p => p.id === 'espn-1')?.threes, 0);
  delete stats[14];
  const incomplete = parseEspnProjections(d, teams, 2027, checkedAt);
  assert.equal(incomplete.players.some(p => p.id === 'espn-1'), false);
  assert.equal(incomplete.skippedPlayers, 1);
});

test('invalid shooting, duplicate identities, undersized data and team metadata fail explicitly', () => {
  const d = payload();
  d.players[0]!.player.stats[0]!.stats[13] = 2000;
  assert.throws(() => parseEspnProjections(d, teams, 2027, checkedAt), /inconsistent/);
  const duplicate = payload();
  duplicate.players[1]!.player.id = duplicate.players[0]!.player.id;
  assert.throws(() => parseEspnProjections(duplicate, teams, 2027, checkedAt), /identities/);
  assert.throws(() => parseEspnProjections({ players: [profile(1)] }, teams, 2027, checkedAt), /incomplete/);
  assert.throws(() => parseEspnProjections(payload(), {}, 2027, checkedAt), /metadata/);
});

test('injury report dates are separate from fetch time, with current-season and freshness enforcement', () => {
  const d = { status: 'success', season: { year: 2027 }, timestamp: '2026-10-19T11:59:00Z',
    injuries: [{ injuries: [{ status: 'Out', date: '2026-10-18T12:00Z', shortComment: 'A dated injury note.',
      athlete: { displayName: 'Synthetic Player 1' }, details: { returnDate: '2026-11-01' } }] }] };
  const feed = parseEspnInjuries(d, checkedAt, 2027);
  assert.equal(feed.checkedAt, checkedAt);
  assert.equal(feed.reportUpdatedAt, '2026-10-19T11:59:00.000Z');
  assert.equal(feed.reports[0]!.updatedAt, '2026-10-18T12:00:00.000Z');
  assert.equal(feed.reports[0]!.returnDate, '2026-11-01');
  assert.throws(() => parseEspnInjuries({ ...d, timestamp: '2026-10-16' }, checkedAt, 2027), /fresh/);
  assert.throws(() => parseEspnInjuries({ ...d, season: { year: 2026 } }, checkedAt, 2027), /season/);
  assert.throws(() => parseEspnInjuries({}, checkedAt, 2027), /format/);
});

test('concurrent projections share provider requests and cached data is not re-fetched', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async url => {
    calls++;
    return Response.json(String(url).includes('leaguedefaults') ? payload() : teams);
  };
  const service = createDraftDataService(fetcher);
  const [a, b] = await Promise.all([service.projections(), service.projections()]);
  assert.strictEqual(a, b);
  assert.equal(calls, 2);
  await service.projections();
  assert.equal(calls, 2);
});

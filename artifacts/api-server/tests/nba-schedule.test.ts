import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScheduleService, parseScheduleDay, scheduleDates } from '../src/lib/nba-schedule';
import { nbaSeasonEnd } from '../src/lib/draft-data';

const season = nbaSeasonEnd(), startYear = season - 1, day = `${startYear}-10-20`;
function payload(id = '123') {
  return { leagues: [{ slug: 'nba', season: { year: season } }], events: [{
    id, date: `${startYear}-10-21T02:00:00Z`, season: { year: season, type: 2 },
    status: { type: { name: 'STATUS_SCHEDULED' } },
    competitions: [{ competitors: [
      { homeAway: 'home', team: { abbreviation: 'BOS' } }, { homeAway: 'away', team: { abbreviation: 'NY' } },
    ] }],
  }] };
}
test('validates inclusive dates and limits requests to 14 days/current season', () => {
  assert.equal(scheduleDates(day, `${startYear}-11-02`).length, 14);
  for (const [a, b] of [[day, `${startYear}-11-03`], ['bad', day], [`${startYear}-02-30`, day], [day, `${startYear}-10-19`]]) assert.throws(() => scheduleDates(a, b));
});
test('late UTC games belong to the correct Eastern day; status and regular season are checked', () => {
  const parsed = parseScheduleDay(payload(), day);
  assert.equal(parsed[0]!.date, day);
  assert.equal(parsed[0]!.status, 'scheduled');
  assert.throws(() => parseScheduleDay(payload(), `${startYear}-10-21`), /date/);
  const postponed = payload();
  postponed.events[0]!.status.type.name = 'STATUS_POSTPONED';
  assert.equal(parseScheduleDay(postponed, day)[0]!.status, 'postponed');
  const preseason = payload(); preseason.events[0]!.season.type = 1;
  assert.deepEqual(parseScheduleDay(preseason, day), []);
  const wrong = payload(); wrong.leagues[0]!.season.year--;
  assert.throws(() => parseScheduleDay(wrong, day), /season/);
  const unknown = payload(); unknown.events[0]!.status.type.name = 'UNKNOWN';
  assert.throws(() => parseScheduleDay(unknown, day), /unknown/);
});
test('checks every day, returns date-only strings (not Date objects), caches/coalesces and never accepts partial windows', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async url => {
    calls++;
    return Response.json(String(url).includes(`dates=${day.replaceAll('-', '')}`) ? payload() : { leagues: [{ slug: 'nba', season: { year: season } }], events: [] });
  };
  const get = createScheduleService(fetcher);
  const [a, b] = await Promise.all([get(day, `${startYear}-10-22`), get(day, `${startYear}-10-22`)]);
  assert.strictEqual(a, b); assert.equal(calls, 3); assert.equal(a.games.length, 1);
  assert.equal(a.start, day); assert.equal(a.games[0]!.date, day);
  const bad: typeof fetch = async url => String(url).includes(`dates=${day.replaceAll('-', '')}`) ? Response.json(payload()) : new Response('Unavailable', { status: 503 });
  await assert.rejects(createScheduleService(bad)(day, `${startYear}-10-22`), /unavailable/);
  await assert.rejects(createScheduleService(async () => Response.json(payload()))(day, `${startYear}-10-21`));
});

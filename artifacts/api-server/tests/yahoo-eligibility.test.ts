import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createYahooEligibilityService, parseYahooEligibilityPage, yahooPublicGameId } from '../src/lib/yahoo-eligibility';
import { nbaSeasonEnd } from '../src/lib/draft-data';

const year = nbaSeasonEnd() - 1;
const bootstrap = '<script>var sportCode = "nba"; var leagueId = null; var gameId = "900"; var tableResourceKey = "publicDraftAnalysis";</script>';
function page(start = 0, count = 200) {
  return { fantasy_content: { league: { game_code: 'nba', season: String(year),
    settings: { roster_positions: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'Util'].map(position => ({ roster_position: { position } })) },
    'players:attributes': { count },
    players: Array.from({ length: count }, (_, i) => ({ player: {
      player_id: String(start + i + 1), player_key: `900.p.${start + i + 1}`,
      name: { full: `Test Player ${start + i}` }, eligible_positions: [{ position: 'PG' }, { position: 'SG' }, { position: 'G' }, { position: 'Util' }],
      eligible_positions_to_add: [{ position: 'SF' }, { position: 'PF' }, { position: 'C' }],
    } })),
  } } };
}

test('discovers only a numeric public NBA game ID, never executes scripts or follows provider-supplied URLs', () => {
  assert.equal(yahooPublicGameId(bootstrap), '900');
  for (const html of [bootstrap.replace('"nba"', '"nfl"'), bootstrap.replace('"900"', '"https://example.org/"'), bootstrap.replace('leagueId = null', 'leagueId = "private"'), '<html>Sign in</html>']) {
    assert.throws(() => yahooPublicGameId(html));
  }
});

test('reads actual eligible positions, not positions_to_add or generic flex slots', () => {
  const result = parseYahooEligibilityPage(page(), '900', year);
  assert.equal(result.length, 200);
  assert.deepEqual(result[0]!.positions, ['PG', 'SG']);
  assert.equal(result[0]!.yahooId, '1');
  const invalid = page();
  invalid.fantasy_content.league.players[0]!.player.eligible_positions = [{ position: 'G' }, { position: 'Util' }];
  assert.throws(() => parseYahooEligibilityPage(invalid, '900', year), /standard NBA/);
});

test('rejects a wrong season, mismatched identities, nonstandard league or incomplete page', () => {
  const d = page();
  assert.throws(() => parseYahooEligibilityPage(d, '900', year - 1), /season/);
  assert.throws(() => parseYahooEligibilityPage(d, '901', year), /invalid player/);
  d.fantasy_content.league['players:attributes'].count = 201;
  assert.throws(() => parseYahooEligibilityPage(d, '900', year), /incomplete/);
  const nonstandard = page();
  nonstandard.fantasy_content.league.settings.roster_positions = [{ roster_position: { position: 'G' } }];
  assert.throws(() => parseYahooEligibilityPage(nonstandard, '900', year), /standard NBA/);
});

test('fetches complete anonymous pagination and coalesces concurrent refreshes, without cookies or OAuth', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    assert.equal(new Headers(init?.headers).has('Cookie'), false);
    const u = String(url);
    if (u.includes('draftanalysis?')) return new Response(bootstrap);
    assert.ok(u.startsWith('https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/900.l.public;'));
    return Response.json(u.includes('start=0;') ? page(0, 200) : page(200, 25));
  };
  const load = createYahooEligibilityService(fetcher);
  const [a, b] = await Promise.all([load(), load()]);
  assert.strictEqual(a, b);
  assert.equal(a.players.length, 225);
  assert.equal(calls, 3);
  assert.equal(a.season, `${year}-${String(year + 1).slice(-2)}`);
  await load();
  assert.equal(calls, 3);
});

test('rejects repeated pagination, undersized results and denied access instead of returning fake eligibility', async () => {
  const repeated: typeof fetch = async url => String(url).includes('draftanalysis?') ? new Response(bootstrap) : Response.json(page());
  await assert.rejects(createYahooEligibilityService(repeated)(), /repeated/);
  const small: typeof fetch = async url => String(url).includes('draftanalysis?') ? new Response(bootstrap) : Response.json(page(0, 30));
  await assert.rejects(createYahooEligibilityService(small)());
  let calls = 0;
  const denied: typeof fetch = async () => { calls++; return new Response('Unavailable', { status: 403 }); };
  const load = createYahooEligibilityService(denied);
  await assert.rejects(load(), /unavailable/);
  await assert.rejects(load());
  assert.equal(calls, 1);
});

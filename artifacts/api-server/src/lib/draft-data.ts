import {
  GetDraftInjuriesResponse, GetDraftProjectionsResponse,
  type DraftInjuryFeed, type DraftProjectionFeed, type DraftProjectionPlayer,
} from '@workspace/api-zod';

const ESPN = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons';
const INJURIES = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';
type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const text = (v: unknown, max = 2000): string => typeof v === 'string' ? v.replace(/<[^>]*>/g, '').slice(0, max) : '';
const date = (v: unknown): string | undefined => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined;

export function nbaSeasonEnd(now = new Date()) {
  return now.getUTCFullYear() + (now.getUTCMonth() >= 7 ? 1 : 0);
}

/** Only source=1, full-season split=0, exact-season projections are allowed.
 * ESPN stat IDs: 0 PTS, 1 BLK, 2 STL, 3 AST, 6 REB, 11 TO,
 * 13/14 FGM/FGA, 15/16 FTM/FTA, 17 3PM, 42 GP.
 * Divide explicit season totals by explicit projected GP, never percentages.
 */
export function parseEspnProjections(payload: unknown, teamsPayload: unknown, season: number, fetchedAt: string): DraftProjectionFeed {
  const root = object(payload);
  if (!Array.isArray(root.players)) throw new Error('Projection provider returned an unexpected format.');
  const teams = new Map(array(object(object(teamsPayload).settings).proTeams).map(v => {
    const t = object(v);
    return [Number(t.id), text(t.abbrev, 15)] as const;
  }));
  if (teams.size < 30) throw new Error('NBA team metadata is unavailable.');
  const players: DraftProjectionPlayer[] = [];
  const seen = new Set<string>();
  let skippedPlayers = 0;
  for (const entry of root.players) {
    const p = object(object(entry).player);
    const projection = array(p.stats).map(object).find(s => s.seasonId === season && s.statSourceId === 1 && s.statSplitTypeId === 0);
    const s = { ...object(projection?.stats) };
    // ESPN omits the 3PM key for zero-three forecasts. Do not blindly default
    // missing statistics to zero: accept this case only when explicit integer
    // season totals independently prove it (PTS = 2*FGM + FTM + 3PM).
    if (s['17'] === undefined && ['0', '13', '15'].every(k => typeof s[k] === 'number' && Number.isInteger(s[k])) &&
        Number(s['0']) === 2 * Number(s['13']) + Number(s['15'])) s['17'] = 0;
    const games = Number(s['42']);
    const name = text(p.fullName, 120);
    const team = teams.get(Number(p.proTeamId));
    const positions = array(p.eligibleSlots)
      .filter((slot): slot is number => Number.isInteger(slot) && Number(slot) >= 0 && Number(slot) <= 4)
      .map(slot => (['PG', 'SG', 'SF', 'PF', 'C'] as const)[slot]!);
    const keys = { points: '0', blocks: '1', steals: '2', assists: '3', rebounds: '6', turnovers: '11', fgm: '13', fga: '14', ftm: '15', fta: '16', threes: '17' } as const;
    if (!name || !team || !positions.length || !Number.isFinite(games) || games < 1 || games > 82 ||
        Object.values(keys).some(k => typeof s[k] !== 'number' || !Number.isFinite(s[k]) || Number(s[k]) < 0)) {
      skippedPlayers++;
      continue;
    }
    const stats = Object.fromEntries(Object.entries(keys).map(([k, id]) => [k, Number(s[id]) / games])) as Pick<DraftProjectionPlayer, keyof typeof keys>;
    if (Object.values(stats).some(v => v > 100) || stats.fgm > stats.fga || stats.ftm > stats.fta || stats.threes > stats.fgm) throw new Error('Projection provider returned inconsistent shooting stats.');
    const id = `espn-${Number(p.id)}`;
    if (!Number.isSafeInteger(p.id) || seen.has(id)) throw new Error('Projection provider returned ambiguous player identities.');
    seen.add(id);
    const adp = object(p.ownership).averageDraftPosition;
    players.push({ id, name, team, positions: [...new Set(positions)], games, ...stats,
      ...(typeof adp === 'number' && Number.isFinite(adp) && adp > 0 && adp <= 5000 ? { adp } : {}),
    });
  }
  if (players.length < 150) throw new Error('Current-season projection coverage is incomplete. No historical stats were substituted.');
  return GetDraftProjectionsResponse.parse({
    players, skippedPlayers,
    source: {
      label: 'ESPN full-season projections', season: `${season - 1}-${String(season).slice(-2)}`,
      provider: 'ESPN', positionsPlatform: 'ESPN', adpPlatform: 'ESPN',
      fetchedAt, url: 'https://fantasy.espn.com/basketball/players/projections', isDemo: false,
      // The public API has no per-forecast publication timestamp. A retrieval
      // time must never be silently presented as the forecast update date.
    },
  });
}

export function parseEspnInjuries(payload: unknown, checkedAt: string, season = nbaSeasonEnd()): DraftInjuryFeed {
  const root = object(payload);
  if (root.status !== 'success' || !Array.isArray(root.injuries)) throw new Error('Injury provider returned an unexpected format.');
  if (object(root.season).year !== season) throw new Error('Injury reports are not for the current NBA season.');
  const reportUpdatedAt = date(root.timestamp);
  if (!reportUpdatedAt || Date.parse(checkedAt) - Date.parse(reportUpdatedAt) > 24 * 60 * 60 * 1000) {
    throw new Error('The injury provider has not published a fresh report. Previous injury notes were kept.');
  }
  const reports: DraftInjuryFeed['reports'] = [];
  for (const team of root.injuries) {
    if (!Array.isArray(object(team).injuries)) throw new Error('Injury provider returned incomplete team reports.');
    for (const value of object(team).injuries as unknown[]) {
      const r = object(value), athlete = object(r.athlete);
      const name = text(athlete.displayName, 120), status = text(r.status, 80);
      if (!name || !status) throw new Error('Injury provider returned an incomplete player report.');
      const source = array(athlete.links).map(object).find(l => typeof l.href === 'string' && l.href.startsWith('https://www.espn.com/nba/player/'));
      reports.push({ name, status, note: text(r.shortComment || r.longComment),
        source: source ? text(source.href, 300) : 'https://www.espn.com/nba/injuries',
        ...(date(r.date) ? { updatedAt: date(r.date) } : {}),
        ...(date(object(r.details).returnDate) ? { returnDate: text(object(r.details).returnDate, 40) } : {}),
      });
    }
  }
  return GetDraftInjuriesResponse.parse({ reports, checkedAt, reportUpdatedAt, source: 'https://www.espn.com/nba/injuries' });
}

async function providerJson(url: string, fetcher: typeof fetch, headers?: Record<string, string>): Promise<unknown> {
  const response = await fetcher(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (response.status !== 200 || !response.body) throw new Error('The public data provider is unavailable. Your saved draft is unchanged.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8_000_000) { await reader.cancel(); throw new Error('Provider response exceeded the safe size limit.'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { reader.releaseLock(); }
}

/** Coalesce concurrent anonymous requests; never label a cached failure as data. */
function cached<T>(ttl: number, load: () => Promise<T>): () => Promise<T> {
  let value: T | undefined, until = 0, pending: Promise<T> | undefined;
  let failureUntil = 0;
  return async () => {
    if (value !== undefined && Date.now() < until) return value;
    if (Date.now() < failureUntil) throw new Error('The public data provider is temporarily unavailable. Retry in a minute; your saved board is unchanged.');
    if (pending) return pending;
    pending = load().then(v => { value = v; until = Date.now() + ttl; failureUntil = 0; return v; })
      .catch((error: unknown) => { failureUntil = Date.now() + 30_000; throw error; })
      .finally(() => { pending = undefined; });
    return pending;
  };
}

export function createDraftDataService(fetcher: typeof fetch = fetch) {
  return {
    projections: cached(15 * 60_000, async () => {
      const season = nbaSeasonEnd();
      const filter = { players: { limit: 700, filterStatsForTopScoringPeriodIds: { value: 5, additionalValue: [`10${season}`] }, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'STANDARD' } } };
      const [players, teams] = await Promise.all([
        providerJson(`${ESPN}/${season}/segments/0/leaguedefaults/3?view=kona_player_info`, fetcher, { 'X-Fantasy-Filter': JSON.stringify(filter) }),
        providerJson(`${ESPN}/${season}?view=proTeamSchedules_wl`, fetcher),
      ]);
      return parseEspnProjections(players, teams, season, new Date().toISOString());
    }),
    injuries: cached(2 * 60_000, async () => parseEspnInjuries(await providerJson(INJURIES, fetcher), new Date().toISOString())),
  };
}

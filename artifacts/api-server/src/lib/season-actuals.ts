import { GetSeasonActualsResponse, type SeasonActualsFeed, type SeasonActualsPlayer } from '@workspace/api-zod';
import { cached, nbaSeasonEnd, providerJson } from './draft-data';

const keys = { points: '0', blocks: '1', steals: '2', assists: '3', rebounds: '6', turnovers: '11',
  fgm: '13', fga: '14', ftm: '15', fta: '16', threes: '17' } as const;
type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};

/** ESPN fantasy's source=0, split=0, period=0 is regular-season actual totals.
 * Never use source=1 forecasts, historical seasons, daily splits or rounded percentages.
 * No positive-GP coverage minimum: an opening-night or preseason feed can be valid.
 */
export function parseSeasonActuals(payload: unknown, season: number, fetchedAt: string): SeasonActualsFeed {
  const root = object(payload);
  if (!Array.isArray(root.players) || root.players.length < 150 || root.players.length > 3000)
    throw new Error('Current-season actual-stat player coverage is incomplete.');
  const players: SeasonActualsPlayer[] = [];
  const seen = new Set<string>();
  let skippedPlayers = 0, currentProfiles = 0;
  for (const entry of root.players) {
    const p = object(object(entry).player);
    if (!Number.isSafeInteger(p.id) || Number(p.id) <= 0) throw new Error('Actual-stat player identity is invalid.');
    const id = `espn-${p.id}`;
    if (seen.has(id)) throw new Error('Actual-stat player identities are ambiguous.');
    seen.add(id);
    const profiles = (Array.isArray(p.stats) ? p.stats : []).map(object).filter(s =>
      s.seasonId === season && s.statSourceId === 0 && s.statSplitTypeId === 0 && s.scoringPeriodId === 0);
    if (profiles.length > 1) throw new Error('Actual-stat season totals are ambiguous.');
    if (profiles.length) currentProfiles++;
    const stats = { ...object(profiles[0]?.stats) };
    const gp = stats['42'];
    const name = typeof p.fullName === 'string' ? p.fullName.replace(/<[^>]*>/g, '').trim().slice(0, 120) : '';
    // Only derive an absent zero 3PM when independent integer totals prove zero.
    if (stats['17'] === undefined && ['0', '13', '15'].every(k => Number.isInteger(stats[k])) &&
        Number(stats['0']) === 2 * Number(stats['13']) + Number(stats['15'])) stats['17'] = 0;
    if (!name || !Number.isInteger(gp) || Number(gp) < 1 || Number(gp) > 100 ||
        Object.values(keys).some(k => typeof stats[k] !== 'number' || !Number.isInteger(stats[k]) || Number(stats[k]) < 0)) {
      skippedPlayers++;
      continue;
    }
    const line = Object.fromEntries(Object.entries(keys).map(([key, statId]) => [key, Number(stats[statId]) / Number(gp)])) as Pick<SeasonActualsPlayer, keyof typeof keys>;
    if (Object.values(line).some(n => !Number.isFinite(n) || n > 100) ||
        line.fgm > line.fga || line.ftm > line.fta || line.threes > line.fgm)
      throw new Error('Actual-stat shooting totals are inconsistent.');
    players.push({ id, name, gamesPlayed: Number(gp), ...line });
  }
  if (currentProfiles < 150) throw new Error('Current-season full-season actual-stat coverage could not be verified.');
  return GetSeasonActualsResponse.parse({
    players, skippedPlayers, totalPlayers: root.players.length,
    season: `${season - 1}-${String(season).slice(-2)}`, label: 'ESPN season-to-date regular-season averages',
    provider: 'ESPN', fetchedAt,
    // ESPN's aggregate profiles have no last-included-game timestamp. Never
    // fabricate a stats-through date from retrieval time or the schedule.
    statsThroughDate: null,
  });
}

export function createSeasonActualsService(fetcher: typeof fetch = fetch) {
  return cached(15 * 60_000, async () => {
    const season = nbaSeasonEnd();
    const filter = { players: { limit: 700, filterStatsForTopScoringPeriodIds: { value: 5, additionalValue: [`00${season}`] },
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'STANDARD' } } };
    const payload = await providerJson(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`,
      fetcher, { 'X-Fantasy-Filter': JSON.stringify(filter) });
    return parseSeasonActuals(payload, season, new Date().toISOString());
  });
}

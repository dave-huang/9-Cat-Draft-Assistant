import { GetNbaScheduleResponse, type NbaGame } from '@workspace/api-zod';
import { cached, nbaSeasonEnd, providerJson } from './draft-data';
const DAY = 86400000;
type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
export function scheduleDates(start: unknown, end: unknown): string[] {
  if (typeof start !== 'string' || typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('Choose ISO dates.');
  const a = Date.parse(`${start}T00:00:00Z`), b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || new Date(a).toISOString().slice(0, 10) !== start || new Date(b).toISOString().slice(0, 10) !== end ||
      b < a || b - a >= 14 * DAY || a < Date.UTC(nbaSeasonEnd() - 1, 7, 1) || b > Date.UTC(nbaSeasonEnd(), 6, 31)) throw new Error('Choose 1–14 inclusive days in the current NBA season.');
  return Array.from({ length: (b - a) / DAY + 1 }, (_, i) => new Date(a + i * DAY).toISOString().slice(0, 10));
}
const EASTERN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export function parseScheduleDay(payload: unknown, requestedDate: string): NbaGame[] {
  const root = object(payload);
  if (!Array.isArray(root.events) || !Array.isArray(root.leagues) || !root.leagues.some(v => object(v).slug === 'nba' && object(object(v).season).year === nbaSeasonEnd())) throw new Error('NBA schedule is malformed or from a different season.');
  const games: NbaGame[] = [];
  for (const entry of root.events) {
    const event = object(entry), season = object(event.season);
    if (![1, 2, 3, 4, 5].includes(Number(season.type))) throw new Error('NBA season type is missing or unknown.');
    if (Number(season.type) !== 2) continue; // fantasy regular season, not preseason/exhibitions
    if (season.year !== nbaSeasonEnd() || typeof event.id !== 'string' || !/^\d+$/.test(event.id) || typeof event.date !== 'string' || !Number.isFinite(Date.parse(event.date))) throw new Error('NBA game identity or date is invalid.');
    const date = EASTERN_DATE.format(new Date(event.date));
    if (date !== requestedDate) throw new Error('Schedule response did not match the requested Eastern game date.');
    const competitions = event.competitions;
    if (!Array.isArray(competitions) || competitions.length !== 1) throw new Error('NBA competition is incomplete.');
    const c = object(competitions[0]);
    if (!Array.isArray(c.competitors) || c.competitors.length !== 2) throw new Error('NBA teams are incomplete.');
    const team = (side: string) => object(object((c.competitors as unknown[]).find(v => object(v).homeAway === side)).team).abbreviation;
    const homeTeam = team('home'), awayTeam = team('away');
    const statusName = object(object(c.status ?? event.status).type).name;
    const statuses: Record<string, NbaGame['status']> = {
      STATUS_SCHEDULED: 'scheduled', STATUS_IN_PROGRESS: 'in-progress', STATUS_HALFTIME: 'in-progress',
      STATUS_END_PERIOD: 'in-progress', STATUS_FINAL: 'final', STATUS_FINAL_OVERTIME: 'final',
      STATUS_POSTPONED: 'postponed', STATUS_CANCELED: 'canceled', STATUS_DELAYED: 'scheduled',
      STATUS_SUSPENDED: 'postponed',
    };
    if (typeof homeTeam !== 'string' || typeof awayTeam !== 'string' || homeTeam === awayTeam || !/^[A-Z]{2,4}$/.test(homeTeam) || !/^[A-Z]{2,4}$/.test(awayTeam) || typeof statusName !== 'string' || !statuses[statusName]) throw new Error('NBA team or game status is unknown.');
    games.push({ id: event.id, date, homeTeam, awayTeam, status: statuses[statusName]! });
  }
  return games;
}
export function createScheduleService(fetcher: typeof fetch = fetch) {
  const windows = new Map<string, () => Promise<ReturnType<typeof GetNbaScheduleResponse.parse>>>();
  return (start: string, end: string) => {
    const dates = scheduleDates(start, end), key = `${start}/${end}`;
    let load = windows.get(key);
    if (!load) {
      if (windows.size >= 24) windows.delete(windows.keys().next().value!);
      load = cached(5 * 60_000, async () => {
        const pages: NbaGame[][] = [];
        // Bounded concurrency, fail the entire window if any day fails.
        for (let i = 0; i < dates.length; i += 4) {
          pages.push(...await Promise.all(dates.slice(i, i + 4).map(async date => parseScheduleDay(
            await providerJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replaceAll('-', '')}&limit=1000`, fetcher), date))));
        }
        const games = pages.flat(), unique = new Set(games.map(g => g.id));
        if (unique.size !== games.length) throw new Error('NBA schedule repeated a game.');
        const endYear = nbaSeasonEnd();
        return GetNbaScheduleResponse.parse({ start, end, games, fetchedAt: new Date().toISOString(),
          season: `${endYear - 1}-${String(endYear).slice(-2)}`, source: 'https://www.espn.com/nba/schedule' });
      });
      windows.set(key, load);
    }
    return load();
  };
}

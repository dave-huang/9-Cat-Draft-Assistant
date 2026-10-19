import { GetDraftEligibilityResponse, type DraftEligibilityPlayer } from '@workspace/api-zod';
import { cached, nbaSeasonEnd } from './draft-data';

export const YAHOO_ELIGIBILITY_SOURCE = 'https://basketball.fantasysports.yahoo.com/nba/draftanalysis?pos=ALL';
const PUBLIC_READ = 'https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/';
const BASE_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};

/** Discover only the numeric NBA game ID from Yahoo's public page bootstrap.
 * Never evaluate scripts, follow an arbitrary provider URL or use user cookies.
 */
export function yahooPublicGameId(html: string) {
  if (!/var\s+sportCode\s*=\s*["']nba["']/.test(html) ||
      !/var\s+leagueId\s*=\s*null\s*;/.test(html) || !html.includes('publicDraftAnalysis')) {
    throw new Error('Yahoo public NBA page format changed.');
  }
  const id = html.match(/var\s+gameId\s*=\s*["'](\d{1,6})["']/)?.[1];
  if (!id) throw new Error('Yahoo public NBA game ID is unavailable.');
  return id;
}

export function parseYahooEligibilityPage(payload: unknown, gameId: string, seasonStart: number): DraftEligibilityPlayer[] {
  const league = obj(obj(payload).fantasy_content).league;
  const l = obj(league);
  if (l.game_code !== 'nba' || String(l.season) !== String(seasonStart)) throw new Error('Yahoo eligibility is not for the current NBA season.');
  const roster = Array.isArray(obj(l.settings).roster_positions) ? obj(l.settings).roster_positions as unknown[] : [];
  const slots = roster.map(r => obj(obj(r).roster_position).position);
  if (!BASE_POSITIONS.every(p => slots.includes(p))) throw new Error('Yahoo public league does not use standard NBA position eligibility.');
  if (!Array.isArray(l.players) || obj(l['players:attributes']).count !== l.players.length) throw new Error('Yahoo public eligibility page is incomplete.');
  return l.players.map(entry => {
    const p = obj(obj(entry).player), yahooId = String(p.player_id ?? ''), name = obj(p.name).full;
    if (!/^\d{1,10}$/.test(yahooId) || p.player_key !== `${gameId}.p.${yahooId}` ||
        typeof name !== 'string' || !name.trim() || name.length > 120 || !Array.isArray(p.eligible_positions)) {
      throw new Error('Yahoo eligibility contains an invalid player.');
    }
    // eligible_positions_to_add is NOT eligibility. G/F/Util are roster slots,
    // not additional base positions; do not infer PG from a generic G value.
    const eligible = p.eligible_positions.map(v => obj(v).position);
    const positions = BASE_POSITIONS.filter(pos => eligible.includes(pos));
    if (!positions.length) throw new Error('Yahoo player has no standard NBA eligible position.');
    return { yahooId, name: name.trim(), positions };
  });
}

async function readPublic(url: string, fetcher: typeof fetch, signal: AbortSignal, html = false): Promise<string> {
  const r = await fetcher(url, {
    headers: { Accept: html ? 'text/html' : 'application/json' },
    redirect: 'error', credentials: 'omit',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (r.status !== 200 || !r.body) throw new Error('Yahoo public eligibility is unavailable.');
  const reader = r.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > (html ? 2_000_000 : 8_000_000)) { await reader.cancel(); throw new Error('Yahoo public response is too large.'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}

/** This is the anonymous, read-only resource used by public Draft Analysis.
 * Private league OAuth and the user's Yahoo connection are never consulted.
 */
export function createYahooEligibilityService(fetcher: typeof fetch = fetch) {
  return cached(15 * 60_000, async () => {
    const signal = AbortSignal.timeout(55_000);
    const seasonEnd = nbaSeasonEnd(), seasonStart = seasonEnd - 1;
    const gameId = yahooPublicGameId(await readPublic(YAHOO_ELIGIBILITY_SOURCE, fetcher, signal, true));
    const players: DraftEligibilityPlayer[] = [], seen = new Set<string>();
    const pageSize = 200;
    let complete = false;
    for (let start = 0; start < 3000; start += pageSize) {
      const url = `${PUBLIC_READ}league/${gameId}.l.public;out=settings/players;position=ALL;start=${start};count=${pageSize};sort=average_pick?format=json_f`;
      const page = parseYahooEligibilityPage(JSON.parse(await readPublic(url, fetcher, signal)), gameId, seasonStart);
      for (const p of page) {
        if (seen.has(p.yahooId)) throw new Error('Yahoo pagination repeated a player; coverage cannot be verified.');
        seen.add(p.yahooId); players.push(p);
      }
      if (page.length < pageSize) { complete = true; break; }
    }
    if (!complete) throw new Error('Yahoo pagination did not finish.');
    return GetDraftEligibilityResponse.parse({
      players, season: `${seasonStart}-${String(seasonEnd).slice(-2)}`,
      gameId, source: YAHOO_ELIGIBILITY_SOURCE, fetchedAt: new Date().toISOString(),
    });
  });
}

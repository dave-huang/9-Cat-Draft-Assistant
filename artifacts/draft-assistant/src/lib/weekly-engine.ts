import type { NbaSchedule } from '@workspace/api-client-react';
import { assignRoster } from './draft-engine';
import { CATEGORY_KEYS, type CategoryKey, type CategoryValues, type DraftState, type Player, type RosterSlot, type WeeklyPlannerState } from './draft-types';

const DAY = 86400000;
export function matchupDates(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  const date = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return { start: date.toISOString().slice(0, 10), end: new Date(+date + 6 * DAY).toISOString().slice(0, 10) };
}
export function validMatchupDates(start: string, end: string) {
  const a = Date.parse(`${start}T00:00:00Z`), b = Date.parse(`${end}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) &&
    Number.isFinite(a) && Number.isFinite(b) && new Date(a).toISOString().slice(0, 10) === start &&
    new Date(b).toISOString().slice(0, 10) === end && b >= a && b - a < 14 * DAY;
}
export function createMatchup(state: DraftState): WeeklyPlannerState {
  return { ...matchupDates(), myRosterIds: state.picks.filter(p => p.team === state.settings.myPosition).map(p => p.playerId),
    myReserveIds: [], opponentRosterIds: [], opponentStarterIds: [], expectedGames: {} };
}
const ALIASES: Record<string, string> = { GS: 'GSW', NY: 'NYK', NO: 'NOP', SA: 'SAS', WSH: 'WAS', UTAH: 'UTA', PHO: 'PHX' };
const TEAMS = new Set('ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split(' '));
export const canonicalTeam = (team: string) => ALIASES[team.toUpperCase()] ?? team.toUpperCase();
export interface WeeklyPlayer {
  player: Player;
  scheduledGames: number;
  expectedGames: number;
  dates: string[];
  override: boolean;
  reserve?: boolean;
  schedulePending?: boolean;
  warning?: string;
}
export interface WeeklyTotals extends CategoryValues {
  fgm: number; fga: number; ftm: number; fta: number; games: number;
}
export function weeklyPlayers(players: Player[], schedule: NbaSchedule, overrides: Record<string, number>): WeeklyPlayer[] {
  return players.map(player => {
    const team = canonicalTeam(player.team);
    const games = schedule.games.filter(g => !['postponed', 'canceled'].includes(g.status) &&
      (canonicalTeam(g.homeTeam) === team || canonicalTeam(g.awayTeam) === team));
    const unknown = !TEAMS.has(team);
    const out = /\bout\b|injured|suspended/i.test(player.injuryStatus ?? '');
    const override = Object.hasOwn(overrides, player.id);
    const expectedGames = override ? Math.min(overrides[player.id]!, unknown ? 14 : games.length) : out ? 0 : games.length;
    return { player, dates: games.map(g => g.date), scheduledGames: games.length, expectedGames, override,
      warning: player.projectionUnavailable ? 'Missing from the latest projection feed; these are saved projections.' :
        unknown ? 'NBA team not recognized. Set expected games manually; scheduled games cannot be verified.' :
        out ? (override ? 'Out/injured status: using your expected-game override, not a medical clearance.' : 'Out/injured: conservatively assumes 0 games. Edit expected games if a return is likely.') :
        /questionable|doubtful|day.to.day|dtd/i.test(player.injuryStatus ?? '') ? 'Availability uncertain: full schedule assumed unless you override expected games.' : undefined };
  });
}
export function totalWeeklyStats(rows: WeeklyPlayer[]): WeeklyTotals {
  const totals = Object.fromEntries([...CATEGORY_KEYS, 'fgm', 'fga', 'ftm', 'fta', 'games'].map(k => [k, 0])) as unknown as WeeklyTotals;
  for (const { player: p, expectedGames: games, reserve } of rows) {
    if (reserve) continue;
    totals.games += games;
    for (const k of ['points', 'rebounds', 'assists', 'steals', 'blocks', 'threes', 'turnovers', 'fgm', 'fga', 'ftm', 'fta'] as const) totals[k] += p[k] * games;
  }
  totals.fg = totals.fga ? totals.fgm / totals.fga : 0;
  totals.ft = totals.fta ? totals.ftm / totals.fta : 0;
  return totals;
}
// Normal approximation to independent Poisson counts / conditional binomial
// shooting. These are transparent planning estimates, NOT calibrated odds.
function normalCdf(z: number) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + .3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x);
  return .5 * (1 + (z < 0 ? -erf : erf));
}
export interface WeeklyCategory {
  key: CategoryKey;
  mine: number;
  opponent: number;
  edge: 'ahead' | 'behind' | 'tied';
  modelWinChance: number;
}
export function compareWeekly(mine: WeeklyTotals, opponent: WeeklyTotals): WeeklyCategory[] {
  return CATEGORY_KEYS.map(key => {
    const a = mine[key], b = opponent[key], delta = (a - b) * (key === 'turnovers' ? -1 : 1);
    let variance = a + b;
    if (key === 'fg' || key === 'ft') {
      const n = key === 'fg' ? 'fga' : 'fta';
      variance = (mine[n] ? a * (1 - a) / mine[n] : 0) + (opponent[n] ? b * (1 - b) / opponent[n] : 0);
    }
    const edge = Math.abs(delta) < 1e-9 ? 'tied' : delta > 0 ? 'ahead' : 'behind';
    const modelWinChance = edge === 'tied' ? .5 : variance > 0 ? normalCdf(delta / Math.sqrt(variance)) : delta > 0 ? 1 : 0;
    return { key, mine: a, opponent: b, edge, modelWinChance };
  });
}
export interface WeeklyAnalysis {
  starters: { slot: RosterSlot; player: Player | null }[];
  bench: WeeklyPlayer[];
  myTotals: WeeklyTotals;
  opponentTotals: WeeklyTotals;
  categories: WeeklyCategory[];
  expectedCategoryPoints: number;
  projectedWins: number;
  evaluatedLineups: number;
}
/** Exhaustive selection, including vacancies: a weekly slot may be left empty
 * if a player's percentage/TO damage outweighs their counting-stat benefit.
 * All nine categories have equal value. No category is zero-weighted.
 */
export function optimizeWeekly(mine: WeeklyPlayer[], opponent: WeeklyPlayer[], slots: RosterSlot[]): WeeklyAnalysis {
  const active = slots.filter(s => s !== 'BN');
  if (!active.length || mine.length > 18) throw new Error('Weekly optimization supports 1–18 roster players with active slots.');
  if (assignRoster(opponent.map(r => r.player), active).fitted !== opponent.length) throw new Error('Opponent starters do not fit the league’s active slots. Move extra/ineligible players to their bench.');
  const pool = mine.filter(r => r.expectedGames > 0 && !r.reserve);
  const opponentTotals = totalWeeklyStats(opponent);
  let best: WeeklyPlayer[] = [], bestScore = -Infinity, bestFloor = -Infinity, evaluatedLineups = 0;
  function visit(index: number, selected: WeeklyPlayer[]) {
    if (index < pool.length) {
      visit(index + 1, selected);
      if (selected.length < active.length) { selected.push(pool[index]!); visit(index + 1, selected); selected.pop(); }
      return;
    }
    if (assignRoster(selected.map(r => r.player), active).fitted !== selected.length) return;
    evaluatedLineups++;
    const cats = compareWeekly(totalWeeklyStats(selected), opponentTotals);
    const score = cats.reduce((a, c) => a + c.modelWinChance, 0), floor = Math.min(...cats.map(c => c.modelWinChance));
    if (score > bestScore + 1e-10 || (Math.abs(score - bestScore) <= 1e-10 && (floor > bestFloor + 1e-10 || Math.abs(floor - bestFloor) <= 1e-10 && selected.length > best.length))) {
      best = [...selected]; bestScore = score; bestFloor = floor;
    }
  }
  visit(0, []);
  const myTotals = totalWeeklyStats(best), categories = compareWeekly(myTotals, opponentTotals);
  const chosen = new Set(best.map(p => p.player.id));
  return { starters: assignRoster(best.map(r => r.player), active).assignment, bench: mine.filter(r => !chosen.has(r.player.id)),
    myTotals, opponentTotals, categories, expectedCategoryPoints: bestScore, projectedWins: categories.filter(c => c.edge === 'ahead').length, evaluatedLineups };
}

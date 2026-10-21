import { z } from 'zod';
import { DEMO_PLAYERS } from './demo-players';
import { LEAGUE_IL_SLOTS, LEAGUE_ROSTER_SLOTS } from './league-roster';
import type { DraftState, LeagueSettings, Player } from './draft-types';

const positionSchema = z.enum(['PG', 'SG', 'SF', 'PF', 'C']);
const slotSchema = z.enum(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'BN']);
const perGame = z.number().finite().min(0).max(100);
export const playerSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  team: z.string().trim().min(1).max(40),
  positions: z.array(positionSchema).min(1).max(5),
  games: z.number().finite().min(1).max(82),
  points: perGame, rebounds: perGame, assists: perGame, steals: perGame,
  blocks: perGame, threes: perGame, turnovers: perGame,
  fgm: perGame, fga: perGame, ftm: perGame, fta: perGame,
  adp: z.number().finite().positive().max(5000).optional(),
  note: z.string().max(1000).optional(),
  injuryStatus: z.string().max(80).optional(),
  injuryNote: z.string().max(2000).optional(),
  injuryUpdatedAt: z.string().optional(),
  injurySource: z.string().max(300).optional(),
  injuryReturnDate: z.string().optional(),
  positionsVerified: z.boolean().optional(),
  positionsSource: z.enum(['Yahoo', 'ESPN', 'Imported', 'Manual']).optional(),
  yahooId: z.string().regex(/^\d+$/).optional(),
  yahooPositions: z.array(positionSchema).min(1).max(5).optional(),
  positionsFetchedAt: z.string().optional(),
  yahooEligibilityMissing: z.boolean().optional(),
  positionsConflict: z.boolean().optional(),
  projectionUnavailable: z.boolean().optional(),
}).refine(p => p.fgm <= p.fga && p.ftm <= p.fta && p.threes <= p.fgm, {
  message: 'Makes cannot exceed attempts; three-point makes cannot exceed field-goal makes.',
});
export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  teamCount: z.number().int().min(4).max(20),
  myPosition: z.number().int().min(1).max(20),
  rosterSlots: z.array(slotSchema).min(5).max(20),
  injuryReserveSlots: z.number().int().min(0).max(10).default(LEAGUE_IL_SLOTS),
  trackingMode: z.enum(['manual', 'snake']).default('manual'),
}).refine(s => s.myPosition <= s.teamCount, {
  message: 'Your draft position must be within the number of teams.',
});
export const DEFAULT_SETTINGS: LeagueSettings = {
  name: 'My Fantasy League', teamCount: 12, myPosition: 6,
  trackingMode: 'manual',
  rosterSlots: [...LEAGUE_ROSTER_SLOTS], injuryReserveSlots: LEAGUE_IL_SLOTS,
};
export function createInitialState(): DraftState {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, rosterSlots: [...DEFAULT_SETTINGS.rosterSlots] },
    players: DEMO_PLAYERS.map(p => ({ ...p, positions: [...p.positions] })),
    source: { label: 'Illustrative demo pool', season: 'Sample — not a season forecast', isDemo: true },
    picks: [], shortlist: [],
  };
}
export const CSV_TEMPLATE = [
  'name,team,positions,games,points,rebounds,assists,steals,blocks,threes,turnovers,fgm,fga,ftm,fta,adp,note',
  'Example Player,ABC,PG/SG,72,20,4,6,1.2,0.4,2,2.5,7,15,4,5,25,Replace this sample with your season projections',
].join('\n');

/** RFC-style quoted CSV parsing, including embedded commas/newlines and escaped quotes. */
function parseRows(text: string): string[][] {
  if (text.length > 5_000_000) throw new Error('The CSV is too large. Please use a file under 5 MB.');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, afterQuote = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else field += ch;
    } else if (ch === '"') {
      if (field.trim() || afterQuote) throw new Error('Unexpected quote in CSV. Use the downloadable template.');
      quoted = true;
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(field.trim()); field = ''; afterQuote = false;
      if (ch !== ',') {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (ch === '\r' && input[i + 1] === '\n') i++;
      }
    } else {
      if (afterQuote && ch.trim()) throw new Error('Unexpected text after a quoted CSV field.');
      field += ch;
    }
  }
  if (quoted) throw new Error('The CSV contains an unclosed quote.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
const requiredColumns = ['name', 'team', 'positions', 'games', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'threes', 'turnovers', 'fgm', 'fga', 'ftm', 'fta'] as const;
export function parseProjections(text: string): Player[] {
  const rows = parseRows(text);
  if (rows.length < 2) throw new Error('The file needs a header row and at least one player.');
  const header = rows[0]!.map(v => v.trim().toLowerCase());
  if (new Set(header).size !== header.length) throw new Error('The CSV has duplicate column names.');
  const missing = requiredColumns.filter(c => !header.includes(c));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}. Download the CSV template for the expected format.`);
  if (rows.length > 3001) throw new Error('Import at most 3,000 players.');
  const seen = new Set<string>();
  return rows.slice(1).map((row, i) => {
    if (row.length !== header.length) throw new Error(`Row ${i + 2}: expected ${header.length} columns, received ${row.length}.`);
    const values = Object.fromEntries(header.map((key, j) => [key, row[j] ?? '']));
    const numeric = (key: string) => {
      if (!values[key]?.trim()) throw new Error(`Row ${i + 2}: ${key} is empty.`);
      const n = Number(values[key]);
      if (!Number.isFinite(n)) throw new Error(`Row ${i + 2}: ${key} must be a numeric per-game projection.`);
      return n;
    };
    const name = values.name!;
    const identity = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!identity) throw new Error(`Row ${i + 2}: enter a player name.`);
    if (seen.has(identity)) throw new Error(`Row ${i + 2}: duplicate player "${name}".`);
    seen.add(identity);
    const numericFields = Object.fromEntries(requiredColumns.filter(c => !['name', 'team', 'positions'].includes(c)).map(c => [c, numeric(c)]));
    const candidate = {
      id: `player-${identity}`, name, team: values.team,
      positions: [...new Set(values.positions!.toUpperCase().split(/[\/;|,\s]+/).filter(Boolean))],
      ...numericFields,
      ...(values.adp ? { adp: numeric('adp') } : {}),
      ...(values.note ? { note: values.note } : {}),
    };
    const result = playerSchema.safeParse(candidate);
    if (!result.success) {
      const issue = result.error.issues[0]!;
      throw new Error(`Row ${i + 2}, ${name}: ${issue.path.join('.') || 'shooting stats'} — ${issue.message}`);
    }
    return result.data;
  });
}

const lineupSchema = z.record(z.string().regex(/^(PG|SG|G|SF|PF|F|C|UTIL|BN|IL)-[1-9]\d?$/), z.string()).refine(
  lineup => Object.values(lineup).length <= 30 && new Set(Object.values(lineup)).size === Object.values(lineup).length,
  { message: 'A player can occupy only one weekly lineup slot.' },
);
export const matchupSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  myRosterIds: z.array(z.string()).max(18),
  myReserveIds: z.array(z.string()).max(10).optional(),
  myLineup: lineupSchema.optional(),
  opponentLineup: lineupSchema.optional(),
  opponentReserveIds: z.array(z.string()).max(10).optional(),
  ilEligibleIds: z.array(z.string()).max(36).optional(),
  opponentRosterIds: z.array(z.string()).max(18),
  opponentStarterIds: z.array(z.string()).max(18),
  expectedGames: z.record(z.string(), z.number().min(0).max(14)),
}).refine(m => {
  const all = [...m.myRosterIds, ...m.opponentRosterIds];
  return new Set(all).size === all.length && new Set(m.opponentStarterIds).size === m.opponentStarterIds.length &&
    m.opponentStarterIds.every(id => m.opponentRosterIds.includes(id)) &&
    new Set(m.myReserveIds ?? []).size === (m.myReserveIds?.length ?? 0) && (m.myReserveIds ?? []).every(id => m.myRosterIds.includes(id)) &&
    new Set(m.opponentReserveIds ?? []).size === (m.opponentReserveIds?.length ?? 0) && (m.opponentReserveIds ?? []).every(id => m.opponentRosterIds.includes(id)) &&
    new Set(m.ilEligibleIds ?? []).size === (m.ilEligibleIds?.length ?? 0) && (m.ilEligibleIds ?? []).every(id => all.includes(id)) &&
    Object.values(m.myLineup ?? {}).every(id => m.myRosterIds.includes(id)) &&
    Object.values(m.opponentLineup ?? {}).every(id => m.opponentRosterIds.includes(id));
}, { message: 'Weekly roster identities must be unique and opponent starters must belong to that roster.' });
const stateSchema = z.object({
  version: z.literal(1),
  settings: settingsSchema,
  players: z.array(playerSchema).min(1).max(3000),
  source: z.object({
    label: z.string().min(1).max(200), season: z.string().min(1).max(100),
     isDemo: z.boolean(), importedAt: z.string().optional(),
     updatedAt: z.string().optional(), fetchedAt: z.string().optional(), checkedAt: z.string().optional(),
     url: z.string().optional(), provider: z.string().optional(),
     positionsPlatform: z.string().optional(), adpPlatform: z.string().optional(),
  }),
  picks: z.array(z.object({
    playerId: z.string(), team: z.number().int().min(0).max(20), overall: z.number().int().positive(),
  })).max(3000),
  shortlist: z.array(z.string()).max(3000),
  matchup: matchupSchema.optional(),
  eligibilityFeed: z.object({
    season: z.string(), source: z.string(), fetchedAt: z.string(), checkedAt: z.string(),
    totalPlayers: z.number().int().nonnegative().max(3000),
    matchedPlayers: z.number().int().nonnegative().max(3000),
    unmatchedPlayers: z.number().int().nonnegative().max(3000),
  }).optional(),
  injuryFeed: z.object({
    checkedAt: z.string(), source: z.string(), reportUpdatedAt: z.string().optional(),
    matchedPlayers: z.number().int().nonnegative(), totalReports: z.number().int().nonnegative(),
  }).optional(),
});
export function parseSession(json: string): DraftState {
  if (json.length > 5_000_000) throw new Error('The backup file is too large.');
  let input: unknown;
  try { input = JSON.parse(json); } catch { throw new Error('The backup is not valid JSON. Import a draft backup exported by this app.'); }
  const result = stateSchema.safeParse(input);
  if (!result.success) throw new Error('The saved draft has invalid settings, players, or stats. Use a backup exported by this app.');
  const state = result.data;
  const ids = new Set(state.players.map(p => p.id));
  if (ids.size !== state.players.length) throw new Error('The backup contains duplicate players.');
  const picked = new Set<string>();
  for (let i = 0; i < state.picks.length; i++) {
    const pick = state.picks[i]!;
    const round = Math.floor(i / state.settings.teamCount);
    const offset = i % state.settings.teamCount;
    const team = round % 2 ? state.settings.teamCount - offset : offset + 1;
    const validTeam = state.settings.trackingMode === 'manual'
      ? pick.team <= state.settings.teamCount
      : pick.team === team;
    if (!ids.has(pick.playerId) || picked.has(pick.playerId) || pick.overall !== i + 1 || !validTeam) {
      throw new Error('The backup contains invalid or duplicate draft picks.');
    }
    picked.add(pick.playerId);
  }
  if (state.settings.trackingMode !== 'manual' && state.picks.length > state.settings.teamCount * state.settings.rosterSlots.length) throw new Error('The backup has more picks than league roster spots.');
  const mine = state.picks.filter(p => p.team === state.settings.myPosition).map(p => state.players.find(player => player.id === p.playerId)!);
  if (mine.length > state.settings.rosterSlots.length) throw new Error('The backup has more of your picks than roster spots.');
  if (state.shortlist.some(id => !ids.has(id))) throw new Error('The backup shortlist contains a missing player.');
  if (state.matchup && [...state.matchup.myRosterIds, ...state.matchup.opponentRosterIds].some(id => !ids.has(id))) throw new Error('The weekly matchup contains a missing player.');
  return state;
}
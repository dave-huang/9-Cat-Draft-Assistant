export const CATEGORY_KEYS = ['fg', 'ft', 'threes', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers'] as const;
export type CategoryKey = typeof CATEGORY_KEYS[number];
export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export type RosterSlot = Position | 'G' | 'F' | 'UTIL' | 'BN';
export type CategoryValues = Record<CategoryKey, number>;

export interface Player {
  id: string;
  name: string;
  team: string;
  positions: Position[];
  games: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  threes: number;
  turnovers: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  adp?: number;
  note?: string;
  injuryStatus?: string;
  injuryNote?: string;
  injuryUpdatedAt?: string;
  injurySource?: string;
  injuryReturnDate?: string;
  positionsVerified?: boolean;
}
export interface LeagueSettings {
  name: string;
  teamCount: number;
  myPosition: number;
  rosterSlots: RosterSlot[];
  trackingMode?: 'manual' | 'snake';
}
export interface Pick {
  playerId: string;
  team: number;
  overall: number;
}
export interface ProjectionSource {
  label: string;
  season: string;
  importedAt?: string;
  isDemo: boolean;
  updatedAt?: string;
  fetchedAt?: string;
  checkedAt?: string;
  url?: string;
  provider?: string;
  positionsPlatform?: string;
  adpPlatform?: string;
}
export interface DraftState {
  version: 1;
  settings: LeagueSettings;
  players: Player[];
  source: ProjectionSource;
  picks: Pick[];
  shortlist: string[];
  injuryFeed?: {
    checkedAt: string;
    source: string;
    reportUpdatedAt?: string;
    matchedPlayers: number;
    totalReports: number;
  };
}
export interface Recommendation {
  player: Player;
  rank: number;
  overallRank: number;
  score: number;
  overallValue: number;
  categoryZ: CategoryValues;
  strengths: CategoryKey[];
  weaknesses: CategoryKey[];
  reasons: string[];
  warnings: string[];
  fillsSlot: boolean;
}
export interface CategorySummary {
  key: CategoryKey;
  label: string;
  value: number;
  /** Relative to the average drafted player, not a calibrated win probability. */
  z: number;
  priority: number;
  status: 'strong' | 'balanced' | 'needs-work' | 'empty';
}
export interface DraftAnalysis {
  nextPick: number;
  round: number;
  currentTeam: number;
  isMyTurn: boolean;
  picksUntilMine: number;
  myNextPick: number | null;
  complete: boolean;
  roster: Player[];
  rosterAssignment: { slot: RosterSlot; player: Player | null }[];
  recommendations: Recommendation[];
  categories: CategorySummary[];
  draftedIds: Set<string>;
  totalPicks: number;
  warnings: string[];
}
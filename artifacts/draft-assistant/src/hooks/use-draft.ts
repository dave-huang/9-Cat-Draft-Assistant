import { useSyncExternalStore } from 'react';
import { analyzeDraft, assignRoster, teamAtPick } from '@/lib/draft-engine';
import { createInitialState, matchupSchema, parseProjections, parseSession, playerSchema, settingsSchema } from '@/lib/projections';
import { migrateLeagueRoster } from '@/lib/league-roster';
import { withYahooEligibility } from '@/lib/eligibility';
import type { DraftEligibilityFeed } from '@workspace/api-client-react';
import type { DraftState, LeagueSettings, Player, Position, ProjectionSource } from '@/lib/draft-types';

const STORAGE_KEY = 'nine-cat-draft-v1';
const listeners = new Set<() => void>();
let state = createInitialState();
let saveError: string | null = null;
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) state = migrateLeagueRoster(parseSession(stored));
} catch {
  saveError = 'The saved draft could not be loaded. Your previous backup has not been overwritten. Restore a JSON backup or explicitly reset before continuing.';
}
let protectedStorage = Boolean(saveError);
let analysis = analyzeDraft(state);
let snapshot = { state, analysis, saveError };
const publish = () => {
  snapshot = { state, analysis, saveError };
  listeners.forEach(listener => listener());
};
function commit(next: DraftState, allowRecovery = false) {
  if (protectedStorage && !allowRecovery) throw new Error(saveError ?? 'Restore or reset the draft to recover browser storage.');
  state = next;
  analysis = analyzeDraft(state);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveError = null;
    protectedStorage = false;
  } catch {
    saveError = 'Changes are in memory only: browser storage is unavailable or full. Export a JSON backup before closing this page.';
  }
  publish();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY) return;
  if (event.newValue === null) {
    saveError = 'Draft storage was cleared in another tab. Export a backup before closing or reset to save this draft again.';
    publish();
    return;
  }
  try {
    state = migrateLeagueRoster(parseSession(event.newValue));
    analysis = analyzeDraft(state);
    saveError = null;
    protectedStorage = false;
  } catch {
    saveError = 'The draft changed in another tab but could not be loaded. Export a backup.';
  }
  publish();
});
const actions = {
  markPick(playerId: string, owner?: 'mine' | 'taken') {
    const manual = state.settings.trackingMode === 'manual';
    if (analysis.complete && (!manual || owner !== 'taken')) throw new Error('Your roster is full. You can still mark other players Taken in manual mode.');
    const player = state.players.find(p => p.id === playerId);
    if (!player) throw new Error('That player is not in the projection pool.');
    if (analysis.draftedIds.has(playerId)) throw new Error('That player has already been drafted.');
    const team = manual
      ? owner === 'mine' ? state.settings.myPosition : 0
      : teamAtPick(analysis.nextPick, state.settings.teamCount);
    if (!manual && owner && (owner === 'mine') !== (team === state.settings.myPosition)) {
      throw new Error('This does not match the snake-draft turn. Switch to manual tracking to mark Mine or Taken independently.');
    }
    if (team === state.settings.myPosition && assignRoster([...analysis.roster, player], state.settings.rosterSlots).fitted !== analysis.roster.length + 1) {
      throw new Error('This player does not fit your remaining roster slots. Check the position eligibility before drafting.');
    }
    commit({ ...state, picks: [...state.picks, { playerId, team, overall: analysis.nextPick }], shortlist: state.shortlist.filter(id => id !== playerId) });
  },
  undoPick() {
    if (!state.picks.length) throw new Error('There are no picks to undo.');
    commit({ ...state, picks: state.picks.slice(0, -1) });
  },
  undraftPlayer(playerId: string) {
    if (state.settings.trackingMode !== 'manual') throw new Error('Switch to manual tracking to correct an earlier pick without changing snake order.');
    if (!analysis.draftedIds.has(playerId)) throw new Error('That player has not been drafted.');
    commit({ ...state, picks: state.picks.filter(p => p.playerId !== playerId).map((p, i) => ({ ...p, overall: i + 1 })) });
  },
  updateSettings(settings: LeagueSettings) {
    const result = settingsSchema.safeParse(settings);
    if (!result.success) throw new Error(result.error.issues[0]?.message ?? 'Invalid league settings.');
    if (state.picks.length && state.settings.trackingMode === 'manual' && result.data.trackingMode !== 'manual') {
      throw new Error('Manual picks cannot be converted to snake order. Export a backup and reset first.');
    }
    if (state.picks.length && (settings.teamCount !== state.settings.teamCount || settings.myPosition !== state.settings.myPosition || settings.rosterSlots.join(',') !== state.settings.rosterSlots.join(','))) {
      throw new Error('Draft order and roster slots are locked after the first pick. Export a backup, then reset the draft to change them.');
    }
    commit({ ...state, settings: result.data });
  },
  importProjections(csv: string, label: string, season: string) {
    if (state.picks.length) throw new Error('Importing replaces the player pool. Export a backup and reset your draft before importing.');
    if (!label.trim() || !season.trim()) throw new Error('Enter the projection source and season.');
    if (label.length > 200 || season.length > 100) throw new Error('Please shorten the source label or season.');
    const players = parseProjections(csv);
    commit({ ...state, players: players.map(p => ({ ...p, positionsSource: 'Imported' as const })), eligibilityFeed: undefined, picks: [], shortlist: [], source: { label: label.trim(), season: season.trim(), isDemo: false, importedAt: new Date().toISOString() } });
  },
  loadCurrentProjections(players: Player[], source: ProjectionSource) {
    if (source.isDemo || players.length < 150) throw new Error('The current projection feed is incomplete. The existing board has not been replaced.');
    const parsed = players.map(p => playerSchema.parse(p));
    if (new Set(parsed.map(p => p.id)).size !== parsed.length) throw new Error('The projection feed contains duplicate players.');
    if (state.picks.length && state.source.isDemo) throw new Error('Your practice draft uses demo IDs. Export it, then reset picks before loading current projections.');
    if (state.source.isDemo && ((state.matchup?.myRosterIds.length ?? 0) || (state.matchup?.opponentRosterIds.length ?? 0))) throw new Error('Your weekly roster contains demo players. Export a backup and remove those weekly players before loading real projections.');
    if (state.picks.length && state.source.season !== source.season) throw new Error('The feed is for a different season. Export a backup and reset before replacing the season.');
    // Refreshes preserve picks, local identities and saved players missing from
    // a new forecast (e.g. a newly injured player with no season projection).
    const normalize = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const oldByName = new Map(state.players.map(p => [normalize(p.name), p]));
    const merged = parsed.map(p => {
      const old = state.source.isDemo ? undefined : state.players.find(old => old.id === p.id) ?? oldByName.get(normalize(p.name));
      const base = { ...p, positionsSource: source.provider === 'ESPN' ? 'ESPN' as const : 'Imported' as const };
      return old ? { ...base, id: old.id,
        ...((old.positionsVerified || (old.positionsSource === 'Yahoo' && state.source.season === source.season) || old.positionsConflict) ? {
          positions: old.positions, positionsVerified: old.positionsVerified, positionsSource: old.positionsVerified ? 'Manual' as const : old.positionsSource,
          yahooId: old.yahooId, yahooPositions: old.yahooPositions, positionsFetchedAt: old.positionsFetchedAt,
          yahooEligibilityMissing: old.yahooEligibilityMissing, positionsConflict: old.positionsConflict,
        } : {}),
        injuryStatus: old.injuryStatus, injuryNote: old.injuryNote, injuryUpdatedAt: old.injuryUpdatedAt, injurySource: old.injurySource, injuryReturnDate: old.injuryReturnDate } : base;
    });
    const ids = new Set(merged.map(p => p.id));
    if (ids.size !== merged.length) throw new Error('Player identity matching was ambiguous. Existing draft was kept.');
    const weeklyIds = new Set([...(state.matchup?.myRosterIds ?? []), ...(state.matchup?.opponentRosterIds ?? [])]);
    const missing = state.players.filter(p => !ids.has(p.id) && (analysis.draftedIds.has(p.id) || state.shortlist.includes(p.id) || weeklyIds.has(p.id))).map(p => ({ ...p, projectionUnavailable: true }));
    commit({ ...state, players: [...merged, ...missing], source,
      eligibilityFeed: state.source.season === source.season ? state.eligibilityFeed : undefined,
      shortlist: state.shortlist.filter(id => ids.has(id) || missing.some(p => p.id === id)) });
  },
  applyYahooEligibility(feed: DraftEligibilityFeed) {
    commit(withYahooEligibility(state, feed, new Date().toISOString()));
  },
  updateMatchup(input: unknown) {
    const result = matchupSchema.safeParse(input);
    if (!result.success) throw new Error(result.error.issues[0]?.message ?? 'Invalid weekly planner settings.');
    const ids = new Set(state.players.map(p => p.id));
    if ([...result.data.myRosterIds, ...result.data.opponentRosterIds].some(id => !ids.has(id))) throw new Error('A selected player is missing from the projection pool.');
    commit({ ...state, matchup: result.data });
  },
  applyInjuries(reports: { name: string; status: string; note: string; updatedAt?: string; source: string; returnDate?: string }[], checkedAt: string, reportUpdatedAt?: string) {
    if (state.source.isDemo) throw new Error('Load current projections before checking injuries. Demo identities are not verified.');
    const normalize = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(jr|sr|iii|ii|iv)\b/g, '').replace(/[^a-z0-9]/g, '');
    const byName = new Map(reports.map(r => [normalize(r.name), r]));
    let matchedPlayers = 0;
    const players = state.players.map(p => {
      const report = byName.get(normalize(p.name));
      if (report) matchedPlayers++;
      return { ...p, injuryStatus: report?.status, injuryNote: report?.note, injuryUpdatedAt: report?.updatedAt, injurySource: report?.source, injuryReturnDate: report?.returnDate };
    });
    commit({ ...state, players, injuryFeed: { checkedAt, source: 'ESPN NBA injury reports', reportUpdatedAt, matchedPlayers, totalReports: reports.length } });
  },
  updatePlayerPositions(playerId: string, positions: Position[]) {
    const old = state.players.find(p => p.id === playerId);
    if (!old) throw new Error('That player is not in the pool.');
    const updated = playerSchema.parse({ ...old, positions: [...new Set(positions)], positionsVerified: true, positionsSource: 'Manual', positionsConflict: false });
    const players = state.players.map(p => p.id === playerId ? updated : p);
    const roster = state.picks.filter(p => p.team === state.settings.myPosition).map(p => players.find(player => player.id === p.playerId)!);
    if (assignRoster(roster, state.settings.rosterSlots).fitted < roster.length) throw new Error('Those positions would leave your existing roster without an eligible slot. Correct the pick before changing eligibility.');
    commit({ ...state, players });
  },
  resetDraft() {
    commit(migrateLeagueRoster({ ...state, picks: [], shortlist: [] }), true);
  },
  toggleShortlist(playerId: string) {
    if (!state.players.some(p => p.id === playerId)) throw new Error('That player is not in the projection pool.');
    if (analysis.draftedIds.has(playerId)) throw new Error('That player has already been drafted.');
    commit({ ...state, shortlist: state.shortlist.includes(playerId) ? state.shortlist.filter(id => id !== playerId) : [...state.shortlist, playerId] });
  },
  exportSession() { return JSON.stringify(state, null, 2); },
  importSession(json: string) { commit(migrateLeagueRoster(parseSession(json)), true); },
};

export function getDraftSnapshot() { return snapshot; }
export { actions as draftActions };

/** Single external store keeps shell and all page callers consistent. */
export function useDraft() {
  return { ...useSyncExternalStore(subscribe, () => snapshot), ...actions };
}
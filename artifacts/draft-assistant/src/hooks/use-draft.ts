import { useSyncExternalStore } from 'react';
import { analyzeDraft, assignRoster, teamAtPick } from '@/lib/draft-engine';
import { createInitialState, parseProjections, parseSession, settingsSchema } from '@/lib/projections';
import type { DraftState, LeagueSettings } from '@/lib/draft-types';

const STORAGE_KEY = 'nine-cat-draft-v1';
const listeners = new Set<() => void>();
let state = createInitialState();
let saveError: string | null = null;
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) state = parseSession(stored);
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
    state = parseSession(event.newValue);
    analysis = analyzeDraft(state);
    saveError = null;
    protectedStorage = false;
  } catch {
    saveError = 'The draft changed in another tab but could not be loaded. Export a backup.';
  }
  publish();
});
const actions = {
  markPick(playerId: string) {
    if (analysis.complete) throw new Error('The draft is complete.');
    const player = state.players.find(p => p.id === playerId);
    if (!player) throw new Error('That player is not in the projection pool.');
    if (analysis.draftedIds.has(playerId)) throw new Error('That player has already been drafted.');
    const team = teamAtPick(analysis.nextPick, state.settings.teamCount);
    if (team === state.settings.myPosition && assignRoster([...analysis.roster, player], state.settings.rosterSlots).fitted !== analysis.roster.length + 1) {
      throw new Error('This player does not fit your remaining roster slots. Check the position eligibility before drafting.');
    }
    commit({ ...state, picks: [...state.picks, { playerId, team, overall: analysis.nextPick }], shortlist: state.shortlist.filter(id => id !== playerId) });
  },
  undoPick() {
    if (!state.picks.length) throw new Error('There are no picks to undo.');
    commit({ ...state, picks: state.picks.slice(0, -1) });
  },
  updateSettings(settings: LeagueSettings) {
    const result = settingsSchema.safeParse(settings);
    if (!result.success) throw new Error(result.error.issues[0]?.message ?? 'Invalid league settings.');
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
    commit({ ...state, players, picks: [], shortlist: [], source: { label: label.trim(), season: season.trim(), isDemo: false, importedAt: new Date().toISOString() } });
  },
  resetDraft() {
    commit({ ...state, picks: [], shortlist: [] }, true);
  },
  toggleShortlist(playerId: string) {
    if (!state.players.some(p => p.id === playerId)) throw new Error('That player is not in the projection pool.');
    if (analysis.draftedIds.has(playerId)) throw new Error('That player has already been drafted.');
    commit({ ...state, shortlist: state.shortlist.includes(playerId) ? state.shortlist.filter(id => id !== playerId) : [...state.shortlist, playerId] });
  },
  exportSession() { return JSON.stringify(state, null, 2); },
  importSession(json: string) { commit(parseSession(json), true); },
};

/** Single external store keeps shell and all page callers consistent. */
export function useDraft() {
  return { ...useSyncExternalStore(subscribe, () => snapshot), ...actions };
}
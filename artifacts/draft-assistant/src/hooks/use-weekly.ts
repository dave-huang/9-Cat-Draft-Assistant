import { useEffect, useMemo } from 'react';
import { getGetNbaScheduleQueryKey, useGetNbaSchedule } from '@workspace/api-client-react';
import { useDraft } from './use-draft';
import { useDraftData } from './use-draft-data';
import { assignRoster } from '@/lib/draft-engine';
import { createMatchup, optimizeWeekly, validMatchupDates, weeklyPlayers } from '@/lib/weekly-engine';
import type { Player, WeeklyPlannerState } from '@/lib/draft-types';
import type { WeeklyPlayer } from '@/lib/weekly-engine';

const pendingRows = (players: Player[]): WeeklyPlayer[] => players.map(player => ({
  player, scheduledGames: 0, expectedGames: 0, dates: [], override: false, schedulePending: true,
  warning: 'Schedule not loaded. Game counts are unavailable; your roster can still be edited.',
}));

export function useWeeklyPlanner() {
  const draft = useDraft(), dataStatus = useDraftData();
  const planner = draft.state.matchup ?? createMatchup(draft.state);
  const activeSlots = draft.state.settings.rosterSlots.filter(s => s !== 'BN');
  const validDates = validMatchupDates(planner.start, planner.end);
  const request = useGetNbaSchedule({ start: planner.start, end: planner.end }, { query: {
    queryKey: getGetNbaScheduleQueryKey({ start: planner.start, end: planner.end }),
    enabled: validDates, staleTime: 5 * 60_000, refetchInterval: 5 * 60_000, refetchOnWindowFocus: true, retry: 1,
  } });
  const schedule = request.data?.start === planner.start && request.data.end === planner.end ? request.data : undefined;
  const ids = new Map(draft.state.players.map(p => [p.id, p]));
  useEffect(() => {
    if (!draft.state.matchup && !draft.saveError) draft.updateMatchup(createMatchup(draft.state));
  }, [draft.state.matchup, draft.saveError]);
  const mine = useMemo(() => (schedule ? weeklyPlayers(draft.state.players.filter(p => planner.myRosterIds.includes(p.id)), schedule, planner.expectedGames) : pendingRows(draft.state.players.filter(p => planner.myRosterIds.includes(p.id)))).map(row =>
    (planner.myReserveIds ?? []).includes(row.player.id) ? { ...row, reserve: true, expectedGames: 0, warning: 'IL reserve: excluded from starters and totals. Activate only if eligible in Yahoo and a regular roster spot is free.' } : row),
    [schedule, draft.state.players, planner.myRosterIds, planner.myReserveIds, planner.expectedGames]);
  const opponent = useMemo(() => schedule ? weeklyPlayers(draft.state.players.filter(p => planner.opponentRosterIds.includes(p.id)), schedule, planner.expectedGames) : pendingRows(draft.state.players.filter(p => planner.opponentRosterIds.includes(p.id))),
    [schedule, draft.state.players, planner.opponentRosterIds, planner.expectedGames]);
  const result = useMemo(() => {
    if (!schedule || !mine.length || !planner.opponentStarterIds.length || !schedule.games.some(g => !['postponed', 'canceled'].includes(g.status)) || draft.state.source.isDemo) return {};
    try { return { analysis: optimizeWeekly(mine, opponent.filter(p => planner.opponentStarterIds.includes(p.player.id)), activeSlots) }; }
    catch (e) { return { analysisError: e instanceof Error ? e.message : String(e) }; }
  }, [schedule, mine, opponent, planner.opponentStarterIds, draft.state.source.isDemo, draft.state.settings.rosterSlots]);
  const update = (next: WeeklyPlannerState) => {
    if (next.myRosterIds.length > Math.min(18, draft.state.settings.rosterSlots.length + draft.state.settings.injuryReserveSlots) ||
        next.opponentRosterIds.length > Math.min(18, draft.state.settings.rosterSlots.length + draft.state.settings.injuryReserveSlots)) throw new Error('That roster is at its player limit, including injury reserves.');
    if ((next.myReserveIds?.length ?? 0) > draft.state.settings.injuryReserveSlots) throw new Error('Your IL reserve slots are full.');
    if (next.myRosterIds.length - (next.myReserveIds?.length ?? 0) > draft.state.settings.rosterSlots.length) throw new Error('Your regular roster is full. Remove a player or move an eligible player to IL in Yahoo first.');
    draft.updateMatchup(next);
  };
  const actions = {
    setDates(start: string, end: string) {
      if (!validMatchupDates(start, end)) throw new Error('Choose valid inclusive dates spanning 1–14 days, matching your Yahoo matchup.');
      update({ ...planner, start, end, expectedGames: {} });
    },
    addPlayer(side: 'mine' | 'opponent', id: string, reserve = false) {
      if (draft.state.source.isDemo) throw new Error('Load real season projections before adding weekly players.');
      const player = ids.get(id);
      if (!player) throw new Error('Player not found in the current projection pool.');
      if ([...planner.myRosterIds, ...planner.opponentRosterIds].includes(id)) throw new Error('This player is already on one of the matchup rosters.');
      if (side === 'mine') update({ ...planner, myRosterIds: [...planner.myRosterIds, id], myReserveIds: reserve ? [...(planner.myReserveIds ?? []), id] : planner.myReserveIds });
      else {
        const proposed = [...planner.opponentStarterIds, id];
        const fits = assignRoster(proposed.map(pid => ids.get(pid)!), activeSlots).fitted === proposed.length;
        update({ ...planner, opponentRosterIds: [...planner.opponentRosterIds, id], opponentStarterIds: fits ? proposed : planner.opponentStarterIds });
      }
    },
    removePlayer(side: 'mine' | 'opponent', id: string) {
      const expectedGames = { ...planner.expectedGames }; delete expectedGames[id];
      update({ ...planner, expectedGames, myRosterIds: side === 'mine' ? planner.myRosterIds.filter(pid => pid !== id) : planner.myRosterIds,
        myReserveIds: (planner.myReserveIds ?? []).filter(pid => pid !== id),
        opponentRosterIds: side === 'opponent' ? planner.opponentRosterIds.filter(pid => pid !== id) : planner.opponentRosterIds,
        opponentStarterIds: planner.opponentStarterIds.filter(pid => pid !== id) });
    },
    setMyReserve(id: string, reserve: boolean) {
      if (!planner.myRosterIds.includes(id)) throw new Error('Player is not on your weekly roster.');
      update({ ...planner, myReserveIds: reserve ? [...new Set([...(planner.myReserveIds ?? []), id])] : (planner.myReserveIds ?? []).filter(pid => pid !== id) });
    },
    setOpponentStarter(id: string, active: boolean) {
      if (!planner.opponentRosterIds.includes(id)) throw new Error('Player is not on the opponent roster.');
      const proposed = active ? [...new Set([...planner.opponentStarterIds, id])] : planner.opponentStarterIds.filter(pid => pid !== id);
      if (assignRoster(proposed.map(pid => ids.get(pid)!), activeSlots).fitted !== proposed.length) throw new Error('Those opponent starters do not fit the active slots. Bench another player first.');
      update({ ...planner, opponentStarterIds: proposed });
    },
    setExpectedGames(id: string, value?: number) {
      if (!schedule) throw new Error('Load the complete schedule before editing expected games.');
      const row = [...mine, ...opponent].find(p => p.player.id === id);
      if (!row) throw new Error('Load the schedule before editing games.');
      const max = row.warning?.includes('not recognized') ? 14 : row.scheduledGames;
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > max)) throw new Error(`Expected games must be between 0 and ${max}.`);
      const expectedGames = { ...planner.expectedGames };
      if (value === undefined) delete expectedGames[id]; else expectedGames[id] = value;
      update({ ...planner, expectedGames });
    },
    useDraftRoster() {
      const myRosterIds = draft.state.picks.filter(p => p.team === draft.state.settings.myPosition).map(p => p.playerId);
      if (!myRosterIds.length) throw new Error('No players were marked Mine in your draft. Add your roster using player search instead.');
      if (myRosterIds.some(id => planner.opponentRosterIds.includes(id))) throw new Error('A drafted player is on the opponent roster. Remove that player there before importing your team.');
      update({ ...planner, myRosterIds, myReserveIds: [] });
    },
    clearOpponent() {
      const expectedGames = { ...planner.expectedGames };
      for (const id of planner.opponentRosterIds) delete expectedGames[id];
      update({ ...planner, opponentRosterIds: [], opponentStarterIds: [], expectedGames });
    },
  };
  return { draft, planner, mine, opponent, schedule, ...result, ...actions, activeSlots, dataStatus,
    scheduleLoading: request.isLoading, scheduleRefreshing: request.isFetching,
    scheduleError: request.error instanceof Error ? request.error.message : request.error ? 'Schedule unavailable.' : null,
    refreshSchedule: () => request.refetch(), validDates };
}

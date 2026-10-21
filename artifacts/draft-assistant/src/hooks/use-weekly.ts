import { useEffect, useMemo } from 'react';
import { getGetNbaScheduleQueryKey, useGetNbaSchedule, useGetSeasonActuals, getGetSeasonActualsQueryKey } from '@workspace/api-client-react';
import { useDraft } from './use-draft';
import { useDraftData } from './use-draft-data';
import { createMatchup, optimizeWeekly, validMatchupDates, weeklyPlayers } from '@/lib/weekly-engine';
import type { Player, WeeklyPlannerState } from '@/lib/draft-types';
import type { WeeklyPlayer } from '@/lib/weekly-engine';
import { currentWeeklyAnalysis, eligibleWeeklySlot, lineupErrors, moveWeeklyPlayer, optimalWeeklyLineup, prepareWeeklyPlanner, syncWeeklyLineups, visibleWeeklySlots, weeklySlots, type WeeklyLineup, type WeeklySide } from '@/lib/weekly-lineup';
import { importOpponentLineup, type LineupImportRow } from '@/lib/lineup-import';
import { playersForWeeklyBasis, type StatsBasis } from '@/lib/weekly-stats';

const pendingRows = (players: Player[]): WeeklyPlayer[] => players.map(player => ({
  player, scheduledGames: 0, expectedGames: 0, dates: [], override: false, schedulePending: true,
  warning: 'Schedule not loaded. Game counts are unavailable; your roster can still be edited.',
}));

export function useWeeklyPlanner() {
  const draft = useDraft(), dataStatus = useDraftData();
  const slots = useMemo(() => weeklySlots(draft.state.settings), [draft.state.settings]);
  const planner = useMemo(() => prepareWeeklyPlanner(draft.state.matchup ?? createMatchup(draft.state), draft.state.players, slots),
    [draft.state.matchup, draft.state.players, slots]);
  const statsBasis = planner.statsBasis ?? 'projections';
  const actualsRequest = useGetSeasonActuals({ query: {
    queryKey: getGetSeasonActualsQueryKey(), enabled: statsBasis === 'actuals' && !draft.state.source.isDemo,
    staleTime: 5 * 60_000, refetchInterval: statsBasis === 'actuals' ? 15 * 60_000 : false,
    refetchOnWindowFocus: true, retry: 1,
  } });
  const actuals = actualsRequest.data?.season === draft.state.source.season ? actualsRequest.data : undefined;
  const statsError = statsBasis !== 'actuals' ? null : actualsRequest.error
    ? 'Current-season actual statistics could not be refreshed. Retry or switch to season projections; lineups are unchanged.'
    : actualsRequest.data && !actuals ? 'The actual-stat feed is for a different season than your saved projection pool. Load current-season projections first.' : null;
  const statsReady = statsBasis === 'projections' || (!!actuals && !statsError);
  const weeklyPool = useMemo(() => playersForWeeklyBasis(draft.state.players, statsBasis, draft.state.source.season, actuals),
    [draft.state.players, statsBasis, draft.state.source.season, actuals]);
  const myLineup = planner.myLineup!, opponentLineup = planner.opponentLineup!;
  const activeSlots = draft.state.settings.rosterSlots.filter(s => s !== 'BN');
  const validDates = validMatchupDates(planner.start, planner.end);
  const request = useGetNbaSchedule({ start: planner.start, end: planner.end }, { query: {
    queryKey: getGetNbaScheduleQueryKey({ start: planner.start, end: planner.end }),
    enabled: validDates, staleTime: 5 * 60_000, refetchInterval: 5 * 60_000, refetchOnWindowFocus: true, retry: 1,
  } });
  const schedule = request.data?.start === planner.start && request.data.end === planner.end ? request.data : undefined;
  const ids = new Map(draft.state.players.map(p => [p.id, p]));
  useEffect(() => {
    if ((!draft.state.matchup?.myLineup || !draft.state.matchup?.opponentLineup || !draft.state.matchup?.ilEligibleIds) && !draft.saveError) draft.updateMatchup(planner);
  }, [draft.state.matchup, draft.saveError, planner]);
  const mine = useMemo(() => (schedule ? weeklyPlayers(weeklyPool.filter(p => planner.myRosterIds.includes(p.id)), schedule, planner.expectedGames) : pendingRows(weeklyPool.filter(p => planner.myRosterIds.includes(p.id)))).map(row =>
    (planner.myReserveIds ?? []).includes(row.player.id) ? { ...row, reserve: true, expectedGames: 0, warning: 'IL reserve: excluded from starters and totals. Activate only if eligible in Yahoo and a regular roster spot is free.' } : row),
     [schedule, weeklyPool, planner.myRosterIds, planner.myReserveIds, planner.expectedGames]);
  const opponent = useMemo(() => (schedule ? weeklyPlayers(weeklyPool.filter(p => planner.opponentRosterIds.includes(p.id)), schedule, planner.expectedGames) : pendingRows(weeklyPool.filter(p => planner.opponentRosterIds.includes(p.id)))).map(row =>
    (planner.opponentReserveIds ?? []).includes(row.player.id) ? { ...row, reserve: true, expectedGames: 0, warning: 'IL reserve: excluded from starters and totals.' } : row),
     [schedule, weeklyPool, planner.opponentRosterIds, planner.opponentReserveIds, planner.expectedGames]);
  const errors = useMemo(() => ({
    mine: lineupErrors(myLineup, mine.map(r => r.player), slots, planner.ilEligibleIds ?? []),
    opponent: lineupErrors(opponentLineup, opponent.map(r => r.player), slots, planner.ilEligibleIds ?? []),
  }), [myLineup, opponentLineup, mine, opponent, slots, planner.ilEligibleIds]);
  const result = useMemo(() => {
    if (!statsReady || !schedule || request.error || errors.mine.length || errors.opponent.length || !mine.length || !schedule.games.some(g => !['postponed', 'canceled'].includes(g.status)) || draft.state.source.isDemo) return {};
    const currentAnalysis = currentWeeklyAnalysis(mine, opponent, myLineup, opponentLineup, slots);
    try { return { currentAnalysis, analysis: optimizeWeekly(mine, opponent.filter(p => planner.opponentStarterIds.includes(p.player.id)), activeSlots) }; }
    catch (e) { return { currentAnalysis, analysisError: e instanceof Error ? e.message : String(e) }; }
  }, [statsReady, schedule, request.error, errors, mine, opponent, myLineup, opponentLineup, slots, planner.opponentStarterIds, draft.state.source.isDemo, draft.state.settings.rosterSlots]);
  const update = (next: WeeklyPlannerState) => {
    const synced = syncWeeklyLineups(next, next.myLineup ?? {}, next.opponentLineup ?? {}, slots);
    for (const side of ['mine', 'opponent'] as const) {
      const roster = side === 'mine' ? synced.myRosterIds : synced.opponentRosterIds;
      const previous = side === 'mine' ? planner.myRosterIds : planner.opponentRosterIds;
      const reserves = side === 'mine' ? synced.myReserveIds! : synced.opponentReserveIds!;
      const oldReserves = (side === 'mine' ? planner.myReserveIds : planner.opponentReserveIds) ?? [];
      const max = Math.min(18, draft.state.settings.rosterSlots.length + draft.state.settings.injuryReserveSlots);
      if (roster.length > max && roster.length > previous.length) throw new Error('That roster is at its player limit, including injury reserves.');
      if (roster.length - reserves.length > draft.state.settings.rosterSlots.length &&
          roster.length - reserves.length > previous.length - oldReserves.length) throw new Error('The regular roster is full. Free a regular slot before activating or adding a player.');
    }
    draft.updateMatchup(synced);
  };
  const withLineup = (next: WeeklyPlannerState, side: WeeklySide, lineup: WeeklyLineup) =>
    ({ ...next, [side === 'mine' ? 'myLineup' : 'opponentLineup']: lineup });
  const rosterFor = (side: WeeklySide) => (side === 'mine' ? mine : opponent).map(r => r.player);
  const lineupFor = (side: WeeklySide) => side === 'mine' ? myLineup : opponentLineup;
  const actions = {
    setStatsBasis(basis: StatsBasis) {
      if (!['projections', 'actuals'].includes(basis)) throw new Error('Choose a valid weekly stats basis.');
      update({ ...planner, statsBasis: basis });
    },
    importOpponent(rows: LineupImportRow[], ilConfirmed: boolean) {
      if (draft.state.source.isDemo) throw new Error('Load real season projections before importing a lineup.');
      update(importOpponentLineup(planner, rows, draft.state.players, slots, ilConfirmed));
    },
    setDates(start: string, end: string) {
      if (!validMatchupDates(start, end)) throw new Error('Choose valid inclusive dates spanning 1–14 days, matching your Yahoo matchup.');
      update({ ...planner, start, end, expectedGames: {} });
    },
    addPlayer(side: 'mine' | 'opponent', id: string, reserve = false) {
      if (draft.state.source.isDemo) throw new Error('Load real season projections before adding weekly players.');
      const player = ids.get(id);
      if (!player) throw new Error('Player not found in the current projection pool.');
      if ([...planner.myRosterIds, ...planner.opponentRosterIds].includes(id)) throw new Error('This player is already on one of the matchup rosters.');
      // reserve=true is only offered behind explicit Yahoo IL confirmation.
      const ilEligibleIds = reserve ? [...new Set([...(planner.ilEligibleIds ?? []), id])] : planner.ilEligibleIds;
      const lineup = lineupFor(side);
      const target = slots.find(s => !lineup[s.id] && (reserve ? s.kind === 'il' : s.kind !== 'il') && eligibleWeeklySlot(player, s, ilEligibleIds ?? []));
      if (!target) throw new Error(reserve ? 'The IL slots are full.' : 'No empty eligible regular slot. Move or remove a player to free one first.');
      const next = { ...planner, ilEligibleIds, [side === 'mine' ? 'myRosterIds' : 'opponentRosterIds']: [...(side === 'mine' ? planner.myRosterIds : planner.opponentRosterIds), id] };
      update(withLineup(next, side, { ...lineup, [target.id]: id }));
    },
    removePlayer(side: 'mine' | 'opponent', id: string) {
      const expectedGames = { ...planner.expectedGames }; delete expectedGames[id];
      const lineup = Object.fromEntries(Object.entries(lineupFor(side)).filter(([, pid]) => pid !== id));
      update(withLineup({ ...planner, expectedGames, ilEligibleIds: (planner.ilEligibleIds ?? []).filter(pid => pid !== id),
        myRosterIds: side === 'mine' ? planner.myRosterIds.filter(pid => pid !== id) : planner.myRosterIds,
        opponentRosterIds: side === 'opponent' ? planner.opponentRosterIds.filter(pid => pid !== id) : planner.opponentRosterIds }, side, lineup));
    },
    movePlayer(side: WeeklySide, id: string, targetSlotId: string) {
      update(withLineup(planner, side, moveWeeklyPlayer(lineupFor(side), rosterFor(side), slots, planner.ilEligibleIds ?? [], id, targetSlotId)));
    },
    moveOptions(side: WeeklySide, id: string) {
      return visibleWeeklySlots(lineupFor(side), slots).map(slot => {
        try { moveWeeklyPlayer(lineupFor(side), rosterFor(side), slots, planner.ilEligibleIds ?? [], id, slot.id); return { slot, allowed: true }; }
        catch (e) { return { slot, allowed: false, reason: e instanceof Error ? e.message : String(e) }; }
      });
    },
    setIlEligible(id: string, eligible: boolean) {
      if (![...planner.myRosterIds, ...planner.opponentRosterIds].includes(id)) throw new Error('Player is not on either weekly roster.');
      if (!eligible && [...(planner.myReserveIds ?? []), ...(planner.opponentReserveIds ?? [])].includes(id)) throw new Error('Move this player out of IL before removing Yahoo IL eligibility confirmation.');
      update({ ...planner, ilEligibleIds: eligible ? [...new Set([...(planner.ilEligibleIds ?? []), id])] : (planner.ilEligibleIds ?? []).filter(pid => pid !== id) });
    },
    applyOptimalLineup() {
      if (!result.analysis || request.error) throw new Error('Load a valid matchup and schedule before applying the optimal lineup.');
      const lineup = optimalWeeklyLineup(result.analysis, myLineup, slots);
      const issues = lineupErrors(lineup, rosterFor('mine'), slots, planner.ilEligibleIds ?? []);
      if (issues.length) throw new Error(issues[0]);
      update(withLineup(planner, 'mine', lineup));
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
      const ilEligibleIds = (planner.ilEligibleIds ?? []).filter(id => myRosterIds.includes(id) || planner.opponentRosterIds.includes(id));
      const next = prepareWeeklyPlanner({ ...planner, myRosterIds, myReserveIds: [], myLineup: undefined, ilEligibleIds }, draft.state.players, slots);
      update(next);
    },
    clearOpponent() {
      const expectedGames = { ...planner.expectedGames };
      for (const id of planner.opponentRosterIds) delete expectedGames[id];
      update({ ...planner, opponentRosterIds: [], opponentStarterIds: [], opponentReserveIds: [], opponentLineup: {}, expectedGames,
        ilEligibleIds: (planner.ilEligibleIds ?? []).filter(id => planner.myRosterIds.includes(id)) });
    },
  };
  return { draft, planner, mine, opponent, schedule, ...result, ...actions, activeSlots, slots, myLineup, opponentLineup, lineupErrors: errors, dataStatus,
    statsBasis, actuals, statsError, statsReady, statsLoading: statsBasis === 'actuals' && actualsRequest.isLoading,
    statsRefreshing: actualsRequest.isFetching, refreshActuals: () => actualsRequest.refetch(),
    statsSamples: [...mine, ...opponent].map(r => ({ id: r.player.id, name: r.player.name, ...r.player.weeklyStats! })),
    scheduleLoading: request.isLoading, scheduleRefreshing: request.isFetching,
    scheduleError: request.error instanceof Error ? request.error.message : request.error ? 'Schedule unavailable.' : null,
    refreshSchedule: () => request.refetch(), validDates };
}

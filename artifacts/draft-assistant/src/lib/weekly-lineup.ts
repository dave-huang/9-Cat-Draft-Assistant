import { assignRoster, eligible } from './draft-engine';
import type { LeagueSettings, Player, RosterSlot, WeeklyPlannerState } from './draft-types';
import { compareWeekly, totalWeeklyStats, type WeeklyAnalysis, type WeeklyPlayer } from './weekly-engine';

export type WeeklySide = 'mine' | 'opponent';
export type WeeklyLineup = Record<string, string>;
export interface WeeklySlot {
  id: string;
  label: string;
  slot: RosterSlot | 'IL';
  kind: 'active' | 'bench' | 'il';
}

export function weeklySlots(settings: LeagueSettings): WeeklySlot[] {
  const counts: Record<string, number> = {};
  return [...settings.rosterSlots, ...Array.from({ length: settings.injuryReserveSlots }, () => 'IL' as const)].map(slot => {
    const count = counts[slot] = (counts[slot] ?? 0) + 1;
    return { id: `${slot}-${count}`, label: slot === 'UTIL' || slot === 'BN' || slot === 'IL' ? `${slot} ${count}` : slot,
      slot, kind: slot === 'IL' ? 'il' : slot === 'BN' ? 'bench' : 'active' };
  });
}

export function eligibleWeeklySlot(player: Player, slot: WeeklySlot, ilEligible: readonly string[]) {
  return slot.slot === 'IL' ? ilEligible.includes(player.id) : eligible(player, slot.slot);
}

/** Legacy lists are migrated once. Existing manually selected IL placements are
 * retained; new IL moves require explicit Yahoo eligibility confirmation. */
export function prepareWeeklyPlanner(planner: WeeklyPlannerState, players: Player[], slots: WeeklySlot[]): WeeklyPlannerState {
  const byId = new Map(players.map(p => [p.id, p]));
  const seed = (roster: string[], reserves: string[], starters?: string[]) => {
    const lineup: WeeklyLineup = {};
    const il = slots.filter(s => s.kind === 'il');
    reserves.forEach((id, i) => { if (il[i]) lineup[il[i]!.id] = id; });
    const regular = roster.filter(id => !reserves.includes(id));
    const targets = slots.filter(s => starters ? s.kind === 'active' : s.kind !== 'il');
    const selected = (starters ?? regular).map(id => byId.get(id)).filter((p): p is Player => !!p);
    const fit = assignRoster(selected, targets.map(s => s.slot as RosterSlot));
    fit.assignment.forEach((a, i) => { if (a.player) lineup[targets[i]!.id] = a.player.id; });
    const remaining = regular.filter(id => !Object.values(lineup).includes(id));
    const bench = slots.filter(s => s.kind === 'bench' && !lineup[s.id]);
    remaining.forEach((id, i) => { if (bench[i]) lineup[bench[i]!.id] = id; });
    return lineup;
  };
  const mine = planner.myLineup ?? seed(planner.myRosterIds, planner.myReserveIds ?? []);
  const opponent = planner.opponentLineup ?? seed(planner.opponentRosterIds, planner.opponentReserveIds ?? [], planner.opponentStarterIds);
  return syncWeeklyLineups({ ...planner, ilEligibleIds: planner.ilEligibleIds ?? [...(planner.myReserveIds ?? []), ...(planner.opponentReserveIds ?? [])] }, mine, opponent, slots);
}

export function syncWeeklyLineups(planner: WeeklyPlannerState, mine: WeeklyLineup, opponent: WeeklyLineup, slots: WeeklySlot[]): WeeklyPlannerState {
  const occupants = (lineup: WeeklyLineup, kind: WeeklySlot['kind']) => slots.filter(s => s.kind === kind).flatMap(s => lineup[s.id] ? [lineup[s.id]!] : []);
  return { ...planner, myLineup: mine, opponentLineup: opponent,
    myReserveIds: occupants(mine, 'il'), opponentReserveIds: occupants(opponent, 'il'), opponentStarterIds: occupants(opponent, 'active') };
}

export function lineupErrors(lineup: WeeklyLineup, roster: Player[], slots: WeeklySlot[], ilEligible: readonly string[]): string[] {
  const errors: string[] = [], byId = new Map(roster.map(p => [p.id, p]));
  const assigned = new Set<string>();
  for (const [key, id] of Object.entries(lineup)) {
    const slot = slots.find(s => s.id === key), p = byId.get(id);
    if (!slot) errors.push(`Slot ${key} is not in the current league settings; reassign its player.`);
    else if (!p) errors.push(`A player in ${slot.label} is no longer on this roster.`);
    else if (!eligibleWeeklySlot(p, slot, ilEligible)) errors.push(`${p.name} is not eligible for ${slot.label}${slot.kind === 'il' ? '; confirm Yahoo IL eligibility first' : ''}.`);
    if (assigned.has(id)) errors.push('A player occupies more than one slot.');
    assigned.add(id);
  }
  for (const p of roster) if (!assigned.has(p.id)) errors.push(`${p.name} is unassigned. Move them into an eligible slot or remove them.`);
  return errors;
}

/** Moves never discard an occupant. An occupied destination is an atomic swap,
 * legal only when the displaced player also fits the source slot. */
export function moveWeeklyPlayer(lineup: WeeklyLineup, roster: Player[], slots: WeeklySlot[], ilEligible: readonly string[], id: string, targetId: string): WeeklyLineup {
  const p = roster.find(p => p.id === id), target = slots.find(s => s.id === targetId);
  if (!p || !target) throw new Error('Choose a roster player and an existing league slot.');
  if (!eligibleWeeklySlot(p, target, ilEligible)) throw new Error(`${p.name} is not eligible for ${target.label}${target.kind === 'il' ? '. Confirm their Yahoo IL eligibility first' : ''}.`);
  const sourceId = Object.keys(lineup).find(key => lineup[key] === id);
  if (sourceId === targetId) return lineup;
  const displacedId = lineup[targetId];
  if (displacedId) {
    const displaced = roster.find(p => p.id === displacedId), source = slots.find(s => s.id === sourceId);
    if (!displaced || !source || !eligibleWeeklySlot(displaced, source, ilEligible)) throw new Error(`Cannot swap: the player in ${target.label} cannot move into ${source?.label ?? 'an unassigned spot'}. Move that player to an empty eligible slot first.`);
  }
  const next = { ...lineup };
  // Remove even obsolete slot keys when repairing a changed league layout.
  if (sourceId) delete next[sourceId];
  next[targetId] = id;
  if (displacedId && sourceId) next[sourceId] = displacedId;
  return next;
}

export function currentWeeklyAnalysis(mine: WeeklyPlayer[], opponent: WeeklyPlayer[], mineLineup: WeeklyLineup, opponentLineup: WeeklyLineup, slots: WeeklySlot[]): WeeklyAnalysis {
  const starters = (rows: WeeklyPlayer[], lineup: WeeklyLineup) => slots.filter(s => s.kind === 'active').map(s => ({
    slot: s.slot as RosterSlot, player: rows.find(r => r.player.id === lineup[s.id])?.player ?? null,
  }));
  const myStarters = starters(mine, mineLineup), opponentIds = new Set(starters(opponent, opponentLineup).flatMap(s => s.player ? [s.player.id] : []));
  const myIds = new Set(myStarters.flatMap(s => s.player ? [s.player.id] : []));
  const myTotals = totalWeeklyStats(mine.filter(r => myIds.has(r.player.id))), opponentTotals = totalWeeklyStats(opponent.filter(r => opponentIds.has(r.player.id)));
  const categories = compareWeekly(myTotals, opponentTotals);
  return { starters: myStarters, bench: mine.filter(r => !myIds.has(r.player.id)), myTotals, opponentTotals, categories,
    expectedCategoryPoints: categories.reduce((sum, c) => sum + c.modelWinChance, 0), projectedWins: categories.filter(c => c.edge === 'ahead').length, evaluatedLineups: 1 };
}

export function optimalWeeklyLineup(analysis: WeeklyAnalysis, previous: WeeklyLineup, slots: WeeklySlot[]): WeeklyLineup {
  const next: WeeklyLineup = {};
  for (const s of slots.filter(s => s.kind === 'il')) if (previous[s.id]) next[s.id] = previous[s.id]!;
  const active = slots.filter(s => s.kind === 'active');
  analysis.starters.forEach((s, i) => { if (s.player) next[active[i]!.id] = s.player.id; });
  const bench = slots.filter(s => s.kind === 'bench'), regularBench = analysis.bench.filter(r => !r.reserve);
  if (regularBench.length > bench.length) throw new Error('The recommended lineup exceeds the available bench slots.');
  regularBench.forEach((r, i) => { next[bench[i]!.id] = r.player.id; });
  return next;
}

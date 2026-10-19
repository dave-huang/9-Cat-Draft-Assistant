import { CATEGORY_KEYS, type CategoryKey, type CategoryValues, type DraftAnalysis, type DraftState, type Player, type RosterSlot } from './draft-types';

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  fg: 'FG%', ft: 'FT%', threes: '3PM', points: 'PTS', rebounds: 'REB',
  assists: 'AST', steals: 'STL', blocks: 'BLK', turnovers: 'TO',
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]) => sum(values) / Math.max(1, values.length);
function catRecord(fn: (key: CategoryKey) => number): CategoryValues {
  return Object.fromEntries(CATEGORY_KEYS.map(key => [key, fn(key)])) as CategoryValues;
}
export function teamAtPick(overall: number, teamCount: number): number {
  const index = overall - 1, round = Math.floor(index / teamCount), offset = index % teamCount;
  return round % 2 ? teamCount - offset : offset + 1;
}
export function eligible(player: Player, slot: RosterSlot): boolean {
  if (slot === 'BN' || slot === 'UTIL') return true;
  if (slot === 'G') return player.positions.some(p => p === 'PG' || p === 'SG');
  if (slot === 'F') return player.positions.some(p => p === 'SF' || p === 'PF');
  return player.positions.includes(slot);
}
/** Maximum bipartite matching: flexible eligibility never greedily blocks another player. */
export function assignRoster(players: Player[], slots: RosterSlot[]) {
  const match = new Map<number, Player>();
  const ordered = [...players].sort((a, b) => a.positions.length - b.positions.length);
  const slotOrder = slots.map((slot, i) => ({ slot, i })).sort((a, b) => {
    const flexibility = (s: RosterSlot) => s === 'BN' ? 4 : s === 'UTIL' ? 3 : s === 'G' || s === 'F' ? 2 : 1;
    return flexibility(a.slot) - flexibility(b.slot);
  });
  const visit = (player: Player, visited: Set<number>): boolean => {
    for (const { slot, i } of slotOrder) {
      if (visited.has(i) || !eligible(player, slot)) continue;
      visited.add(i);
      const other = match.get(i);
      if (!other || visit(other, visited)) { match.set(i, player); return true; }
    }
    return false;
  };
  let fitted = 0;
  for (const player of ordered) if (visit(player, new Set())) fitted++;
  return { fitted, assignment: slots.map((slot, i) => ({ slot, player: match.get(i) ?? null })) };
}

function referencePercentages(players: Player[]) {
  const fga = sum(players.map(p => p.fga)), fta = sum(players.map(p => p.fta));
  return {
    fg: fga ? sum(players.map(p => p.fgm)) / fga : .47,
    ft: fta ? sum(players.map(p => p.ftm)) / fta : .78,
  };
}
function rawValues(p: Player, reference: { fg: number; ft: number }): CategoryValues {
  const availability = p.games / 82;
  return {
    fg: (p.fgm - reference.fg * p.fga) * availability,
    ft: (p.ftm - reference.ft * p.fta) * availability,
    points: p.points * availability, rebounds: p.rebounds * availability,
    assists: p.assists * availability, steals: p.steals * availability,
    blocks: p.blocks * availability, threes: p.threes * availability,
    turnovers: -p.turnovers * availability,
  };
}
function statistics(players: Player[]) {
  const reference = referencePercentages(players);
  const raws = players.map(p => rawValues(p, reference));
  const means = catRecord(k => mean(raws.map(p => p[k])));
  const deviations = catRecord(k => Math.sqrt(mean(raws.map(p => (p[k] - means[k]) ** 2))) || 1);
  return {
    reference,
    z: (p: Player) => {
      const raw = rawValues(p, reference);
      return catRecord(k => clamp((raw[k] - means[k]) / deviations[k], -6, 6));
    },
  };
}
function balancedValue(z: CategoryValues) {
  // Every category has positive equal baseline value; downside discourages specialists.
  return mean(CATEGORY_KEYS.map(k => z[k])) - .055 * mean(CATEGORY_KEYS.map(k => Math.max(0, -z[k]) ** 2));
}

export function analyzeDraft(state: DraftState): DraftAnalysis {
  const { settings, players, picks } = state;
  const byId = new Map(players.map(p => [p.id, p]));
  const draftedIds = new Set(picks.map(p => p.playerId));
  const roster = picks.filter(p => p.team === settings.myPosition).map(p => byId.get(p.playerId)!).filter(Boolean);
  const totalPicks = settings.teamCount * settings.rosterSlots.length;
  const nextPick = picks.length + 1;
  const manual = settings.trackingMode === 'manual';
  const complete = manual ? roster.length >= settings.rosterSlots.length : nextPick > totalPicks;
  const currentTeam = teamAtPick(nextPick, settings.teamCount);
  let myNextPick: number | null = null;
  for (let pick = nextPick; !manual && pick <= totalPicks; pick++) {
    if (teamAtPick(pick, settings.teamCount) === settings.myPosition) { myNextPick = pick; break; }
  }
  const picksUntilMine = myNextPick === null ? 0 : myNextPick - nextPick;
  const initialStats = statistics(players);
  // Use draftable population, not thousands of low-minute players that inflate value.
  const baseline = [...players]
    .sort((a, b) => balancedValue(initialStats.z(b)) - balancedValue(initialStats.z(a)))
    .slice(0, Math.max(24, totalPicks));
  const stats = statistics(baseline);
  const zById = new Map(players.map(p => [p.id, stats.z(p)]));
  const teamZ = catRecord(k => sum(roster.map(p => zById.get(p.id)![k])) / Math.sqrt(Math.max(1, roster.length)));
  const weights = catRecord(k => 1 + clamp(-teamZ[k], 0, 1.5));
  const rosterTotals = catRecord(k => {
    if (k === 'fg') {
      const attempts = sum(roster.map(p => p.fga * p.games));
      return attempts ? sum(roster.map(p => p.fgm * p.games)) / attempts : 0;
    }
    if (k === 'ft') {
      const attempts = sum(roster.map(p => p.fta * p.games));
      return attempts ? sum(roster.map(p => p.ftm * p.games)) / attempts : 0;
    }
    return sum(roster.map(p => p[k]));
  });
  const categories = CATEGORY_KEYS.map(key => ({
    key, label: CATEGORY_LABELS[key], value: rosterTotals[key], z: teamZ[key], priority: weights[key],
    status: !roster.length ? 'empty' as const : teamZ[key] > .5 ? 'strong' as const : teamZ[key] < -.5 ? 'needs-work' as const : 'balanced' as const,
  }));
  const overallSorted = [...players].sort((a, b) => balancedValue(zById.get(b.id)!) - balancedValue(zById.get(a.id)!));
  const ranks = new Map(overallSorted.map((p, i) => [p.id, i + 1]));
  const assignment = assignRoster(roster, settings.rosterSlots).assignment;
  const unmetSlots = assignment.filter(a => !a.player && a.slot !== 'BN' && a.slot !== 'UTIL').map(a => a.slot);
  const opportunities = new Map<RosterSlot, number>();
  for (const slot of unmetSlots) opportunities.set(slot, players.filter(p => !draftedIds.has(p.id) && eligible(p, slot)).length);
  const available = players.filter(p => !draftedIds.has(p.id));
  const candidates = available.map(player => {
    const z = zById.get(player.id)!;
    const overallValue = balancedValue(z);
    const weightedValue = sum(CATEGORY_KEYS.map(k => z[k] * weights[k])) / sum(CATEGORY_KEYS.map(k => weights[k]));
    const fillsSlot = assignRoster([...roster, player], settings.rosterSlots).fitted === roster.length + 1;
    const boosts = [...CATEGORY_KEYS].sort((a, b) => z[b] * weights[b] - z[a] * weights[a]);
    const strengths = [...CATEGORY_KEYS].filter(k => z[k] > .25).sort((a, b) => z[b] - z[a]).slice(0, 3);
    const weaknesses = [...CATEGORY_KEYS].filter(k => z[k] < -.5).sort((a, b) => z[a] - z[b]).slice(0, 3);
    const scarce = unmetSlots.filter(slot => eligible(player, slot) && (opportunities.get(slot) ?? 0) <= settings.teamCount * 2);
    const scarcityBonus = scarce.length ? .12 : 0;
    const needed = boosts.filter(k => weights[k] > 1.1 && z[k] > .1).slice(0, 2);
    const reasons: string[] = [];
    if (needed.length) reasons.push(`Helps your ${needed.map(k => CATEGORY_LABELS[k]).join(' and ')} shortfall without ignoring the other categories.`);
    else if (strengths.length) reasons.push(`Adds above-average ${strengths.map(k => CATEGORY_LABELS[k]).join(', ')} to a balanced build.`);
    else reasons.push('A depth option; compare the category tradeoffs before selecting.');
    if (scarce.length) reasons.push(`Fills a scarce ${[...new Set(scarce)].join('/')} position.`);
    const warnings: string[] = [];
    if (!fillsSlot) warnings.push('Does not fit a remaining roster slot with the current position eligibility.');
    if (player.positionsConflict) warnings.push('Yahoo eligibility changed and conflicts with your drafted roster. Saved positions were kept; review them in Yahoo.');
    else if (player.yahooEligibilityMissing) warnings.push('Not matched in the latest Yahoo eligibility feed. Positions are saved or unverified; confirm them in your Yahoo draft.');
    if (z.ft < -1) warnings.push('Volume-weighted FT% drag; later picks will need to offset it.');
    if (z.fg < -1) warnings.push('Volume-weighted FG% drag; later picks will need to offset it.');
    if (z.turnovers < -1) warnings.push('High turnover burden. Lower turnovers are better.');
    if (player.games < 60) warnings.push(`Only ${player.games} projected games; availability reduces season value.`);
    if (player.adp !== undefined && myNextPick !== null && player.adp < myNextPick + settings.teamCount && picksUntilMine > 0) {
      warnings.push('ADP suggests this player may be taken before your turn. ADP is not a guarantee.');
    }
    if (player.note && !state.source.isDemo) warnings.push(player.note);
    const status = (player.injuryStatus ?? '').toLowerCase();
    // Small, explicit uncertainty adjustment, not an invented games forecast.
    // Source GP remains intact and already accounts for expected missed games.
    const injuryPenalty = /\bout\b|injured|suspended/.test(status) ? .12 :
      /questionable|doubtful|day.to.day|dtd/.test(status) ? .04 : 0;
    if (injuryPenalty) warnings.push(`Current ${player.injuryStatus} designation: a small injury-uncertainty discount applies in addition to projected games. Check the report before picking.`);
    if (player.injuryNote) warnings.push(player.injuryNote);
    const rawScore = .6 * overallValue + .4 * weightedValue + scarcityBonus - injuryPenalty;
    return {
      player, rank: 0, overallRank: ranks.get(player.id)!,
      score: Math.round(clamp(50 + 20 * rawScore, 1, 99)),
      overallValue, categoryZ: z, strengths, weaknesses, reasons, warnings, fillsSlot,
      sortingScore: fillsSlot ? rawScore : rawScore - 100,
    };
  });
  candidates.sort((a, b) => b.sortingScore - a.sortingScore || a.overallRank - b.overallRank);
  const recommendations = candidates.map(({ sortingScore: _score, ...r }, i) => ({ ...r, rank: i + 1 }));
  const warnings: string[] = [];
  if (state.source.isDemo) warnings.push('Illustrative demo data only. Import verified season projections before using recommendations in a real draft.');
  if (!state.source.isDemo && state.source.fetchedAt && Date.now() - Date.parse(state.source.fetchedAt) > 24 * 60 * 60 * 1000) warnings.push('Projections were last retrieved over 24 hours ago. Refresh the player data in Settings before drafting.');
  if (state.injuryFeed && Date.now() - Date.parse(state.injuryFeed.checkedAt) > 15 * 60 * 1000) warnings.push('Injury checks are over 15 minutes old. Refresh injuries; unreported does not mean healthy.');
  if (players.length < totalPicks) warnings.push(`The player pool has ${players.length} players for ${totalPicks} draft picks. Import a larger pool.`);
  const rareMissing = [...new Set(unmetSlots)].filter(slot => (opportunities.get(slot) ?? 0) === 0);
  if (rareMissing.length) warnings.push(`No undrafted player can fill ${rareMissing.join(', ')}. Check imported Yahoo eligibility.`);
  if (!complete && !available.length) warnings.push('The player pool is exhausted; draft tracking cannot continue until the pool is corrected.');
  return {
    nextPick, round: Math.ceil(nextPick / settings.teamCount), currentTeam,
    isMyTurn: !manual && !complete && currentTeam === settings.myPosition,
    picksUntilMine, myNextPick, complete, roster, rosterAssignment: assignment,
    recommendations, categories, draftedIds, totalPicks, warnings,
  };
}
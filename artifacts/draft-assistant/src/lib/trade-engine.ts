import { CATEGORY_KEYS, type CategoryKey, type CategoryValues, type LeagueSettings, type Player } from './draft-types';
import { assignRoster, CATEGORY_LABELS } from './draft-engine';

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const cats = (fn: (k: CategoryKey) => number) => Object.fromEntries(CATEGORY_KEYS.map(k => [k, fn(k)])) as CategoryValues;
export interface TradeProfile {
  score: number;
  values: CategoryValues;
  z: CategoryValues;
  coverage: number;
}
export interface TradeIdea {
  id: string;
  partnerId: string;
  partnerName: string;
  give: Player[];
  receive: Player[];
  mineBefore: TradeProfile;
  mineAfter: TradeProfile;
  theirBefore: TradeProfile;
  theirAfter: TradeProfile;
  myGain: number;
  theirGain: number;
  /** Absolute package-value difference / larger package value. Not acceptance odds. */
  valueGap: number;
  adpGap?: number;
  gains: CategoryKey[];
  costs: CategoryKey[];
  theirGains: CategoryKey[];
  theirCosts: CategoryKey[];
  warnings: string[];
}
export interface TradeInput {
  pool: Player[];
  mine: Player[];
  myReserveIds: string[];
  partners: { id: string; name: string; players: Player[]; reserveIds: string[] }[];
  settings: LeagueSettings;
  lockedPlayerIds: string[];
  packageSize: 'one' | 'two' | 'both';
}
export interface TradeScan {
  ideas: TradeIdea[];
  warnings: string[];
  scanned: number;
  teamsAnalyzed: number;
}

export function tradeCandidate(player: Player): boolean {
  const status = (player.injuryStatus ?? '').trim();
  return !player.projectionUnavailable && !player.positionsConflict &&
    player.games >= 40 && (!status || /^(active|healthy|available)$/i.test(status));
}
const valueGap = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b, .0001);

/** Full-season outlook, not remaining-season estimates or the selected matchup.
 * Availability is the supplied projected GP/82, never actual GP or injury guesses.
 */
export function buildTradeModel(pool: Player[], settings: LeagueSettings) {
  const usable = pool.filter(p => !p.projectionUnavailable);
  const rawStats = (referencePool: Player[]) => {
    const fga = sum(referencePool.map(p => p.fga * p.games));
    const fta = sum(referencePool.map(p => p.fta * p.games));
    const fg = fga ? sum(referencePool.map(p => p.fgm * p.games)) / fga : .47;
    const ft = fta ? sum(referencePool.map(p => p.ftm * p.games)) / fta : .78;
    const raw = (p: Player) => cats(k => {
      const n = p.games / 82;
      if (k === 'fg') return (p.fgm - fg * p.fga) * n;
      if (k === 'ft') return (p.ftm - ft * p.fta) * n;
      return p[k] * n * (k === 'turnovers' ? -1 : 1);
    });
    const rows = referencePool.map(raw);
    const means = cats(k => sum(rows.map(r => r[k])) / Math.max(1, rows.length));
    const sd = cats(k => Math.sqrt(sum(rows.map(r => (r[k] - means[k]) ** 2)) / Math.max(1, rows.length)) || 1);
    const z = (p: Player) => { const r = raw(p); return cats(k => Math.max(-6, Math.min(6, (r[k] - means[k]) / sd[k]))); };
    return { z };
  };
  const initial = rawStats(usable);
  const count = Math.max(24, settings.teamCount * settings.rosterSlots.length);
  const orderValue = (z: CategoryValues) => sum(CATEGORY_KEYS.map(k => z[k]));
  const baseline = [...usable].sort((a, b) => orderValue(initial.z(b)) - orderValue(initial.z(a)) || a.id.localeCompare(b.id)).slice(0, count);
  const stats = rawStats(baseline);
  const zById = new Map(pool.map(p => [p.id, stats.z(p)]));
  const ranked = [...usable].sort((a, b) => orderValue(stats.z(b)) - orderValue(stats.z(a)) || a.id.localeCompare(b.id));
  const ranks = new Map<string, number>();
  for (let start = 0; start < ranked.length;) {
    let end = start + 1;
    const value = orderValue(zById.get(ranked[start]!.id)!);
    while (end < ranked.length && Math.abs(orderValue(zById.get(ranked[end]!.id)!) - value) < 1e-9) end++;
    // Equal projected values get the same average rank, never arbitrary name/ID value.
    for (let i = start; i < end; i++) ranks.set(ranked[i]!.id, (start + 1 + end) / 2);
    start = end;
  }
  // Smooth positive rank proxy. Package sums cannot cancel weak assets against stars.
  const market = (p: Player) => Math.pow(1 / ((ranks.get(p.id) ?? pool.length) + 12), .65);
  const adp = (p: Player) => Math.pow(1 / ((p.adp ?? 5000) + 12), .65);
  const activeSlots = settings.rosterSlots.filter(s => s !== 'BN');
  const profile = (roster: Player[], reserveIds: string[]): TradeProfile => {
    const regular = roster.filter(p => !reserveIds.includes(p.id));
    const z = cats(k => sum(regular.map(p => zById.get(p.id)![k])) / Math.sqrt(Math.max(1, regular.length)));
    const projected = (key: 'fgm' | 'fga' | 'ftm' | 'fta') => sum(regular.map(p => p[key] * p.games / 82));
    const values = cats(k => k === 'fg' ? (projected('fga') ? projected('fgm') / projected('fga') : 0) :
      k === 'ft' ? (projected('fta') ? projected('ftm') / projected('fta') : 0) :
        sum(regular.map(p => p[k] * p.games / 82)));
    // Strictly increasing and concave: every category matters, with bounded extra
    // attention to weakness. This is a fit index, never calibrated winning odds.
    const score = sum(CATEGORY_KEYS.map(k => 10 * (z[k] - .45 * Math.sqrt(1 + z[k] ** 2)))) / 9;
    return { z, values, score, coverage: assignRoster(regular, activeSlots).fitted };
  };
  return { market, adp, profile };
}

/** Conservative bilateral search: do not relax fairness just to produce results. */
export function recommendTrades(input: TradeInput): TradeScan {
  const { pool, mine, settings, myReserveIds, packageSize } = input;
  const result: TradeScan = { ideas: [], warnings: [], scanned: 0, teamsAnalyzed: 0 };
  const activeCount = settings.rosterSlots.filter(s => s !== 'BN').length;
  const rosterIssue = (players: Player[], reserves: string[]) => {
    const regular = players.filter(p => !reserves.includes(p.id));
    if (new Set(players.map(p => p.id)).size !== players.length || new Set(reserves).size !== reserves.length ||
        reserves.some(id => !players.some(p => p.id === id))) return 'has duplicate players or invalid IL entries';
    if (regular.length < activeCount) return `needs at least ${activeCount} non-IL players for a meaningful roster comparison`;
    if (regular.length > settings.rosterSlots.length || reserves.length > settings.injuryReserveSlots) return 'exceeds the regular roster or IL capacity';
    if (players.some(p => p.projectionUnavailable || p.positionsConflict)) return 'has missing projections or conflicting eligibility; refresh/correct player data first';
    return null;
  };
  const ownIssue = rosterIssue(mine, myReserveIds);
  if (ownIssue) { result.warnings.push(`Your team ${ownIssue}.`); return result; }
  if (pool.length < settings.teamCount * settings.rosterSlots.length) {
    result.warnings.push('The projection pool is too small for a league-sized valuation baseline. Load the full current-season pool.');
    return result;
  }
  const model = buildTradeModel(pool, settings);
  const mineBefore = model.profile(mine, myReserveIds);
  if (myReserveIds.length || input.partners.some(p => p.reserveIds.length)) result.warnings.push('IL players are excluded from active category-fit totals and offers. Reassess when they return; no return-to-play date is assumed.');
  if (mineBefore.coverage < activeCount) {
    result.warnings.push('Your regular roster cannot cover every active position. Correct eligibility or positional gaps before comparing trades.');
    return result;
  }
  if (mine.length - myReserveIds.length < settings.rosterSlots.length) result.warnings.push('Your regular roster is incomplete. Add the remaining players for reliable fit analysis.');
  const changes = (before: TradeProfile, after: TradeProfile, up: boolean) => CATEGORY_KEYS.filter(k =>
    up ? after.z[k] - before.z[k] > .025 : after.z[k] - before.z[k] < -.025)
    .sort((a, b) => up ? (after.z[b] - before.z[b]) - (after.z[a] - before.z[a]) : (after.z[a] - before.z[a]) - (after.z[b] - before.z[b]));
  const safeBalance = (before: TradeProfile, after: TradeProfile) => CATEGORY_KEYS.every(k =>
    // Trading a genuine surplus is acceptable if it remains above average.
    // Otherwise cap damage, never create a major weakness, or deepen an existing one.
    (after.z[k] >= .25 || after.z[k] - before.z[k] >= -.6) &&
    !(before.z[k] >= -1.5 && after.z[k] < -1.5) &&
    !(before.z[k] < -1.5 && after.z[k] < before.z[k] - .15));
  const packages = (roster: Player[], reserves: string[], locks: string[]) => {
    const candidates = roster.filter(p => !reserves.includes(p.id) && !locks.includes(p.id) && tradeCandidate(p));
    const groups: Player[][] = packageSize === 'two' ? [] : candidates.map(p => [p]);
    if (packageSize !== 'one') for (let a = 0; a < candidates.length; a++) for (let b = a + 1; b < candidates.length; b++) groups.push([candidates[a]!, candidates[b]!]);
    return groups;
  };
  const ownPackages = packages(mine, myReserveIds, input.lockedPlayerIds);
  const seen = new Set(mine.map(p => p.id));
  for (const partner of input.partners) {
    const issue = rosterIssue(partner.players, partner.reserveIds);
    if (issue) { result.warnings.push(`${partner.name} ${issue}.`); continue; }
    if (partner.players.some(p => seen.has(p.id))) {
      result.warnings.push(`${partner.name} shares a player with another entered roster. Fix ownership before analyzing this team.`); continue;
    }
    partner.players.forEach(p => seen.add(p.id));
    const theirBefore = model.profile(partner.players, partner.reserveIds);
    if (theirBefore.coverage < activeCount) { result.warnings.push(`${partner.name} cannot cover every active position; correct the roster first.`); continue; }
    if (partner.players.length - partner.reserveIds.length < settings.rosterSlots.length) result.warnings.push(`${partner.name} has an incomplete regular roster; suggestions are provisional.`);
    result.teamsAnalyzed++;
    for (const give of ownPackages) for (const receive of packages(partner.players, partner.reserveIds, [])) {
      if (give.length !== receive.length) continue;
      result.scanned++;
      const gap = valueGap(sum(give.map(model.market)), sum(receive.map(model.market)));
      if (gap > .12 || valueGap(Math.max(...give.map(model.market)), Math.max(...receive.map(model.market))) > .2) continue;
      const adpKnown = [...give, ...receive].every(p => p.adp !== undefined);
      const adpGap = adpKnown ? valueGap(sum(give.map(model.adp)), sum(receive.map(model.adp))) : undefined;
      if (adpGap !== undefined && adpGap > .2) continue;
      const ownNext = [...mine.filter(p => !give.some(g => g.id === p.id)), ...receive];
      const theirNext = [...partner.players.filter(p => !receive.some(g => g.id === p.id)), ...give];
      const mineAfter = model.profile(ownNext, myReserveIds), theirAfter = model.profile(theirNext, partner.reserveIds);
      const myGain = mineAfter.score - mineBefore.score, theirGain = theirAfter.score - theirBefore.score;
      if (myGain < .02 || theirGain < .02 || !safeBalance(mineBefore, mineAfter) || !safeBalance(theirBefore, theirAfter)) continue;
      if (mineAfter.coverage < activeCount || theirAfter.coverage < activeCount) continue;
      const warnings = ['Fit scores and player-value estimates are heuristics, not win or acceptance probabilities.'];
      if (adpKnown) warnings.push('ESPN draft ADP is a secondary reputation check, not a current trade price.');
      else warnings.push('Draft ADP is missing for part of this offer; reputation cross-check unavailable.');
      if ([...give, ...receive].some(p => p.yahooEligibilityMissing || !['Yahoo', 'Manual'].includes(p.positionsSource ?? ''))) warnings.push('Confirm unverified player eligibility in Yahoo before proposing.');
      result.ideas.push({
        id: `${partner.id}:${give.map(p => p.id).sort().join(',')}:${receive.map(p => p.id).sort().join(',')}`,
        partnerId: partner.id, partnerName: partner.name, give, receive,
        mineBefore, mineAfter, theirBefore, theirAfter, myGain, theirGain, valueGap: gap, adpGap,
        gains: changes(mineBefore, mineAfter, true), costs: changes(mineBefore, mineAfter, false),
        theirGains: changes(theirBefore, theirAfter, true), theirCosts: changes(theirBefore, theirAfter, false), warnings,
      });
    }
  }
  result.ideas.sort((a, b) => (b.myGain + .5 * b.theirGain) - (a.myGain + .5 * a.theirGain) || a.valueGap - b.valueGap || a.id.localeCompare(b.id));
  result.ideas = result.ideas.slice(0, 12);
  const excluded = mine.filter(p => !myReserveIds.includes(p.id) && !tradeCandidate(p)).map(p => p.name);
  if (excluded.length) result.warnings.push(`Not offered while availability/eligibility is uncertain: ${excluded.join(', ')}.`);
  return result;
}

export function tradePitch(idea: TradeIdea): string {
  const labels = (keys: CategoryKey[]) => keys.slice(0, 3).map(k => CATEGORY_LABELS[k]).join(', ') || 'category balance';
  return `Would you consider ${idea.give.map(p => p.name).join(' + ')} for ${idea.receive.map(p => p.name).join(' + ')}? This looks like it could help your ${labels(idea.theirGains)} while helping my ${labels(idea.gains)}. Both rosters keep their positional coverage. The projection-based value estimate is close, but I know it may differ from how you value these players. Happy to discuss.`;
}

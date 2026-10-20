import { useMemo, useState } from 'react';
import { useWeeklyPlanner } from '@/hooks/use-weekly';
import { CAT_LABEL, ConfirmButton, Notice, Panel, btn, errMsg, field, fmt } from '@/components/bits';
import { PlayerSearch, RosterRow, pct } from '@/components/weekly-parts';
import type { CategoryKey, Player, Position } from '@/lib/draft-types';

const when = (s?: string) => (s ? new Date(s).toLocaleString() : 'unknown');
const val = (k: CategoryKey, n: number) => (k === 'fg' || k === 'ft' ? pct(n) : fmt(n));

export default function Weekly() {
  const w = useWeeklyPlanner();
  const { planner, draft, analysis: computedAnalysis, schedule, dataStatus: ds } = w;
  const [error, setError] = useState('');
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const run = (fn: () => void) => { try { fn(); setError(''); } catch (e) { setError(errMsg(e)); } };
  const taken = useMemo(() => new Set([...planner.myRosterIds, ...planner.opponentRosterIds]), [planner]);
  const players = draft.state.players;
  const activeIds = new Set(planner.opponentStarterIds);
  const activeCount = w.activeSlots.length;
  const oppIncomplete = planner.opponentStarterIds.length < activeCount;
  const sv = start ?? planner.start, ev = end ?? planner.end;
  const demo = draft.state.source.isDemo;
  const unverified = [...w.mine, ...w.opponent].filter(({ player: p }) => !p.positionsVerified && p.positionsSource !== 'Manual' && (p.positionsSource !== 'Yahoo' || p.yahooEligibilityMissing || p.positionsConflict));
  const stale = [...w.mine, ...w.opponent].some(r => r.player.projectionUnavailable);

  let guard: string | null = null;
  if (demo) guard = 'Demo projections are illustrative. Load real projections in Settings to analyze a week.';
  else if (!w.validDates) guard = 'Choose valid inclusive dates spanning 1 to 14 days.';
  else if (w.scheduleLoading) guard = 'Loading schedule...';
  else if (w.scheduleError || !schedule) guard = 'Schedule unavailable. Retry to analyze.';
  else if (!schedule.games.some(g => !['postponed', 'canceled'].includes(g.status))) guard = 'No playable games in this window.';
  else if (!planner.myRosterIds.length) guard = 'Add players to your roster first.';
  else if (!planner.opponentStarterIds.length) guard = 'Add opponent players and mark starters Active.';
  const analysis = guard ? undefined : computedAnalysis;
  const editPositions = (player: Player) => {
    const value = window.prompt(`Enter ${player.name}'s positions from your Yahoo league (PG/SG/SF/PF/C). ${player.yahooPositions ? `Yahoo public positions: ${player.yahooPositions.join('/')}. ` : ''}Manual corrections take priority over public data.`, player.positions.join('/'));
    if (value === null) return;
    run(() => {
      const positions = value.toUpperCase().split(/[\/,\s]+/).filter(Boolean);
      if (!positions.length || positions.some(p => !['PG', 'SG', 'SF', 'PF', 'C'].includes(p))) throw new Error('Use PG, SG, SF, PF or C, separated by slashes.');
      draft.updatePlayerPositions(player.id, positions as Position[]);
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Weekly matchup</h1>
        <p className="text-sm text-muted-foreground">Weekly-locked lineup: each of the nine categories is its own win. Forecast uses per-game season projections across the full window, not live scores.</p>
      </div>
      {error && <Notice tone="error" testId="text-weekly-error">{error}</Notice>}
      {draft.saveError && <Notice tone="error">{draft.saveError}</Notice>}
      {ds.error && <Notice tone="error">{ds.error}</Notice>}
      {ds.eligibilityError && <Notice tone="error">{ds.eligibilityError}</Notice>}
      {w.scheduleError && <Notice tone="error">{w.scheduleError}</Notice>}
      {w.analysisError && <Notice tone="error">{w.analysisError}</Notice>}
      {unverified.length > 0 && <Notice tone="warn">Check Yahoo positions for {unverified.map(r => r.player.name).join(', ')} before trusting slot fit. Click a player’s positions below to correct them from your league.</Notice>}
      {stale && <Notice tone="warn">Some players are missing from the latest projection feed; saved projections are used.</Notice>}
      <Notice tone="info">Win chances are simplified independent Poisson-count and binomial-shooting normal approximations for planning. They are not calibrated probabilities or guaranteed wins. Copy recommended starters into Yahoo before the weekly lock; this app does not submit lineups. Older or started weeks can be explored but cannot change locked Yahoo lineups.</Notice>

      <Panel title="Matchup window">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">Start<input type="date" className={field} data-testid="input-start" value={sv} onChange={e => setStart(e.target.value)} /></label>
          <label className="text-xs">End<input type="date" className={field} data-testid="input-end" value={ev} onChange={e => setEnd(e.target.value)} /></label>
          <button className={btn.primary} data-testid="button-apply-dates" onClick={() => run(() => { w.setDates(sv, ev); setStart(null); setEnd(null); })}>Apply dates</button>
          <span className="text-xs text-muted-foreground">Changing dates clears games overrides; rosters stay.</span>
        </div>
        {(sv !== planner.start || ev !== planner.end) && <p className="mt-2 text-xs font-semibold text-primary">Unapplied dates: the forecast still uses {planner.start} through {planner.end}. Select Apply dates to change it.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground" data-testid="text-schedule-meta">
          <span>Applied: {planner.start} through {planner.end}</span>
          {schedule ? <span>{schedule.source} / {schedule.season} / {schedule.games.length} games / fetched {when(schedule.fetchedAt)}</span> : <span>No schedule loaded</span>}
          <button className={btn.ghost} data-testid="button-refresh-schedule" disabled={w.scheduleRefreshing || !w.validDates} onClick={() => run(() => { void w.refreshSchedule(); })}>
            {w.scheduleRefreshing ? 'Refreshing...' : w.scheduleError ? 'Retry schedule' : 'Refresh schedule'}
          </button>
        </div>
      </Panel>

      <Panel title="Data sources">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground [&>span]:min-w-0 [&>span]:[overflow-wrap:anywhere]">
          <span>Projections: {draft.state.source.label} {draft.state.source.season}, checked {when(draft.state.source.checkedAt ?? draft.state.source.fetchedAt ?? draft.state.source.importedAt)}</span>
          <span>Eligibility: {draft.state.eligibilityFeed ? `${draft.state.eligibilityFeed.source}, fetched ${when(draft.state.eligibilityFeed.fetchedAt)}` : 'never loaded'}</span>
          <span>Injuries: {draft.state.injuryFeed ? `checked ${when(draft.state.injuryFeed.checkedAt)}` : 'never checked'}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={btn.ghost} data-testid="button-refresh-projections" disabled={ds.loadingProjections} onClick={() => run(() => { void ds.refreshProjections(); })}>{ds.loadingProjections ? 'Loading...' : 'Refresh projections'}</button>
          <button className={btn.ghost} data-testid="button-refresh-injuries" disabled={ds.refreshing} onClick={() => run(() => { void ds.refreshInjuries(); })}>{ds.refreshing ? 'Checking...' : 'Refresh injuries'}</button>
          <button className={btn.ghost} data-testid="button-refresh-eligibility" disabled={ds.loadingEligibility} onClick={() => run(() => { void ds.refreshEligibility(); })}>{ds.loadingEligibility ? 'Loading...' : 'Refresh eligibility'}</button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Projection and eligibility snapshots may be cached and stale; verify before locking.</p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`My team (${planner.myRosterIds.length})`} aside={
          <ConfirmButton testId="button-use-draft" label="Use draft roster" confirmLabel="Replace my roster" description="Replaces this matchup roster with your Mine draft picks. Draft history is unchanged." onConfirm={() => run(w.useDraftRoster)} />
        }>
          <PlayerSearch side="mine" players={players} excluded={taken} onAdd={id => run(() => w.addPlayer('mine', id))} onAddIl={id => run(() => w.addPlayer('mine', id, true))} />
          {w.mine.length === 0 && <p className="mt-3 text-sm text-muted-foreground" data-testid="empty-mine">{planner.myRosterIds.length ? 'Roster rows appear once the schedule loads.' : 'No players yet. Search above or import your draft roster.'}</p>}
          <p className="mt-2 text-xs text-muted-foreground">IL reserves ({(planner.myReserveIds ?? []).length}/{draft.state.settings.injuryReserveSlots}) never score. Mirror changes in Yahoo and verify IL eligibility there; an ESPN Out status alone does not prove it. Leaving IL may require removing a regular player first.</p>
          <ul className="mt-2 divide-y">
            {w.mine.map(r => <RosterRow key={r.player.id} row={r} side="mine" onError={setError} onReserve={res => w.setMyReserve(r.player.id, res)} onPositions={() => editPositions(r.player)}
              onRemove={() => w.removePlayer('mine', r.player.id)} onGames={v => w.setExpectedGames(r.player.id, v)} />)}
          </ul>
        </Panel>
        <Panel title={`Opponent (${activeIds.size}/${activeCount} active)`} aside={
          <ConfirmButton testId="button-clear-opponent" label="Clear opponent" confirmLabel="Clear opponent" description="Removes every opponent player and their games overrides." disabled={!planner.opponentRosterIds.length} onConfirm={() => run(w.clearOpponent)} />
        }>
          {oppIncomplete && <div className="mb-2"><Notice tone="warn" testId="warn-opponent-incomplete">Opponent active roster is incomplete ({activeIds.size} of {activeCount}). Their totals are understated, so your edges are overstated.</Notice></div>}
          <PlayerSearch side="opponent" players={players} excluded={taken} onAdd={id => run(() => w.addPlayer('opponent', id))} />
          {w.opponent.length === 0 && <p className="mt-3 text-sm text-muted-foreground" data-testid="empty-opponent">{planner.opponentRosterIds.length ? 'Roster rows appear once the schedule loads.' : 'No opponent players yet. Only Active players count toward their totals.'}</p>}
          <ul className="mt-2 divide-y">
            {w.opponent.map(r => <RosterRow key={r.player.id} row={r} side="opponent" starterMode active={activeIds.has(r.player.id)} onError={setError} onPositions={() => editPositions(r.player)}
              onActive={a => w.setOpponentStarter(r.player.id, a)}
              onRemove={() => w.removePlayer('opponent', r.player.id)} onGames={v => w.setExpectedGames(r.player.id, v)} />)}
          </ul>
        </Panel>
      </div>

      {!analysis && guard && <Panel title="Analysis"><p className="text-sm text-muted-foreground" data-testid="text-analysis-guard">{guard}</p></Panel>}
      {!analysis && !guard && !w.analysisError && <Panel title="Analysis"><p className="text-sm text-muted-foreground">No analysis available.</p></Panel>}
      {analysis && (
        <>
          <Panel title="Recommended starters" aside={<span className="font-mono text-xs" data-testid="text-wins">{analysis.projectedWins} ahead / {fmt(analysis.expectedCategoryPoints, 2)} model pts / {analysis.evaluatedLineups} lineups</span>}>
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {analysis.starters.map((s, i) => (
                <li key={i} className="flex items-center gap-3 border-b py-1.5" data-testid={`row-starter-${i}`}>
                  <span className="w-10 rounded bg-secondary py-0.5 text-center font-mono text-xs font-semibold">{s.slot}</span>
                  <span className={`text-sm ${s.player ? 'font-semibold' : 'text-muted-foreground'}`}>{s.player ? s.player.name : 'Vacant'}</span>
                </li>
              ))}
            </ul>
            {analysis.starters.some(s => !s.player) && <p className="mt-3 text-xs text-muted-foreground">A vacancy is recommended where playing an available player would hurt the nine-category objective, usually through FG%, FT% or turnovers outweighing their counting stats. Players with 0 expected games cannot score.</p>}
            <p className="mt-3 text-xs"><span className="font-semibold">Regular bench (never scores):</span> {analysis.bench.filter(b => !b.reserve).map(b => b.player.name).join(', ') || 'none'}<br /><span className="font-semibold">IL reserves (separate from ordinary bench):</span> {analysis.bench.filter(b => b.reserve).map(b => b.player.name).join(', ') || 'none'}</p>
            <p className="mt-2 text-xs text-muted-foreground">Objective: maximize the sum of nine equal category win estimates (ties count half). No category is punted. This is not the chance of winning five.</p>
          </Panel>
          <Panel title="Nine categories" aside={<span className="font-mono text-xs">games {fmt(analysis.myTotals.games, 1)} vs {fmt(analysis.opponentTotals.games, 1)}</span>}>
            <ul className="divide-y">
              {analysis.categories.map(c => {
                const m = analysis.myTotals, o = analysis.opponentTotals;
                const sub = (t: typeof m) => c.key === 'fg' ? `${fmt(t.fgm)}/${fmt(t.fga)}` : c.key === 'ft' ? `${fmt(t.ftm)}/${fmt(t.fta)}` : '';
                const tone = c.edge === 'ahead' ? 'bg-accent text-accent-foreground' : c.edge === 'behind' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground';
                return (
                  <li key={c.key} className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_3.5rem_3rem] items-center gap-1 py-2 text-sm sm:grid-cols-[3rem_1fr_1fr_5rem_4rem] sm:gap-2" data-testid={`row-week-cat-${c.key}`}>
                    <span className="font-semibold">{CAT_LABEL[c.key]}</span>
                    <span className="font-mono">{val(c.key, c.mine)}<span className="block text-[10px] text-muted-foreground">{sub(m)}</span></span>
                    <span className="font-mono">{val(c.key, c.opponent)}<span className="block text-[10px] text-muted-foreground">{sub(o)}</span></span>
                    <span className={`rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase ${tone}`}>{c.edge}</span>
                    <span className="text-right font-mono text-xs" title="Model edge: estimated category points, ties half; not calibrated">{pct(c.modelWinChance)}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Columns: category, you, opponent, edge, model edge (estimated category points; ties count half, so a zero-attempt tie shows 50.0% and is not a literal calibrated win probability). Lower TO wins. Counts multiply per-game projections by expected active games.</p>
          </Panel>
        </>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useWeeklyPlanner } from '@/hooks/use-weekly';
import { CAT_LABEL, ConfirmButton, Notice, Panel, btn, errMsg, field, fmt } from '@/components/bits';
import { PlayerSearch, pct } from '@/components/weekly-parts';
import { OpponentScreenshotImport } from '@/components/opponent-screenshot-import';
import { LineupBoard } from '@/components/weekly-lineup-board';
import { WeeklyStatsBasis } from '@/components/weekly-stats-basis';
import { useLineupInteraction } from '@/hooks/use-lineup-interaction';
import type { CategoryKey, Player, Position } from '@/lib/draft-types';

const when = (s?: string) => (s ? new Date(s).toLocaleString() : 'unknown');
const val = (k: CategoryKey, n: number) => (k === 'fg' || k === 'ft' ? pct(n) : fmt(n));

export default function Weekly() {
  const w = useWeeklyPlanner();
  const { planner, draft, analysis: optimal, currentAnalysis, schedule, dataStatus: ds } = w;
  const [error, setError] = useState('');
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const run = (fn: () => void) => { try { fn(); setError(''); } catch (e) { setError(errMsg(e)); } };
  const taken = useMemo(() => new Set([...planner.myRosterIds, ...planner.opponentRosterIds]), [planner]);
  const players = draft.state.players;
  const activeSlots = w.slots.filter(s => s.kind === 'active');
  const oppFilled = activeSlots.filter(s => w.opponentLineup[s.id]).length;
  const oppIncomplete = oppFilled < activeSlots.length;
  const lineupBad = w.lineupErrors.mine.length + w.lineupErrors.opponent.length > 0;
  const ilSet = new Set(planner.ilEligibleIds ?? []);
  const ix = useLineupInteraction(w, setError);
  const board = (side: 'mine' | 'opponent') => <LineupBoard side={side} w={w} ix={ix} ilSet={ilSet} run={run} onError={setError} editPositions={editPositions} />;
  const sv = start ?? planner.start, ev = end ?? planner.end;
  const demo = draft.state.source.isDemo;
  const unverified = [...w.mine, ...w.opponent].filter(({ player: p }) => !p.positionsVerified && p.positionsSource !== 'Manual' && (p.positionsSource !== 'Yahoo' || p.yahooEligibilityMissing || p.positionsConflict));
  const stale = [...w.mine, ...w.opponent].some(r => r.player.projectionUnavailable && r.player.weeklyStats?.basis !== 'actuals');

  let guard: string | null = null;
  if (demo) guard = 'Demo projections are illustrative. Load real projections in Settings to analyze a week.';
  else if (!w.statsReady) guard = w.statsError ?? 'Loading season-to-date statistics...';
  else if (!w.validDates) guard = 'Choose valid inclusive dates spanning 1 to 14 days.';
  else if (w.scheduleLoading) guard = 'Loading schedule...';
  else if (w.scheduleError || !schedule) guard = 'Schedule unavailable. Retry to analyze.';
  else if (!schedule.games.some(g => !['postponed', 'canceled'].includes(g.status))) guard = 'No playable games in this window.';
  else if (!planner.myRosterIds.length) guard = 'Add players to your roster first.';
  else if (lineupBad) guard = 'Fix the lineup errors above to see a trusted forecast.';
  const analysis = guard ? undefined : currentAnalysis;
  const rec = guard ? undefined : optimal;
  const gain = rec && analysis ? rec.expectedCategoryPoints - analysis.expectedCategoryPoints : 0;
  const editPositions = (player: Player) => {
    const value = window.prompt(`Enter ${player.name}'s positions from your Yahoo league (PG/SG/SF/PF/C). ${player.yahooPositions ? `Yahoo public positions: ${player.yahooPositions.join('/')}. ` : ''}Manual corrections take priority over public data.`, player.positions.join('/'));
    if (value === null) return;
    run(() => {
      const positions = value.toUpperCase().split(/[\/,\s]+/).filter(Boolean);
      if (!positions.length || positions.some(p => !['PG', 'SG', 'SF', 'PF', 'C'].includes(p))) throw new Error('Use PG, SG, SF, PF or C, separated by slashes.');
      draft.updatePlayerPositions(player.id, positions as Position[]);
    });
  };
  const applyOptimal = () => run(() => {
    w.applyOptimalLineup();
    ix.complete('Optimal lineup applied. Projections updated.');
  });

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Weekly matchup</h1>
        <p className="text-xs text-muted-foreground">Weekly lock · Nine equally weighted categories · Only starters score · Changes save automatically</p>
      </div>
      {error && <Notice tone="error" testId="text-weekly-error">{error}</Notice>}
      {draft.saveError && <Notice tone="error">{draft.saveError}</Notice>}
      {ds.error && <Notice tone="error">{ds.error}</Notice>}
      {ds.eligibilityError && <Notice tone="error">{ds.eligibilityError}</Notice>}
      {w.scheduleError && <Notice tone="error">{w.scheduleError}</Notice>}
      {w.analysisError && <Notice tone="error">{w.analysisError}</Notice>}
      {unverified.length > 0 && <Notice tone="warn"><details><summary className="cursor-pointer">Check Yahoo positions for {unverified.length} player{unverified.length === 1 ? '' : 's'}. Open player Details → Positions to correct.</summary><p className="mt-1 text-xs">{unverified.map(r => r.player.name).join(', ')}</p></details></Notice>}
      {stale && <Notice tone="warn">Some players are missing from the latest projection feed; saved projections are used.</Notice>}

      <section className="rounded-lg border bg-card px-3 py-2" aria-label="Matchup dates and data">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Matchup</span>
          <label className="flex items-center gap-1.5 text-xs">From<input type="date" className={`${field} !w-36 !py-1 !text-xs`} data-testid="input-start" value={sv} onChange={e => setStart(e.target.value)} /></label>
          <label className="flex items-center gap-1.5 text-xs">To<input type="date" className={`${field} !w-36 !py-1 !text-xs`} data-testid="input-end" value={ev} onChange={e => setEnd(e.target.value)} /></label>
          <button className={`${btn.ghost} !py-1 !text-xs`} disabled={sv === planner.start && ev === planner.end} data-testid="button-apply-dates" onClick={() => run(() => { w.setDates(sv, ev); setStart(null); setEnd(null); })}>Apply dates</button>
          <span className="ml-auto text-[11px] text-muted-foreground">{w.scheduleLoading ? 'Loading schedule…' : schedule ? `${schedule.games.length} scheduled games · ${schedule.season}` : 'Schedule not loaded'}</span>
        </div>
        {(sv !== planner.start || ev !== planner.end) && <p className="mt-2 text-xs font-semibold text-primary">Unapplied dates. Forecast still uses {planner.start} through {planner.end}. Applying dates clears expected-games overrides; rosters stay.</p>}
        <WeeklyStatsBasis basis={w.statsBasis} onChange={basis => run(() => w.setStatsBasis(basis))}
          actuals={w.actuals} loading={w.statsLoading} refreshing={w.statsRefreshing} error={w.statsError}
          onRefresh={() => { void w.refreshActuals(); }} projectionSeason={draft.state.source.season}
          projectionLabel={draft.state.source.label} samples={w.statsSamples} demo={demo} />
        <details className="mt-1.5 border-t pt-1.5 text-xs" data-testid="details-data">
          <summary className="cursor-pointer font-medium text-muted-foreground">Data sources & refresh <span className="ml-2 font-normal">ESPN {w.statsBasis === 'actuals' ? 'actuals' : 'projections'} / injuries · Yahoo positions</span></summary>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground [&>span]:[overflow-wrap:anywhere]" data-testid="text-schedule-meta">
            <span>Applied: {planner.start} through {planner.end}</span>
            {schedule ? <span>{schedule.source} / {schedule.season} / {schedule.games.length} games / fetched {when(schedule.fetchedAt)}</span> : <span>No schedule loaded</span>}
            <button className={btn.ghost} data-testid="button-refresh-schedule" disabled={w.scheduleRefreshing || !w.validDates} onClick={() => run(() => { void w.refreshSchedule(); })}>
              {w.scheduleRefreshing ? 'Refreshing...' : w.scheduleError ? 'Retry schedule' : 'Refresh schedule'}
            </button>
          </div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            <p>Projections: {draft.state.source.label} {draft.state.source.season}, checked {when(draft.state.source.checkedAt ?? draft.state.source.fetchedAt ?? draft.state.source.importedAt)}</p>
            <p>Eligibility: {draft.state.eligibilityFeed ? `${draft.state.eligibilityFeed.source}, fetched ${when(draft.state.eligibilityFeed.fetchedAt)}` : 'never loaded'}</p>
            <p>Injuries: {draft.state.injuryFeed ? `checked ${when(draft.state.injuryFeed.checkedAt)}` : 'never checked'}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={btn.ghost} data-testid="button-refresh-projections" disabled={ds.loadingProjections} onClick={() => run(() => { void ds.refreshProjections(); })}>{ds.loadingProjections ? 'Loading...' : 'Refresh projections'}</button>
            <button className={btn.ghost} data-testid="button-refresh-injuries" disabled={ds.refreshing} onClick={() => run(() => { void ds.refreshInjuries(); })}>{ds.refreshing ? 'Checking...' : 'Refresh injuries'}</button>
            <button className={btn.ghost} data-testid="button-refresh-eligibility" disabled={ds.loadingEligibility} onClick={() => run(() => { void ds.refreshEligibility(); })}>{ds.loadingEligibility ? 'Loading...' : 'Refresh eligibility'}</button>
          </div>
          <p className="mt-2 text-muted-foreground">Snapshots may be cached and stale; verify before locking. Changing dates clears all games overrides; rosters stay.</p>
        </details>
      </section>

      <div className="sticky z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card/95 px-3 py-2 shadow-sm backdrop-blur" style={{ top: demo ? 80 : 54 }} data-testid="bar-selection">
        <div className="min-w-0 basis-full text-sm lg:basis-0 lg:flex-1" aria-live="polite" role="status" data-testid="text-lineup-status">
          {ix.source ? <><span className="font-semibold">Moving {[...w.mine, ...w.opponent].find(r => r.player.id === ix.source!.id)?.player.name ?? 'player'}</span> <span className="text-xs text-muted-foreground">· {ix.source.side === 'mine' ? 'My team' : 'Opponent'} · Choose a highlighted slot. Esc cancels.</span></> : <span className="text-xs text-muted-foreground"><span className="lg:hidden">Drag a grip, or tap it then a position slot.</span><span className="hidden lg:inline">Drag a player’s grip to move. Or click the grip, then a slot. Legal occupied slots swap.</span></span>}
          <span className="sr-only">{ix.announcement}</span>
        </div>
        {ix.source && <button type="button" className={btn.ghost} data-testid="button-cancel-move" onClick={ix.cancel}>Cancel move</button>}
        {analysis && <span className="whitespace-nowrap text-xs" data-testid="text-current-score" title="Current lineup's sum of category win estimates; ties count half. Not a guaranteed score."><strong className="font-mono">{fmt(analysis.expectedCategoryPoints, 2)}</strong><span className="text-muted-foreground"> / 9 model pts</span></span>}
        {rec && <span className="whitespace-nowrap font-mono text-xs text-accent" data-testid="text-improvement-inline">{gain >= 0.005 ? '+' : ''}{fmt(gain, 2)} with optimal</span>}
        <button className={`${btn.primary} ml-auto`} data-testid="button-apply-optimal-top" disabled={!rec} onClick={applyOptimal}>Apply optimal lineup</button>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Panel title={`My team · ${planner.myRosterIds.length} players`} className="[&>div]:!p-3 [&>header]:!px-3 [&>header]:!py-2" aside={
          <ConfirmButton testId="button-use-draft" label="Use draft roster" confirmLabel="Replace my roster" description="Replaces this matchup roster with your Mine draft picks. Draft history is unchanged." onConfirm={() => run(w.useDraftRoster)} />
        }>
          <PlayerSearch side="mine" players={players} excluded={taken} onAdd={id => run(() => w.addPlayer('mine', id))} onAddIl={id => run(() => { if (!window.confirm('Confirm this player is actually Yahoo IL eligible in your league? ESPN Out status does not prove it.')) return; w.addPlayer('mine', id, true); })} />
          {w.mine.length === 0 && <p className="mt-2 text-xs text-muted-foreground" data-testid="empty-mine">Search to add players, or use your draft roster.</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground" data-testid="text-roster-count-mine">
            <span><strong className="text-foreground">{activeSlots.filter(s => w.myLineup[s.id]).length}/{activeSlots.length}</strong> active</span>
            <span title="All starters and benched players count toward the 12 non-IL spots."><strong className="text-foreground">{planner.myRosterIds.length - (planner.myReserveIds?.length ?? 0)}/{draft.state.settings.rosterSlots.length}</strong> non-IL</span>
            <span><strong className="text-foreground">{(planner.myReserveIds ?? []).length}/{draft.state.settings.injuryReserveSlots}</strong> IL</span>
            <span className="ml-auto">Games: expected / scheduled</span>
          </div>
          {board('mine')}
        </Panel>
        <Panel title={`Opponent · ${planner.opponentRosterIds.length} players`} className="[&>div]:!p-3 [&>header]:!px-3 [&>header]:!py-2" aside={
          <div className="flex items-center gap-1.5">
            <OpponentScreenshotImport w={w} onImported={() => ix.complete('Opponent lineup imported. Projections updated.')} />
            <ConfirmButton testId="button-clear-opponent" label="Clear opponent" confirmLabel="Clear opponent" description="Removes every opponent player and their games overrides." disabled={!planner.opponentRosterIds.length} onConfirm={() => run(w.clearOpponent)} />
          </div>
        }>
          <PlayerSearch side="opponent" players={players} excluded={taken} onAdd={id => run(() => w.addPlayer('opponent', id))} onAddIl={id => run(() => { if (!window.confirm('Confirm this player is actually Yahoo IL eligible in your opponent’s league lineup? ESPN Out status does not prove it.')) return; w.addPlayer('opponent', id, true); })} />
          {w.opponent.length === 0 && <p className="mt-2 text-xs text-muted-foreground" data-testid="empty-opponent">Search to add your opponent’s players.</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground" data-testid="text-roster-count-opponent">
            <span><strong className="text-foreground">{oppFilled}/{activeSlots.length}</strong> active</span>
            <span title="All starters and benched players count toward the 12 non-IL spots."><strong className="text-foreground">{planner.opponentRosterIds.length - (planner.opponentReserveIds?.length ?? 0)}/{draft.state.settings.rosterSlots.length}</strong> non-IL</span>
            <span><strong className="text-foreground">{planner.opponentReserveIds?.length ?? 0}/{draft.state.settings.injuryReserveSlots}</strong> IL</span>
            <span className="ml-auto">Games: expected / scheduled</span>
          </div>
          {board('opponent')}
          {oppIncomplete && planner.opponentRosterIds.length > 0 && <p className="mt-2 text-xs text-muted-foreground" data-testid="warn-opponent-incomplete">Uses {oppFilled}/{activeSlots.length} active slots. Vacancies can be intentional; match their locked Yahoo lineup.</p>}
        </Panel>
      </div>
      <p className="text-[11px] text-muted-foreground">Bench as many players as needed; all count toward 12 non-IL spots. Bench and IL never score. IL requires your Yahoo eligibility confirmation. Player Details contains eligibility, schedule, and roster controls.</p>

      {!analysis && guard && <Panel title="Analysis"><p className="text-sm text-muted-foreground" data-testid="text-analysis-guard">{guard}</p></Panel>}
      {!analysis && !guard && !w.analysisError && <Panel title="Analysis"><p className="text-sm text-muted-foreground">No analysis available.</p></Panel>}
      {guard === null && !rec && !w.analysisError && <Panel title="Optimal recommendation"><button className={btn.primary} data-testid="button-apply-optimal" disabled>Apply optimal lineup</button></Panel>}
      {rec && (
        <Panel title="Optimal recommendation" aside={<span className="font-mono text-xs" data-testid="text-wins">{rec.projectedWins} ahead / {fmt(rec.expectedCategoryPoints, 2)} model pts / {rec.evaluatedLineups} lineups</span>}>
            <p className="mb-2 text-xs" data-testid="text-improvement">{analysis ? `${gain >= 0.005 ? '+' : ''}${fmt(gain, 2)} model pts vs your current lineup (${fmt(analysis.expectedCategoryPoints, 2)}).` : ''}</p>
            <button className={`${btn.primary} mb-3`} data-testid="button-apply-optimal" disabled={!rec} onClick={applyOptimal}>Apply optimal lineup</button>
            <details data-testid="details-optimal"><summary className="mb-2 cursor-pointer text-sm font-semibold">View recommended starters and bench</summary>
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {rec.starters.map((s, i) => (
                <li key={i} className="flex items-center gap-3 border-b py-1.5" data-testid={`row-starter-${i}`}>
                  <span className="w-10 rounded bg-secondary py-0.5 text-center font-mono text-xs font-semibold">{s.slot}</span>
                  <span className={`text-sm ${s.player ? 'font-semibold' : 'text-muted-foreground'}`}>{s.player ? s.player.name : 'Vacant'}</span>
                </li>
              ))}
            </ul>
            {rec.starters.some(s => !s.player) && <p className="mt-3 text-xs text-muted-foreground">A vacancy is recommended where playing an available player would hurt the nine-category objective, usually through FG%, FT% or turnovers outweighing their counting stats. Players with 0 expected games cannot score.</p>}
            <p className="mt-3 text-xs"><span className="font-semibold">Regular bench (never scores):</span> {rec.bench.filter(b => !b.reserve).map(b => b.player.name).join(', ') || 'none'}<br /><span className="font-semibold">IL reserves (separate from ordinary bench):</span> {rec.bench.filter(b => b.reserve).map(b => b.player.name).join(', ') || 'none'}</p>
            <p className="mt-2 text-xs text-muted-foreground">Objective: maximize the sum of nine equal category win estimates (ties count half). No category is punted. This is not the chance of winning five.</p>
            </details>
          </Panel>
      )}
      <details className="rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground" data-testid="details-methodology"><summary className="cursor-pointer font-semibold">How projections work & important limitations</summary><p className="mt-2">Forecasts use the selected stats basis: season projections or current regular-season per-game averages, not live scores. Missing actuals use clearly labeled saved projections. Counting stats multiply per-game rates by expected active games. FG% and FT% divide total expected makes by total attempts, weighted by games. Lower turnovers wins. Actual averages use the latest retrieved season totals even when exploring a past matchup; they are not a historical as-of-week snapshot.</p><p className="mt-2">Win chances are simplified independent Poisson-count and binomial-shooting normal approximations for planning. They are not calibrated probabilities or guaranteed wins. Copy recommended starters into Yahoo before the weekly lock; this app does not submit lineups. Older or started weeks can be explored but cannot change locked Yahoo lineups.</p></details>
      <p className="text-[11px] text-muted-foreground">Planning estimates, not guaranteed wins. Apply here, then copy your lineup into Yahoo before the weekly lock.</p>
      {analysis && (
        <>
          <Panel title="Current lineup: nine categories" aside={<span className="font-mono text-xs">games {fmt(analysis.myTotals.games, 1)} vs {fmt(analysis.opponentTotals.games, 1)}</span>}>
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_3.5rem_3rem] gap-1 border-b pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[3rem_1fr_1fr_5rem_4rem] sm:gap-2"><span>Cat</span><span>You</span><span>Opponent</span><span className="text-center">Edge</span><span className="text-right">Model</span></div>
            <ul className="divide-y">
              {analysis.categories.map(c => {
                const m = analysis.myTotals, o = analysis.opponentTotals;
                const sub = (t: typeof m) => c.key === 'fg' ? `${fmt(t.fgm)}/${fmt(t.fga)}` : c.key === 'ft' ? `${fmt(t.ftm)}/${fmt(t.fta)}` : '';
                const tone = c.edge === 'ahead' ? 'bg-accent text-accent-foreground' : c.edge === 'behind' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground';
                return (
                  <li key={c.key} className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_3.5rem_3rem] items-center gap-1 py-1 text-sm sm:grid-cols-[3rem_1fr_1fr_5rem_4rem] sm:gap-2" data-testid={`row-week-cat-${c.key}`}>
                    <span className="font-semibold">{CAT_LABEL[c.key]}</span>
                    <span className="font-mono">{val(c.key, c.mine)}<span className="block text-[10px] text-muted-foreground">{sub(m)}</span></span>
                    <span className="font-mono">{val(c.key, c.opponent)}<span className="block text-[10px] text-muted-foreground">{sub(o)}</span></span>
                    <span className={`rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase ${tone}`}>{c.edge}</span>
                    <span className="text-right font-mono text-xs" title="Model edge: estimated category points, ties half; not calibrated">{pct(c.modelWinChance)}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Columns: category, you, opponent, edge, model edge (estimated category points; ties count half, so a zero-attempt tie shows 50.0% and is not a literal calibrated win probability). Lower TO wins. Counts multiply selected per-game rates by expected active games.</p>
          </Panel>
        </>
      )}
    </div>
  );
}

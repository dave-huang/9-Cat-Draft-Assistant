import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Lock, LockOpen, RefreshCw } from 'lucide-react';
import { Notice, Panel, btn, errMsg, field } from '@/components/bits';
import { TradeIdeaCard } from '@/components/trade-idea-card';
import { TradePartnerEditor } from '@/components/trade-partner-editor';
import { useTrades } from '@/hooks/use-trades';

const when = (s?: string) => (s ? new Date(s).toLocaleString() : 'unknown');

export default function Trades() {
  const t = useTrades();
  const { draft, dataStatus: ds, workspace, mine, reserveIds, partners, result } = t;
  const { state } = draft;
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [selected, setSelected] = useState('');
  useEffect(() => {
    document.title = 'Trades - 9-Cat Draft Assistant';
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'description'); document.head.appendChild(m); }
    m.setAttribute('content', 'Find balanced, fair-minded 9-category trade ideas that help both teams, from saved full-season projections.');
  }, []);
  const sel = partners.find(p => p.id === selected)?.id ?? partners[0]?.id ?? '';
  const run = (fn: () => void) => { try { fn(); setError(''); } catch (e) { setError(errMsg(e)); } };
  const max = state.settings.teamCount - 1;
  const add = () => run(() => {
    if (!newName.trim()) throw new Error('Enter a team name first.');
    if (partners.length >= max) throw new Error(`Your league has ${state.settings.teamCount} teams, so at most ${max} partners can be saved.`);
    setSelected(t.addPartner(newName)); setNewName('');
  });
  const generate = async () => { try { setError(''); await t.generate(); } catch (e) { setError(errMsg(e)); } };
  const refresh = async () => { try { await ds.refreshProjections(); } catch (e) { setError(errMsg(e)); } };
  const src = state.source;
  const ownIl = new Set(reserveIds);
  const noTeam = !mine.length;

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Trades</h1>
        <p className="text-sm text-muted-foreground">Ideas that help your balanced 9-cat team and are reasonable to the other manager. Nothing is sent or executed.</p>
      </div>
      {error && <Notice tone="error" testId="trade-error">{error}</Notice>}
      {noTeam && (
        <Notice tone="warn" testId="trade-setup">
          Your team is empty. Add your roster on <Link href="/weekly" className="underline">Weekly</Link> (or draft players on <Link href="/" className="underline">Live draft</Link>), then save partner rosters here.
        </Notice>
      )}
      {src.isDemo && <Notice tone="warn">Demo players loaded. Refresh player data before evaluating real trades.</Notice>}

      <Panel title="Player data" aside={<button type="button" className={btn.ghost} disabled={ds.loadingProjections} onClick={refresh} data-testid="button-trade-refresh"><RefreshCw className={`h-3.5 w-3.5 ${ds.loadingProjections ? 'animate-spin' : ''}`} />{ds.loadingProjections ? 'Refreshing...' : 'Refresh player data'}</button>}>
        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2" data-testid="trade-source">
          <div><dt className="inline text-muted-foreground">Projections: </dt><dd className="inline">{src.label} ({src.season}), fetched {when(src.fetchedAt ?? src.importedAt)}</dd></div>
          <div><dt className="inline text-muted-foreground">Injuries checked: </dt><dd className="inline">{when(state.injuryFeed?.checkedAt)}</dd></div>
        </dl>
        {!state.injuryFeed && <p className="mt-1 text-xs text-destructive">Injury data has not been checked. Availability may be out of date.</p>}
        {state.injuryFeed && Date.now() - Date.parse(state.injuryFeed.checkedAt) > 15 * 60_000 && <p className="mt-1 text-xs text-destructive">Injury checks are over 15 minutes old. Refresh before proposing a trade; no injury report is not proof of good health.</p>}
        {src.fetchedAt && Date.now() - Date.parse(src.fetchedAt) > 24 * 60 * 60_000 && <p className="mt-1 text-xs text-destructive">These projections were retrieved over 24 hours ago. Refresh before relying on the scan.</p>}
        {ds.error && <div className="mt-2"><Notice tone="error" testId="trade-refresh-error">{ds.error} Saved data was kept and is not guaranteed current.</Notice></div>}
        {ds.success && <div className="mt-2"><Notice tone="ok">{ds.success}</Notice></div>}
        <p className="mt-2 text-[11px] text-muted-foreground">Scan uses saved full-season forecasts, not remaining-season forecasts or the Weekly basis.</p>
      </Panel>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel title={`Your team (${t.ownRosterSource}, read only)`} aside={<Link href="/weekly" className="text-xs underline" data-testid="link-trade-edit-weekly">Edit on Weekly</Link>}>
          <p className="mb-2 text-xs text-muted-foreground" data-testid="text-trade-own-count"><strong className="text-foreground">{mine.length - reserveIds.length}</strong> regular, <strong className="text-foreground">{reserveIds.length}</strong> IL. Lock a player to keep him out of every offer.</p>
          <ul className="divide-y rounded-md border">
            {mine.map(p => {
              const locked = workspace.lockedPlayerIds.includes(p.id);
              const il = ownIl.has(p.id);
              const status = p.injuryStatus?.trim();
              const flagged = !!status && !/^(active|healthy|available)$/i.test(status);
              return (
                <li key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm" data-testid={`row-trade-mine-${p.id}`}>
                  <span className="min-w-0 flex-1"><strong className="font-medium">{p.name}</strong> <span className="text-[11px] text-muted-foreground">{p.positions.join('/')} - {p.team}</span>
                    {il && <span className="ml-1.5 rounded bg-secondary px-1 text-[10px] font-semibold">IL, not offered</span>}
                    {!il && (flagged || p.projectionUnavailable || p.positionsConflict || p.games < 40) && <span className="ml-1.5 text-[11px] text-destructive">{[flagged && status, p.projectionUnavailable && 'stale projection', p.positionsConflict && 'position conflict', p.games < 40 && 'under 40 GP'].filter(Boolean).join(', ')}: excluded</span>}
                  </span>
                  <button type="button" className={btn.ghost} aria-pressed={locked} aria-label={`${locked ? 'Unlock' : 'Lock'} ${p.name}`} onClick={() => run(() => t.toggleLocked(p.id))} data-testid={`button-trade-lock-${p.id}`}>
                    {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}<span className="hidden sm:inline">{locked ? 'Untouchable' : 'Lock'}</span>
                  </button>
                </li>
              );
            })}
            {!mine.length && <li className="px-2.5 py-3 text-sm text-muted-foreground">No players yet.</li>}
          </ul>
        </Panel>

        <Panel title={`Partner teams (${partners.length}/${max})`}>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[10rem] flex-1 text-xs">New partner
              <input className={field} value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="Team name" data-testid="input-trade-partner-name" />
            </label>
            <button type="button" className={btn.primary} onClick={add} data-testid="button-add-trade-partner">Add partner</button>
          </div>
          {partners.length > 0 ? (
            <div className="mt-3 space-y-3">
              <label className="block text-xs">Edit team
                <select className={field} value={sel} onChange={e => setSelected(e.target.value)} data-testid="select-trade-partner">
                  {partners.map(p => <option key={p.id} value={p.id}>{p.name} ({p.players.length - p.reserveIds.length} + {p.reserveIds.length} IL)</option>)}
                </select>
              </label>
              <TradePartnerEditor key={sel} t={t} partnerId={sel} onError={setError} />
            </div>
          ) : <p className="mt-3 text-sm text-muted-foreground" data-testid="text-trade-no-partners">No partners yet. Add a league rival by name, then fill in their 12 regular players and up to 2 IL, or copy your Weekly opponent.</p>}
        </Panel>
      </div>

      <Panel title="Trade ideas">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">Package size
            <select className={field} value={workspace.packageSize} onChange={e => run(() => t.setPackageSize(e.target.value as typeof workspace.packageSize))} data-testid="select-trade-package">
              <option value="one">1-for-1 only</option>
              <option value="two">2-for-2 only</option>
              <option value="both">1-for-1 and 2-for-2</option>
            </select>
          </label>
          <button type="button" className={btn.primary} disabled={t.busy || !partners.length || noTeam} onClick={generate} data-testid="button-generate-trades">{t.busy ? 'Scanning...' : result ? 'Re-generate' : 'Find trades'}</button>
          <span className="text-xs text-muted-foreground">Scans all {partners.length} saved team{partners.length === 1 ? '' : 's'}.</span>
        </div>
        {t.stale && <div className="mt-3"><Notice tone="warn" testId="trade-stale">Rosters, locks, settings or player data changed since the last scan. Old suggestions are hidden; re-generate.</Notice></div>}
        {result?.warnings.length ? <ul className="mt-3 space-y-1" data-testid="trade-warnings">{result.warnings.map(w => <li key={w}><Notice tone="warn">{w}</Notice></li>)}</ul> : null}
        {result && (
          <p className="mt-3 text-xs text-muted-foreground" data-testid="text-trade-scan-summary">{result.scanned} packages scanned across {result.teamsAnalyzed} team{result.teamsAnalyzed === 1 ? '' : 's'}. Showing top {result.ideas.length} (max 12).</p>
        )}
        {result && !result.ideas.length && (
          <div className="mt-2 rounded-md border border-dashed p-4 text-sm" data-testid="trade-empty">
            No mutually beneficial, fair offers found with the current rosters and filters. Filters are not relaxed on purpose. Try locking fewer players, widening package size, or completing partner rosters.
          </div>
        )}
        {result && result.ideas.length > 0 && <ol className="mt-3 space-y-3">{result.ideas.map((idea, i) => <TradeIdeaCard key={idea.id} idea={idea} index={i} />)}</ol>}
        {!result && !t.stale && !t.busy && <p className="mt-3 text-sm text-muted-foreground">Save at least one partner roster, then scan.</p>}

        <details className="mt-4 text-xs" data-testid="trade-methodology">
          <summary className="cursor-pointer font-semibold">Methodology and limits</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
            <li>Teams are scored by a concave all-nine-category fit index with equal baseline weight and no punting. Index values can be negative; gains are index points, not win or acceptance probability.</li>
            <li>Both managers are assumed to want balanced nine-category builds. Actual standings, punt strategies, playoff schedules and personal player values are not known. Review those before sending an offer.</li>
            <li>Stats are per-game values scaled by projected games over 82, summed over all non-IL players, not one-week totals or ten assumed starters.</li>
            <li>Both teams must gain, avoid severe category collapse, cover all active positions, and keep their non-IL and IL counts unchanged.</li>
            <li>Package value gap must be 12% or less. ESPN ADP is a secondary reputation check at 20% or less when available.</li>
            <li>IL players, players with any non-healthy status, projected GP under 40, stale projections and position conflicts are never offered.</li>
            <li>Heuristic on saved full-season forecasts, not remaining-season forecasts or Weekly selections. Injury data is only as current as its last check. Confirm Yahoo eligibility before proposing.</li>
          </ul>
        </details>
      </Panel>
    </div>
  );
}

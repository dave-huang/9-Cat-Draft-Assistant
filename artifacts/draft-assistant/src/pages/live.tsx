import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Check, RefreshCw, Search, Star, Undo2, X } from 'lucide-react';
import { useDraft } from '@/hooks/use-draft';
import { useDraftData } from '@/hooks/use-draft-data';
import type { Player, Position, Recommendation } from '@/lib/draft-types';
import { btn, ConfirmButton, errMsg, field, fmt, Notice, Panel, ZStrip } from '@/components/bits';
import { InjuryReserveSlots } from '@/components/InjuryReserveSlots';
import { isPreviousDefaultRoster } from '@/lib/league-roster';

const FILTERS = ['ALL', 'PG', 'SG', 'G', 'SF', 'PF', 'F', 'C'] as const;
type Filter = (typeof FILTERS)[number];

function matches(r: Recommendation, f: Filter) {
  if (f === 'ALL') return true;
  const p = r.player.positions as string[];
  if (f === 'G') return p.includes('PG') || p.includes('SG');
  if (f === 'F') return p.includes('SF') || p.includes('PF');
  return p.includes(f);
}

function editable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

const miniBtn = 'rounded-md px-2.5 py-1.5 text-xs font-bold transition active:scale-95 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 disabled:pointer-events-none';
const mineCls = `${miniBtn} bg-primary text-primary-foreground hover:brightness-110`;
const takenCls = `${miniBtn} border bg-card hover:bg-secondary`;

function InjuryBadge({ p }: { p: Player }) {
  const s = p.injuryStatus;
  if (!s) return <span className="rounded border border-dashed px-1 font-mono text-[10px] text-muted-foreground" title="No injury report found. This is not confirmation of health.">unreported</span>;
  const ok = /^(active|healthy)$/i.test(s);
  return <span className={`rounded px-1 font-mono text-[10px] font-semibold ${ok ? 'bg-accent/15 text-accent' : 'bg-destructive/15 text-destructive'}`} title={p.injuryNote}>{s}{p.injuryReturnDate ? ` / ${p.injuryReturnDate}` : ''}</span>;
}

export default function Live() {
  const d = useDraft();
  const dd = useDraftData();
  const { state, analysis: a } = d;
  const manual = state.settings.trackingMode !== 'snake';
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [onlyList, setOnlyList] = useState(false);
  const [limit, setLimit] = useState(25);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const run = (fn: () => void, msg?: string) => {
    try {
      fn();
      setErr(null);
      if (msg) setFlash(msg);
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  const runRef = useRef(run);
  runRef.current = run;
  const undoRef = useRef(d.undoPick);
  undoRef.current = d.undoPick;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = editable(e.target);
      if (e.key === '/' && !inField && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape') {
        setQ('');
        setLimit(25);
        if (e.target === searchRef.current) searchRef.current?.blur();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !inField) {
        e.preventDefault();
        runRef.current(() => undoRef.current(), 'Last pick undone');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return a.recommendations.filter(
      (r) => matches(r, filter) && (!onlyList || state.shortlist.includes(r.player.id)) && (!s || r.player.name.toLowerCase().includes(s) || r.player.team.toLowerCase().includes(s)),
    );
  }, [a.recommendations, q, filter, onlyList, state.shortlist]);

  const top = a.recommendations[0];
  const shortlisted = state.shortlist.map((id) => byId.get(id)).filter((p): p is Player => !!p && !a.draftedIds.has(p.id));
  const history = [...state.picks].reverse();
  const open = a.rosterAssignment.filter((s) => !s.player).length;
  const mineCount = a.roster.length;
  const feed = state.injuryFeed;
  const src = state.source;

  const mark = (id: string, owner: 'mine' | 'taken', name: string) =>
    run(() => {
      d.markPick(id, owner);
      setQ('');
      setLimit(25);
      searchRef.current?.focus();
    }, `${owner === 'mine' ? 'Mine' : 'Taken'}: ${name}`);
  const editPositions = (p: Player) => {
    const input = window.prompt(`Enter ${p.name}'s positions as shown in your Yahoo draft (PG/SG/SF/PF/C). This correction is kept when projections refresh.`, p.positions.join('/'));
    if (input === null) return;
    const positions = input.toUpperCase().split(/[\/,\s]+/).filter(Boolean);
    if (!positions.length || positions.some(pos => !['PG', 'SG', 'SF', 'PF', 'C'].includes(pos))) {
      setErr('Use PG, SG, SF, PF or C, separated by slashes.');
      return;
    }
    run(() => d.updatePlayerPositions(p.id, positions as Position[]), `Yahoo eligibility saved: ${p.name}`);
  };

  if (state.players.length === 0)
    return (
      <Panel title="No players loaded">
        <p className="mb-3 text-sm">The player pool is empty. Import a per-game projections CSV to begin.</p>
        <Link href="/settings" className={btn.primary} data-testid="link-import-empty">Go to Settings</Link>
      </Panel>
    );

  const Actions = ({ p, big }: { p: Player; big?: boolean }) => (
    <>
      <button className={`${mineCls} ${big ? 'px-4 py-2 text-sm' : ''}`} data-testid={big ? 'button-mine-top' : `button-mine-${p.id}`} disabled={a.complete || (!manual && !a.isMyTurn) || !a.recommendations.find(r => r.player.id === p.id)?.fillsSlot} onClick={() => mark(p.id, 'mine', p.name)}>Mine</button>
      <button className={`${takenCls} ${big ? 'px-4 py-2 text-sm' : ''}`} data-testid={big ? 'button-taken-top' : `button-taken-${p.id}`} disabled={!manual && (a.complete || a.isMyTurn)} onClick={() => mark(p.id, 'taken', p.name)}>Taken</button>
    </>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border-2 border-border bg-card p-3" data-testid="panel-clock">
          {manual ? (
            <>
              <Stat label="Marked taken" v={state.picks.length} id="taken" />
              <Stat label="My roster" v={`${mineCount}/${state.settings.rosterSlots.length}`} id="mine" />
              <Stat label="Open slots" v={open} id="open" />
              <span className="text-[11px] text-muted-foreground" data-testid="text-mode">Manual tracking. Mark picks as you see them on Yahoo.</span>
            </>
          ) : a.complete ? (
            <p className="font-bold" data-testid="text-complete">Draft complete. {a.totalPicks} picks made.</p>
          ) : (
            <>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{a.isMyTurn ? 'You are on the clock' : `Team ${a.currentTeam} is picking`}</div>
                <div className="text-2xl font-extrabold leading-none" data-testid="text-pick">Pick <span className="font-mono">{a.nextPick}</span></div>
              </div>
              <Stat label="Round" v={a.round} id="round" />
              <Stat label="Until mine" v={a.isMyTurn ? 'Now' : a.picksUntilMine} id="until" />
              <Stat label="My next" v={a.myNextPick ?? 'None'} id="mynext" />
              <button className="ml-auto text-xs underline" data-testid="button-switch-manual" onClick={() => run(() => d.updateSettings({ ...state.settings, trackingMode: 'manual' }), 'Switched to manual tracking')}>Switch to manual</button>
            </>
          )}
          <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
            {flash && <span className="animate-in fade-in rounded bg-accent px-2 py-0.5 font-mono text-[11px] text-accent-foreground" data-testid="text-flash">{flash}</span>}
            <button className={btn.ghost} disabled={state.picks.length === 0} onClick={() => run(d.undoPick, 'Last pick undone')} data-testid="button-undo-bar"><Undo2 className="h-3.5 w-3.5" />Undo</button>
            <ConfirmButton testId="button-reset-live" label="Reset draft" confirmLabel="Yes, restart draft" disabled={!state.picks.length && !state.shortlist.length && !d.saveError}
              description={<>Clear every Mine/Taken pick and the shortlist? This cannot be undone. Player data, injuries and league setup stay{isPreviousDefaultRoster(state.settings.rosterSlots) ? ' (the earlier default roster updates to 12 draftable spots + 2 IL)' : ''}. <Link href="/settings" className="underline">Export a backup</Link> first to keep this mock.</>}
              onConfirm={() => run(() => {
                d.resetDraft();
                setQ(''); setFilter('ALL'); setOnlyList(false); setLimit(25);
              }, 'Draft reset — ready for another mock')} />
          </div>
        </div>
        {isPreviousDefaultRoster(state.settings.rosterSlots) && <Notice tone="warn" testId="text-legacy-roster">This saved draft uses the earlier 13-player layout. Your picks were kept. Reset the board to start a new mock with your Yahoo roster: 12 draftable spots + 2 IL reserves.</Notice>}

        {!manual && (
          <p className="text-[11px] text-muted-foreground">Snake mode assumes every pick is entered in order. If you fall out of sync, switch to manual; picks are kept.</p>
        )}

        {err && <Notice tone="error" testId="text-error">{err}</Notice>}
        {dd.loadingProjections && <Notice tone="info" testId="text-data-loading">Loading this season’s ESPN projections and injury reports. Your saved picks are kept.</Notice>}
        {dd.error && <Notice tone="error" testId="text-injury-error">Data refresh failed: {dd.error}</Notice>}
        {a.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
        {(src.isDemo || !src.updatedAt) && (
          <Notice tone={src.isDemo ? 'warn' : 'info'} testId="text-provenance">
            {src.isDemo ? 'Illustrative demo data, not current. Load season projections in ' : src.provider === 'ESPN' ? 'ESPN supplies no forecast publication date. See retrieval times and source limits in ' : 'Projection forecast date unknown. Check your source in '}<Link href="/settings" className="font-semibold underline" data-testid="link-provenance-settings">Settings</Link>.
          </Notice>
        )}

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground" data-testid="text-freshness">
          <span>Projections: {src.label || 'unlabeled'}, forecast {src.updatedAt ? new Date(src.updatedAt).toLocaleDateString() : 'date unknown'}</span>
          {src.checkedAt && <span>/ checked {new Date(src.checkedAt).toLocaleString()}</span>}
          {src.fetchedAt && <span>/ ESPN snapshot {new Date(src.fetchedAt).toLocaleTimeString()} (up to 15 min cache)</span>}
          <span>/</span>
          <span>{feed ? `Injuries checked ${new Date(feed.checkedAt).toLocaleString()} (${feed.matchedPlayers}/${feed.totalReports} matched)` : 'Injuries never checked. Unreported is not healthy.'}</span>
          <button className={`${btn.ghost} !py-0.5 text-xs`} disabled={dd.refreshing} onClick={() => { void dd.refreshInjuries(); }} data-testid="button-refresh-injuries">
            <RefreshCw className={`h-3 w-3 ${dd.refreshing ? 'animate-spin' : ''}`} />{dd.refreshing ? 'Checking' : 'Refresh injuries'}
          </button>
        </div>

        {top && !a.complete && (
          <Panel title="Best remaining for my roster" aside={<span className="text-[11px] text-muted-foreground">Heuristic, not a guarantee</span>}>
            <div className="flex flex-wrap items-start justify-between gap-3" data-testid="card-top">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="text-2xl font-extrabold tracking-tight" data-testid="text-top-name">{top.player.name}</h3>
                  <span className="font-mono text-xs text-muted-foreground">{top.player.team} / <button className="underline decoration-dotted underline-offset-4" title="Correct eligibility to match Yahoo" onClick={() => editPositions(top.player)} data-testid="button-positions-top">{top.player.positions.join(', ')}</button></span>
                  <InjuryBadge p={top.player} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Overall rank {top.overallRank}{top.player.adp ? ` / ${src.adpPlatform ?? ''} ADP ${fmt(top.player.adp)}` : ''}{top.fillsSlot ? ' / fits your roster' : ' / no eligible slot'}
                </div>
                {top.player.injuryNote && <div className="mt-1 text-xs text-destructive">{top.player.injuryNote}</div>}
              </div>
              <ZStrip z={top.categoryZ} />
            </div>
            <StatLine r={top} />
            <ul className="mt-3 space-y-1 text-sm">
              {top.reasons.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{x}</li>)}
              {top.warnings.map((x) => <li key={x} className="flex gap-2 text-destructive"><span className="font-mono font-bold">!</span>{x}</li>)}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Actions p={top.player} big />
              <button className={btn.ghost} onClick={() => run(() => d.toggleShortlist(top.player.id))} data-testid="button-shortlist-top" aria-pressed={state.shortlist.includes(top.player.id)}>
                <Star className="h-4 w-4" />Shortlist
              </button>
            </div>
          </Panel>
        )}

        <Panel title={`Available players (${filtered.length})`} aside={<span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">/ search  Esc clear  Ctrl+Z undo</span>}>
          <div className="mb-3 flex flex-wrap gap-2">
            <label className="relative min-w-[180px] flex-1">
              <span className="sr-only">Search players</span>
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input ref={searchRef} value={q} onChange={(e) => { setQ(e.target.value); setLimit(25); }} placeholder="Search name or team ( / )" className={`${field} pl-8 pr-8`} data-testid="input-search" />
              {q && <button type="button" aria-label="Clear search" className="absolute right-2 top-2" onClick={() => setQ('')} data-testid="button-clear-search"><X className="h-4 w-4 text-muted-foreground" /></button>}
            </label>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Position filter">
              {FILTERS.map((f) => (
                <button key={f} aria-pressed={filter === f} data-testid={`filter-${f}`} onClick={() => { setFilter(f); setLimit(25); }} className={`rounded-md border px-2 py-1 font-mono text-xs transition active:scale-95 ${filter === f ? 'border-accent bg-accent text-accent-foreground' : 'bg-card hover:bg-secondary'}`}>{f}</button>
              ))}
              <button aria-pressed={onlyList} data-testid="filter-shortlist" onClick={() => setOnlyList(!onlyList)} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition active:scale-95 ${onlyList ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}`}><Star className="h-3 w-3" />List</button>
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="empty-pool">
              No available players match. Clear the search or filter{onlyList ? ', or turn off the shortlist view' : ''}.
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.slice(0, limit).map((r, i) => {
                const p = r.player;
                const on = state.shortlist.includes(p.id);
                return (
                  <li key={p.id} className="py-2.5" data-testid={`row-player-${p.id}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{r.rank}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-semibold">{p.name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{p.team} <button className="underline decoration-dotted underline-offset-4" title="Edit positions to match Yahoo" data-testid={`button-positions-${p.id}`} onClick={() => editPositions(p)}>{p.positions.join('/')}{p.positionsVerified ? ' ✓' : ''}</button></span>
                          <InjuryBadge p={p} />
                          {p.adp !== undefined && <span className="font-mono text-[10px] text-muted-foreground">{src.adpPlatform} ADP {fmt(p.adp)}</span>}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {fmt(p.points)} PTS · {fmt(p.rebounds)} REB · {fmt(p.assists)} AST · {fmt(p.steals)} STL · {fmt(p.blocks)} BLK · {fmt(p.threes)} 3PM · {fmt(p.turnovers)} TO / {fmt(p.fga ? (p.fgm / p.fga) * 100 : 0)}% FG · {fmt(p.fta ? (p.ftm / p.fta) * 100 : 0)}% FT / {p.games} GP
                        </div>
                        {p.injuryNote && <div className="text-[11px] text-destructive">{p.injuryNote}</div>}
                        {i < 5 && !q && r.reasons[0] && <div className="mt-0.5 text-[11px] text-accent">{r.reasons[0]}</div>}
                      </div>
                      <div className="hidden xl:block"><ZStrip z={r.categoryZ} /></div>
                      <button className="rounded p-1.5 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring" aria-label={on ? `Remove ${p.name} from shortlist` : `Shortlist ${p.name}`} aria-pressed={on} data-testid={`button-star-${p.id}`} onClick={() => run(() => d.toggleShortlist(p.id))}>
                        <Star className={`h-4 w-4 transition ${on ? 'fill-primary text-primary' : 'text-muted-foreground'}`} />
                      </button>
                      <div className="flex gap-1"><Actions p={p} /></div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {filtered.length > limit && <button className={`${btn.ghost} mt-3 w-full`} onClick={() => setLimit(limit + 25)} data-testid="button-more">Show more ({filtered.length - limit} left)</button>}
        </Panel>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto">
        <Panel title="Team needs" aside={<span className="font-mono text-[10px] text-muted-foreground">9-cat</span>}>
          <ul className="grid grid-cols-3 gap-1.5" data-testid="panel-needs">
            {a.categories.map((c) => {
              const tone = c.status === 'strong' ? 'border-accent/50 bg-accent/10' : c.status === 'needs-work' ? 'border-primary/50 bg-primary/10' : 'bg-muted/50';
              return (
                <li key={c.key} className={`rounded-md border px-2 py-1 ${tone}`} data-testid={`need-${c.key}`} title={`${c.label}: ${c.z.toFixed(2)} z`}>
                  <div className="font-mono text-[11px] font-semibold">{c.label}</div>
                  <div className="text-[10px] uppercase text-muted-foreground">{c.status === 'needs-work' ? 'need' : c.status}</div>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="My roster" aside={<span className="font-mono text-xs">{mineCount}/{a.rosterAssignment.length}</span>}>
          <ul className="grid grid-cols-1 gap-0.5 text-sm" data-testid="panel-roster">
            {a.rosterAssignment.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-9 font-mono text-[11px] text-muted-foreground">{s.slot}</span>
                {s.player ? <span className="truncate font-medium">{s.player.name}</span> : <span className="text-xs text-muted-foreground">open</span>}
              </li>
            ))}
          </ul>
            <InjuryReserveSlots count={state.settings.injuryReserveSlots} />
        </Panel>
        <Panel title="Shortlist" aside={<span className="font-mono text-xs">{shortlisted.length}</span>}>
          {shortlisted.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="empty-shortlist">Star players you are watching. Drafted players drop off automatically.</p>
          ) : (
            <ul className="space-y-1.5">
              {shortlisted.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{p.name} <span className="font-mono text-[11px] text-muted-foreground">{p.positions.join('/')}</span></span>
                  <span className="flex shrink-0 gap-1">
                    <button className={mineCls} data-testid={`button-mine-short-${p.id}`} onClick={() => mark(p.id, 'mine', p.name)}>Mine</button>
                    <button className={takenCls} data-testid={`button-taken-short-${p.id}`} onClick={() => mark(p.id, 'taken', p.name)}>Taken</button>
                    <button className="px-1 text-xs underline" onClick={() => run(() => d.toggleShortlist(p.id))} data-testid={`button-unlist-${p.id}`}>Remove</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Pick history" aside={<button className={btn.ghost} disabled={history.length === 0} onClick={() => run(d.undoPick, 'Last pick undone')} data-testid="button-undo"><Undo2 className="h-3.5 w-3.5" />Undo</button>}>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="empty-history">No picks yet. Mark players Mine or Taken as they go.</p>
          ) : (
            <ol className="max-h-[320px] space-y-1 overflow-y-auto pr-1 text-sm">
              {history.map((p) => {
                const mine = (p as { owner?: string }).owner ? (p as { owner?: string }).owner === 'mine' : p.team === state.settings.myPosition;
                return (
                  <li key={p.overall} className={`flex items-center gap-2 ${mine ? 'font-semibold text-primary' : ''}`} data-testid={`row-pick-${p.overall}`}>
                    <span className="w-7 font-mono text-xs text-muted-foreground">{p.overall}</span>
                    <span className="font-mono text-xs">{mine ? 'Mine' : 'Taken'}</span>
                    <span className="flex-1 truncate">{byId.get(p.playerId)?.name ?? p.playerId}</span>
                    {manual && <button aria-label="Remove this pick" className="rounded p-0.5 hover:bg-secondary" data-testid={`button-remove-pick-${p.overall}`} onClick={() => run(() => d.undraftPlayer(p.playerId), 'Pick removed')}><X className="h-3.5 w-3.5" /></button>}
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground" data-testid="text-autosave">
          Auto-saved in this browser. <Link href="/settings" className="underline" data-testid="link-backup">Export a backup</Link> before closing. No Yahoo sign-in required.
        </p>
      </aside>
    </div>
  );
}

function Stat({ label, v, id }: { label: string; v: string | number; id: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="font-mono text-xl font-semibold leading-tight" data-testid={`text-${id}`}>{v}</div>
    </div>
  );
}

function StatLine({ r }: { r: Recommendation }) {
  const p = r.player;
  const rows: [string, string][] = [
    ['PTS', fmt(p.points)], ['REB', fmt(p.rebounds)], ['AST', fmt(p.assists)], ['STL', fmt(p.steals)], ['BLK', fmt(p.blocks)], ['3PM', fmt(p.threes)], ['TO', fmt(p.turnovers)],
    ['FG%', fmt(p.fga ? (p.fgm / p.fga) * 100 : 0)], ['FT%', fmt(p.fta ? (p.ftm / p.fta) * 100 : 0)], ['GP', String(p.games)],
  ];
  return (
    <div className="mt-3 grid grid-cols-5 gap-2 rounded-md bg-muted p-2 sm:grid-cols-10">
      {rows.map(([k, v]) => (
        <div key={k} className="text-center">
          <div className="font-mono text-sm font-semibold">{v}</div>
          <div className="text-[10px] text-muted-foreground">{k}</div>
        </div>
      ))}
    </div>
  );
}

import { useMemo, useState, type ReactNode } from 'react';
import { Notice, btn, errMsg, field, fmt } from '@/components/bits';
import type { Player } from '@/lib/draft-types';
import type { WeeklyPlayer } from '@/lib/weekly-engine';
import { positionSourceLabel } from '@/lib/eligibility';

export const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function PlayerSearch({ side, players, excluded, onAdd, onAddIl }: { side: string; players: Player[]; excluded: Set<string>; onAdd: (id: string) => void; onAddIl?: (id: string) => void }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const n = norm(q);
    if (!n) return [];
    return players.filter(p => !excluded.has(p.id) && norm(p.name).includes(n)).slice(0, 6);
  }, [q, players, excluded]);
  return (
    <div className="relative">
      <input className={field} placeholder="Search players to add" aria-label={`Search ${side} players`} data-testid={`input-search-${side}`} value={q} onChange={e => setQ(e.target.value)} />
      {hits.length > 0 && (
        <ul className="mt-1 divide-y rounded-md border bg-card">
          {hits.map(p => (
            <li key={p.id} className="flex items-center">
              <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-secondary" data-testid={`button-add-${side}-${p.id}`}
                onClick={() => { onAdd(p.id); setQ(''); }}>
                <span className="font-semibold">{p.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{p.team} {p.positions.join('/')}</span>
              </button>
              {onAddIl && <button type="button" className="px-3 py-1.5 text-xs font-semibold underline hover:bg-secondary" data-testid={`button-add-il-${side}-${p.id}`} onClick={() => { onAddIl(p.id); setQ(''); }}>Add to IL</button>}
            </li>
          ))}
        </ul>
      )}
      {q && hits.length === 0 && <p className="mt-1 text-xs text-muted-foreground">No available player matches.</p>}
    </div>
  );
}

type Opt = { slot: { id: string; label: string }; allowed: boolean; reason?: string };
export function MoveSelect({ id, options, onMove }: { id: string; options: Opt[]; onMove: (slotId: string) => void }) {
  return (
    <select className={`${field} !w-36 max-w-full`} aria-label="Move to slot" data-testid={`select-move-${id}`} value="" onChange={e => { if (e.target.value) onMove(e.target.value); }}>
      <option value="">Move to...</option>
      {options.map(o => <option key={o.slot.id} value={o.slot.id} disabled={!o.allowed} title={o.reason}>{o.slot.label}{o.allowed ? '' : ' (not eligible / cannot swap)'}</option>)}
    </select>
  );
}

export function IlConfirm({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <input type="checkbox" checked={checked} data-testid={`checkbox-il-eligible-${id}`} onChange={e => onChange(e.target.checked)} />
      Yahoo IL eligible
    </label>
  );
}

export function CompactRow({ row, side, handle, onRemove, onGames, onPositions, onError, extra }: {
  row: WeeklyPlayer; side: string; handle: ReactNode; onRemove: () => void; onGames: (v?: number) => void; onPositions: () => void; onError: (m: string) => void; extra?: ReactNode;
}) {
  const p = row.player;
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const act = (fn: () => void) => { try { fn(); onError(''); } catch (e) { onError(errMsg(e)); } };
  const commit = () => {
    if (draft === null) return;
    const v = draft.trim();
    try { if (v !== '') onGames(Number(v)); onError(''); } catch (e) { onError(errMsg(e)); }
    setDraft(null);
  };
  const locked = row.reserve || row.schedulePending;
  const pending = row.schedulePending;
  return (
    <div className="min-w-0 flex-1" data-testid={`row-${side}-${p.id}`}>
      <div className="flex min-h-9 items-center gap-1.5">
        {handle}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={p.name}>{p.name}</span>
        {p.weeklyStats && (p.weeklyStats.basis === 'actuals' || p.weeklyStats.fallbackReason) && (
          <span className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground"
            data-testid={`badge-stats-${side}-${p.id}`}
            title={p.weeklyStats.basis === 'actuals' ? `Season-to-date averages from ${p.weeklyStats.gamesPlayed} games played${(p.weeklyStats.gamesPlayed ?? 0) < 10 ? '; small sample' : ''}` : p.weeklyStats.fallbackReason}>
            {p.weeklyStats.basis === 'actuals' ? `${p.weeklyStats.gamesPlayed} GP` : 'Proj fallback'}
          </span>
        )}
        <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">{p.team} {p.positions.join('/')}</span>
        {p.injuryStatus && <span className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-[10px] font-semibold uppercase" title={`${p.injuryStatus}${p.injuryNote ? `: ${p.injuryNote}` : ''}`}>{p.injuryStatus === 'Day-to-day' ? 'DTD' : p.injuryStatus}</span>}
        {row.warning && !row.reserve && <span className="rounded border border-[hsl(40_80%_40%)]/50 bg-[hsl(44_90%_60%)]/25 px-1 text-[10px] font-bold" title={row.warning} aria-label="Has warning, open details">!</span>}
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title={row.reserve ? 'IL players do not play' : 'Expected games / scheduled games'}>
          <span className="sr-only sm:not-sr-only">Gm</span>
          <input type="number" min={0} max={14} step="any" className={`${field} !w-12 !px-1 !py-0.5 font-mono !text-xs ${row.override ? '!border-primary' : ''}`} data-testid={`input-games-${p.id}`} disabled={locked}
            placeholder={pending ? '—' : undefined} value={pending ? '' : draft ?? String(row.expectedGames)} onChange={e => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); }} aria-label={`Expected games for ${p.name}`} />
          <span className="font-mono">/{pending ? '—' : row.scheduledGames}</span>
        </label>
        {row.override && !row.reserve && <button type="button" className="text-[11px] font-semibold underline" data-testid={`button-reset-games-${p.id}`} onClick={() => act(() => onGames(undefined))}>Reset</button>}
        <button type="button" className="min-h-7 shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} details for ${p.name}`} data-testid={`button-details-${side}-${p.id}`} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Details'}</button>
      </div>
      {open && (
        <div className="mb-1.5 space-y-1.5 rounded-md bg-muted/60 p-2 text-xs" data-testid={`details-${side}-${p.id}`}>
          <p className="font-semibold">{p.name} <span className="font-normal text-muted-foreground">· {p.team}</span></p>
          {p.weeklyStats && <p className="text-muted-foreground">
            {p.weeklyStats.basis === 'actuals'
              ? `Stats basis: current-season averages, ${p.weeklyStats.gamesPlayed} games played.${(p.weeklyStats.gamesPlayed ?? 0) < 10 ? ' Small sample: under 10 games.' : ''}`
              : `Stats basis: ${p.weeklyStats.fallbackReason ? `projection fallback. ${p.weeklyStats.fallbackReason}` : 'season projections.'}`}
          </p>}
          <div className="font-mono text-[11px] text-muted-foreground">
            {pending ? 'Schedule pending' : row.dates.length ? row.dates.join('  ') : 'No scheduled games'} | {fmt(p.points)} pts {fmt(p.rebounds)} reb {fmt(p.assists)} ast per game
          </div>
          <div>
            Positions: <button type="button" className="underline decoration-dotted underline-offset-4" title="View or correct Yahoo positions" data-testid={`button-weekly-positions-${p.id}`} onClick={onPositions}>{p.positions.join('/')} ({positionSourceLabel(p)})</button>
          </div>
          {row.warning && <Notice tone="warn">{row.warning}</Notice>}
          {p.injuryNote && <div className="text-muted-foreground">{p.injuryNote}</div>}
          <div className="flex flex-wrap items-center gap-3">
            {extra}
            <button type="button" className={btn.ghost} data-testid={`button-remove-${side}-${p.id}`} onClick={() => act(onRemove)}>Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}

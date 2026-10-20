import { useMemo, useState } from 'react';
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
              {onAddIl && <button type="button" className="px-3 py-1.5 text-xs font-semibold underline hover:bg-secondary" data-testid={`button-add-il-${p.id}`} onClick={() => { onAddIl(p.id); setQ(''); }}>Add to IL</button>}
            </li>
          ))}
        </ul>
      )}
      {q && hits.length === 0 && <p className="mt-1 text-xs text-muted-foreground">No available player matches.</p>}
    </div>
  );
}

export function RosterRow({ row, side, active, starterMode, onRemove, onGames, onActive, onReserve, onPositions, onError }: {
  row: WeeklyPlayer; side: string; active?: boolean; starterMode?: boolean;
  onRemove: () => void; onGames: (v?: number) => void; onActive?: (a: boolean) => void; onReserve?: (r: boolean) => void; onPositions?: () => void; onError: (m: string) => void;
}) {
  const p = row.player;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = draft.trim();
    try { if (v !== '') onGames(Number(v)); onError(''); } catch (e) { onError(errMsg(e)); }
    setDraft(null);
  };
  const act = (fn: () => void) => { try { fn(); onError(''); } catch (e) { onError(errMsg(e)); } };
  return (
    <li className="py-2.5" data-testid={`row-${side}-${p.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {onReserve && (
          <label className="flex items-center gap-1.5 text-xs">
            <select className={`${field} !w-auto`} aria-label={`Roster spot for ${p.name}`} data-testid={`select-spot-${p.id}`} value={row.reserve ? 'il' : 'reg'} onChange={e => act(() => onReserve(e.target.value === 'il'))}>
              <option value="reg">Regular</option>
              <option value="il">IL</option>
            </select>
          </label>
        )}
        {starterMode && (
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={!!active} data-testid={`checkbox-active-${p.id}`} onChange={e => act(() => onActive?.(e.target.checked))} />
            {active ? 'Active' : 'Bench'}
          </label>
        )}
        <span className="min-w-0 text-sm font-semibold">{p.name}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {p.team} <button className="underline decoration-dotted underline-offset-4" title="View or correct Yahoo positions" data-testid={`button-weekly-positions-${p.id}`} onClick={() => onPositions?.()}>{p.positions.join('/')} ({positionSourceLabel(p)})</button>
        </span>
        {p.injuryStatus && <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase">{p.injuryStatus}</span>}
        <span className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Games
            <input type="number" min={0} max={14} step="any" className={`${field} !w-16 font-mono`} data-testid={`input-games-${p.id}`} disabled={row.reserve || row.schedulePending}
              placeholder={row.schedulePending ? '—' : undefined} value={row.schedulePending ? '' : draft ?? String(row.expectedGames)} onChange={e => setDraft(e.target.value)} onBlur={commit}
              onKeyDown={e => { if (e.key === 'Enter') commit(); }} aria-label={`Expected games for ${p.name}`} />
            <span className="font-mono">/ {row.schedulePending ? '—' : row.scheduledGames}</span>
          </label>
          {row.override && !row.reserve && <button type="button" className={btn.ghost} data-testid={`button-reset-games-${p.id}`} onClick={() => act(() => onGames(undefined))}>Reset</button>}
          <button type="button" className={btn.ghost} data-testid={`button-remove-${side}-${p.id}`} onClick={() => act(onRemove)}>Remove</button>
        </span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
        {row.schedulePending ? 'Schedule pending' : row.dates.length ? row.dates.join('  ') : 'No scheduled games'} | {fmt(p.points)} pts {fmt(p.rebounds)} reb {fmt(p.assists)} ast per game
      </div>
      {row.warning && <div className="mt-1"><Notice tone="warn">{row.warning}</Notice></div>}
      {p.injuryNote && <div className="mt-1 text-xs text-muted-foreground">{p.injuryNote}</div>}
    </li>
  );
}

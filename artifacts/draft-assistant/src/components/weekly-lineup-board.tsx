import type { useWeeklyPlanner } from '@/hooks/use-weekly';
import type { LineupInteraction } from '@/hooks/use-lineup-interaction';
import { Notice } from '@/components/bits';
import { CompactRow, IlConfirm, MoveSelect } from '@/components/weekly-parts';
import { visibleWeeklySlots } from '@/lib/weekly-lineup';
import type { Player } from '@/lib/draft-types';
import { GripVertical } from 'lucide-react';

type Side = 'mine' | 'opponent';
type W = ReturnType<typeof useWeeklyPlanner>;

export function LineupBoard({ side, w, ix, ilSet, run, onError, editPositions }: {
  side: Side; w: W; ix: LineupInteraction; ilSet: Set<string>; run: (fn: () => void) => void; onError: (m: string) => void; editPositions: (p: Player) => void;
}) {
  const rows = side === 'mine' ? w.mine : w.opponent;
  const lineup = side === 'mine' ? w.myLineup : w.opponentLineup;
  const byId = new Map(rows.map(r => [r.player.id, r]));
  const assigned = new Set(w.slots.flatMap(sl => lineup[sl.id] ? [lineup[sl.id]] : []));
  const unassigned = rows.filter(r => !assigned.has(r.player.id));
  const picking = ix.source?.side === side;

  const renderRow = (r: typeof rows[number]) => {
    const id = r.player.id;
    const isSrc = ix.source?.side === side && ix.source.id === id;
    const handle = (
      <button type="button" draggable aria-label={`Move ${r.player.name}: drag, or press to select then choose a slot`} aria-pressed={isSrc} title="Drag to a slot, or click to select"
        data-testid={`drag-handle-${side}-${id}`}
        className={`flex h-8 w-6 shrink-0 cursor-grab select-none items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing ${isSrc ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}
        onClick={() => ix.choosePlayer(side, id)} onDragStart={e => ix.dragStart(side, id, e)} onDragEnd={ix.dragEnd}>
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
    );
    return (
      <CompactRow key={id} row={r} side={side} handle={handle} onError={onError} onPositions={() => editPositions(r.player)}
        extra={<>
          <MoveSelect id={id} options={w.moveOptions(side, id)} onMove={t => run(() => w.movePlayer(side, id, t))} />
          <IlConfirm id={id} checked={ilSet.has(id)} onChange={v => run(() => w.setIlEligible(id, v))} />
        </>}
        onRemove={() => w.removePlayer(side, id)} onGames={v => w.setExpectedGames(id, v)} />
    );
  };

  return (
    <>
      {w.lineupErrors[side].map((m, i) => <div key={i} className="mt-2"><Notice tone="error" testId={`text-lineup-error-${side}-${i}`}>{m}</Notice></div>)}
      <ul className="mt-2 divide-y rounded-md border">
        {visibleWeeklySlots(lineup, w.slots).map(sl => {
          const pid = lineup[sl.id], r = pid ? byId.get(pid) : undefined;
          const state = ix.targetState(side, sl.id);
          const reason = ix.targetReason(side, sl.id);
          const hovered = ix.over?.side === side && ix.over.slotId === sl.id;
          const kindCls = sl.kind === 'active' ? 'bg-secondary' : sl.kind === 'il' ? 'bg-primary/15' : 'bg-muted text-muted-foreground';
          return (
            <li key={sl.id} data-testid={`slot-${side}-${sl.id}`} data-drop-state={state} data-hovered={hovered || undefined} title={state === 'blocked' ? reason : undefined}
              onDragOver={e => ix.dragOver(side, sl.id, e)} onDragLeave={e => ix.dragLeave(side, sl.id, e)} onDrop={e => ix.drop(side, sl.id, e)}
              className={`flex items-center gap-1.5 px-1.5 transition-colors duration-150 border-l-4 border-l-transparent
                data-[drop-state=allowed]:bg-accent/10 data-[drop-state=allowed]:border-l-accent
                data-[drop-state=blocked]:bg-destructive/5 data-[drop-state=blocked]:opacity-60
                data-[drop-state=source]:bg-primary/10 data-[drop-state=source]:border-l-primary
                data-[hovered=true]:ring-2 data-[hovered=true]:ring-inset data-[hovered=true]:ring-accent`}>
              <button type="button" disabled={!picking || state === 'blocked'} title={reason} aria-label={`${r ? `Move selected player into ${sl.label}, swapping with ${r.player.name}` : `Move selected player into ${sl.label}`}`}
                data-testid={`button-slot-${side}-${sl.id}`} onClick={() => ix.chooseSlot(side, sl.id)}
                className={`min-h-8 w-12 shrink-0 rounded py-0.5 text-center font-mono text-xs font-semibold focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default ${kindCls} ${picking && state === 'allowed' ? 'outline outline-2 outline-accent hover:brightness-95' : ''} ${picking && state === 'blocked' ? 'line-through opacity-60' : ''}`}>{sl.label}</button>
              {r ? renderRow(r) : (
                <p className="min-h-9 flex-1 py-2 text-sm text-muted-foreground" data-testid={`empty-slot-${side}-${sl.id}`}>
                  {state === 'allowed' ? 'Drop or click label to place here' : 'Empty'}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {unassigned.length > 0 && (
        <div className="mt-2 rounded-md border border-destructive/40" data-testid={`list-unassigned-${side}`}>
          <p className="px-2 py-1 text-xs font-semibold">Unassigned ({unassigned.length}): move to an eligible slot or remove.</p>
          <ul className="divide-y">{unassigned.map(r => <li key={r.player.id} className="flex px-1.5">{renderRow(r)}</li>)}</ul>
        </div>
      )}
    </>
  );
}

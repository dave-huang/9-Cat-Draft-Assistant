import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { useWeeklyPlanner } from './use-weekly';
import type { WeeklySide } from '@/lib/weekly-lineup';
import { weeklyMoveTarget, type WeeklyMoveSource } from '@/lib/weekly-interaction';
import { errMsg } from '@/components/bits';

const DRAG_TYPE = 'application/x-ninecat-lineup';
type Destination = { side: WeeklySide; slotId: string };

/** Native desktop dragging plus the same select-then-place action for touch and
 * keyboard users. Only a drag started in this editor can change a roster. */
export function useLineupInteraction(w: ReturnType<typeof useWeeklyPlanner>, onError: (message: string) => void) {
  const [source, setSource] = useState<WeeklyMoveSource | null>(null);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<Destination | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const sourceRef = useRef<WeeklyMoveSource | null>(null);
  const draggingRef = useRef(false);
  const rowsFor = (side: WeeklySide) => side === 'mine' ? w.mine : w.opponent;
  const lineupFor = (side: WeeklySide) => side === 'mine' ? w.myLineup : w.opponentLineup;

  const clear = () => {
    sourceRef.current = null;
    draggingRef.current = false;
    setSource(null);
    setDragging(false);
    setOver(null);
  };
  const cancel = () => {
    clear();
    setAnnouncement('Move canceled. Your lineup is unchanged.');
  };
  useEffect(() => {
    if (!source) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [source]);
  useEffect(() => {
    if (source && !rowsFor(source.side).some(r => r.player.id === source.id)) cancel();
  }, [source, w.mine, w.opponent]);

  const preview = (side: WeeklySide, slotId: string, candidate = sourceRef.current) =>
    weeklyMoveTarget(candidate, side, slotId, lineupFor(side), rowsFor(side).map(r => r.player), w.slots, w.planner.ilEligibleIds ?? []);

  const choosePlayer = (side: WeeklySide, id: string) => {
    if (sourceRef.current?.side === side && sourceRef.current.id === id) { cancel(); return; }
    const row = rowsFor(side).find(r => r.player.id === id);
    if (!row) { onError('This player is no longer on the roster.'); return; }
    const next = { side, id };
    sourceRef.current = next;
    setSource(next);
    setOver(null);
    onError('');
    setAnnouncement(`${row.player.name} selected. Choose a highlighted slot on ${side === 'mine' ? 'your team' : 'the opponent’s team'}. Press Escape to cancel.`);
  };
  const place = (side: WeeklySide, slotId: string) => {
    const candidate = sourceRef.current;
    if (!candidate) return;
    const target = preview(side, slotId, candidate);
    if (target.state === 'blocked') {
      const message = target.reason ?? 'That move is not allowed.';
      onError(message);
      setAnnouncement(message);
      return;
    }
    if (target.state === 'source') {
      clear();
      setAnnouncement('Player kept in the same slot.');
      return;
    }
    const player = rowsFor(candidate.side).find(r => r.player.id === candidate.id)?.player;
    const occupant = rowsFor(side).find(r => r.player.id === lineupFor(side)[slotId])?.player;
    const slot = w.slots.find(s => s.id === slotId);
    try {
      // Revalidate inside the state-changing action; previews are not authority.
      w.movePlayer(side, candidate.id, slotId);
      onError('');
      clear();
      setAnnouncement(occupant
        ? `Swapped ${player?.name ?? 'player'} with ${occupant.name} in ${slot?.label ?? slotId}. Projections updated.`
        : `Moved ${player?.name ?? 'player'} to ${slot?.label ?? slotId}. Projections updated.`);
    } catch (e) {
      const message = errMsg(e);
      onError(message);
      setAnnouncement(message);
    }
  };
  const dragStart = (side: WeeklySide, id: string, e: DragEvent<HTMLElement>) => {
    if (!rowsFor(side).some(r => r.player.id === id)) { e.preventDefault(); return; }
    const next = { side, id };
    sourceRef.current = next;
    draggingRef.current = true;
    setSource(next);
    setDragging(true);
    setOver(null);
    onError('');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(next));
    setAnnouncement('Dragging player. Highlighted slots accept the move; occupied slots swap only when both players are eligible.');
  };
  const dragEnd = () => {
    if (draggingRef.current) cancel();
  };
  const dragOver = (side: WeeklySide, slotId: string, e: DragEvent<HTMLElement>) => {
    if (!draggingRef.current || !sourceRef.current) return;
    e.preventDefault();
    const state = preview(side, slotId).state;
    e.dataTransfer.dropEffect = state === 'allowed' || state === 'source' ? 'move' : 'none';
    setOver(previous => previous?.side === side && previous.slotId === slotId ? previous : { side, slotId });
  };
  const dragLeave = (side: WeeklySide, slotId: string, e: DragEvent<HTMLElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setOver(previous => previous?.side === side && previous.slotId === slotId ? null : previous);
  };
  const drop = (side: WeeklySide, slotId: string, e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingRef.current || !sourceRef.current) return;
    let payload: WeeklyMoveSource;
    try { payload = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)); }
    catch { cancel(); return; }
    if (!payload || payload.side !== sourceRef.current.side || payload.id !== sourceRef.current.id) { cancel(); return; }
    place(side, slotId);
    // Invalid destinations leave click-to-move selected so they can be repaired,
    // but the native drag has finished.
    draggingRef.current = false;
    setDragging(false);
    setOver(null);
  };

  return {
    source, dragging, over, announcement, cancel, choosePlayer,
    complete: (message: string) => { clear(); setAnnouncement(message); },
    chooseSlot: place,
    targetState: (side: WeeklySide, slotId: string) => preview(side, slotId).state,
    targetReason: (side: WeeklySide, slotId: string) => preview(side, slotId).reason,
    dragStart, dragEnd, dragOver, dragLeave, drop,
  };
}

export type LineupInteraction = ReturnType<typeof useLineupInteraction>;

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useReadLineupScreenshot, type LineupScreenshotRow } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Notice, btn, errMsg, field } from '@/components/bits';
import { prepareScreenshot } from '@/lib/screenshot-image';
import { importOpponentLineup, screenshotReviewRows, type LineupImportRow } from '@/lib/lineup-import';
import { eligibleWeeklySlot, type WeeklySlot } from '@/lib/weekly-lineup';
import { normalizePlayerName } from '@/lib/eligibility';
import type { Player } from '@/lib/draft-types';
import type { useWeeklyPlanner } from '@/hooks/use-weekly';

type W = ReturnType<typeof useWeeklyPlanner>;
export interface ScreenshotImportTarget {
  demo: boolean;
  players: Player[];
  slots: WeeklySlot[];
  existing: number;
  title: string;
  description: string;
  replacementNote: string;
  confirmation: string;
  reviewRows: (rows: LineupScreenshotRow[]) => LineupImportRow[];
  validate: (rows: LineupImportRow[]) => void;
  slotOptions: (row: LineupImportRow) => WeeklySlot[];
  apply: (rows: LineupImportRow[], ilConfirmed: boolean) => void;
  successMessage: (count: number) => string;
  applyLabel: (count: number) => string;
}
type Edit = { playerId?: string; slotId?: string; skip?: boolean };
const TIMEOUT_MS = 100_000;
const norm = normalizePlayerName;

function apiMessage(e: unknown): string {
  const d = (e as { data?: { error?: unknown } } | null)?.data;
  if (d && typeof d.error === 'string' && d.error) return d.error;
  return errMsg(e);
}

function PlayerPick({ players, value, hint, onChange, id }: { players: Player[]; value: string; hint: string; onChange: (id: string) => void; id: string }) {
  const [q, setQ] = useState('');
  const options = useMemo(() => {
    const needle = norm(q || '');
    const list = needle ? players.filter(p => norm(p.name).includes(needle)).slice(0, 25) : players.filter(p => norm(p.name).includes(norm(hint.split(' ').pop() ?? ''))).slice(0, 25);
    const sel = players.find(p => p.id === value);
    return sel && !list.some(p => p.id === sel.id) ? [sel, ...list] : list;
  }, [players, q, hint, value]);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <input type="search" aria-label={`Search players for ${hint}`} placeholder="Search player" className={`${field} !py-1 !text-xs`} value={q} onChange={e => setQ(e.target.value)} data-testid={`input-import-search-${id}`} />
      <select aria-label={`Player for ${hint}`} className={`${field} !py-1 !text-xs`} value={value} onChange={e => onChange(e.target.value)} data-testid={`select-import-player-${id}`}>
        <option value="">Choose player...</option>
        {options.map(p => <option key={p.id} value={p.id}>{p.name} · {p.team} · {p.positions.join('/')}</option>)}
      </select>
    </div>
  );
}

export function LineupScreenshotImport({ target, onImported }: { target: ScreenshotImportTarget; onImported: () => void }) {
  const { demo, players, slots } = target;
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [raw, setRaw] = useState<LineupScreenshotRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [merged, setMerged] = useState(0);
  const [captures, setCaptures] = useState(0);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [applyError, setApplyError] = useState('');
  const [ilOk, setIlOk] = useState(false);
  const [lockOk, setLockOk] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('');
  const token = useRef(0);
  const urlRef = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);
  const mutation = useReadLineupScreenshot({ mutation: { retry: false, gcTime: 0 } });
  const readFn = useRef(mutation.mutateAsync);
  readFn.current = mutation.mutateAsync;

  const setImage = useCallback((f: File | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = f ? URL.createObjectURL(f) : '';
    setPreview(urlRef.current); setFile(f); setError('');
  }, []);
  useEffect(() => () => { token.current++; if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const reset = useCallback(() => {
    token.current++;
    setImage(null); setRaw([]); setWarnings([]); setMerged(0); setCaptures(0); setEdits({});
    setReading(false); setError(''); setApplyError(''); setIlOk(false); setLockOk(false); setDragging(false);
  }, [setImage]);
  const onOpenChange = (v: boolean) => {
    if (!v) { mutation.reset(); reset(); }
    setOpen(v);
  };

  const accept = (f: File | undefined | null) => {
    if (!f || reading) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) { setError('Choose a PNG, JPEG or WebP screenshot.'); return; }
    if (f.size > 12 * 1024 * 1024) { setError('Choose a screenshot under 12 MB, or crop it first.'); return; }
    setImage(f); setLockOk(false); setIlOk(false);
  };
  const onPaste = (e: ClipboardEvent) => {
    const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (f) { e.preventDefault(); accept(f); }
  };
  const pasteButton = async () => {
    const session = token.current;
    setError('');
    try {
      if (!navigator.clipboard?.read) throw new Error('unsupported');
      for (const it of await navigator.clipboard.read()) {
        const type = it.types.find(t => t.startsWith('image/'));
        if (type) {
          const blob = await it.getType(type);
          if (session === token.current) accept(new File([blob], 'clipboard', { type }));
          return;
        }
      }
      if (session !== token.current) return;
      setError('No image found on the clipboard. Copy a screenshot first.');
    } catch {
      if (session !== token.current) return;
      setError('This browser blocked clipboard access. Click in this dialog and press Ctrl+V (Cmd+V on Mac), or use Browse / drag and drop.');
    }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files?.[0]); };

  const read = async () => {
    if (!file || reading) return;
    const mine = ++token.current;
    setReading(true); setError('');
    try {
      const input = await prepareScreenshot(file);
      if (token.current !== mine) return;
      let timer = 0;
      const result = await Promise.race([
        readFn.current({ data: input }),
        new Promise<never>((_, rej) => { timer = window.setTimeout(() => rej(new Error('Reading timed out. Try again, or crop the screenshot to the roster column.')), TIMEOUT_MS); }),
      ]).finally(() => window.clearTimeout(timer));
      if (token.current !== mine) return;
      const have = new Set(raw.map(r => `${norm(r.name)}|${r.slot}`));
      const fresh: LineupScreenshotRow[] = [];
      let dup = 0;
      for (const r of result.rows) {
        const k = `${norm(r.name)}|${r.slot}`;
        if (have.has(k)) { dup++; continue; }
        // Merge overlap with PREVIOUS captures only; duplicates within this
        // reading must remain visible so validation can flag them.
        fresh.push(r);
      }
      setRaw(p => [...p, ...fresh]); setMerged(m => m + dup); setCaptures(c => c + 1);
      setWarnings(p => [...p, ...result.warnings]);
      setImage(null); setLockOk(false); setIlOk(false);
    } catch (e) {
      if (token.current === mine) setError(apiMessage(e));
    } finally { if (token.current === mine) { setReading(false); mutation.reset(); } }
  };

  const base = useMemo(() => target.reviewRows(raw), [raw, target.reviewRows]);
  const keys = useMemo(() => { const c: Record<string, number> = {}; return raw.map(r => { const k = `${norm(r.name)}|${r.slot}`; c[k] = (c[k] ?? 0) + 1; return `${k}|${c[k]}`; }); }, [raw]);
  const rows: LineupImportRow[] = useMemo(() => base.map((r, i) => ({ ...r, ...edits[keys[i]!] } as LineupImportRow)), [base, edits, keys]);
  const patch = (i: number, e: Edit) => {
    setEdits(p => ({ ...p, [keys[i]!]: { ...p[keys[i]!], ...e } }));
    setApplyError(''); setLockOk(false); setIlOk(false);
  };

  const blocking = useMemo(() => {
    if (!rows.length) return '';
    try { target.validate(rows); return ''; } catch (e) { return errMsg(e); }
  }, [rows, target.validate]);
  const used = rows.filter(r => !r.skip);
  const slotById = new Map(slots.map(s => [s.id, s]));
  const hasIl = used.some(r => slotById.get(r.slotId)?.kind === 'il');
  const unresolved = used.filter(r => !r.playerId).length;
  const flagged = rows.filter(r => !r.skip && (r.uncertain || !r.playerId)).length;
  const existing = target.existing;
  const canApply = rows.length > 0 && !reading && !file && !blocking && lockOk && (!hasIl || ilOk);

  const apply = () => {
    try {
      target.apply(rows, hasIl && ilOk);
      setStatus(target.successMessage(used.length));
      reset(); setOpen(false); onImported();
    } catch (e) { setApplyError(errMsg(e)); }
  };

  return (
    <>
      <button type="button" className={`${btn.ghost} !py-1 !text-xs`} disabled={demo} onClick={() => setOpen(true)} title={demo ? 'Load real projections in Settings to import a lineup.' : 'Read a Yahoo roster from a screenshot'} data-testid="button-import-screenshot">Import screenshot</button>
      <span className="sr-only" role="status" aria-live="polite">{status}</span>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92dvh] max-w-3xl gap-3 p-4 sm:p-5" onPaste={onPaste} aria-busy={reading} data-testid="dialog-import-screenshot">
          <DialogHeader>
            <DialogTitle>{target.title}</DialogTitle>
            <DialogDescription>{target.description}</DialogDescription>
          </DialogHeader>
          <p className="text-[11px] text-muted-foreground">Gemini receives the image only when you press Read screenshot; usage is billed to your Google API account. This app does not save images. Crop out personal information. PNG, JPEG or WebP, up to 12 MB before resizing.</p>
          <div role="status" aria-live="polite" className="text-xs text-muted-foreground" data-testid="text-import-status">
            {reading ? 'Reading screenshot...' : rows.length ? `${rows.length} rows read from ${captures} screenshot${captures === 1 ? '' : 's'}. ${used.length} selected, ${flagged} need attention${merged ? `, ${merged} repeated row${merged === 1 ? '' : 's'} merged` : ''}.` : 'No rows read yet.'}
          </div>

          {(!rows.length || file) && (
            <div className="space-y-2">
              <div
                className={`rounded-lg border-2 border-dashed p-3 text-center text-xs ${dragging ? 'border-primary bg-secondary' : 'border-input'}`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} data-testid="drop-import-screenshot">
                {preview ? <img src={preview} alt="Screenshot preview" className="mx-auto max-h-56 rounded border object-contain" /> : <p className="py-4 text-muted-foreground">Press Ctrl+V / Cmd+V to paste a screenshot, drop an image here, or use the buttons.</p>}
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <button type="button" className={`${btn.ghost} !py-1 !text-xs`} onClick={pasteButton} disabled={reading} data-testid="button-paste-image">Paste image</button>
                  <button type="button" className={`${btn.ghost} !py-1 !text-xs`} onClick={() => inputRef.current?.click()} disabled={reading} data-testid="button-browse-image">Browse</button>
                  <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="Upload screenshot" onChange={e => { accept(e.target.files?.[0]); e.target.value = ''; }} data-testid="input-import-file" />
                  <button type="button" className={`${btn.primary} !py-1 !text-xs`} onClick={read} disabled={!file || reading} data-testid="button-read-screenshot">{reading ? 'Reading...' : error && file ? 'Retry reading' : 'Read screenshot'}</button>
                  {file && <button type="button" className={`${btn.ghost} !py-1 !text-xs`} disabled={reading} onClick={() => setImage(null)} data-testid="button-discard-image">Discard image</button>}
                </div>
              </div>
            </div>
          )}
          {error && <Notice tone="error" testId="text-import-error">{error}</Notice>}
          {warnings.length > 0 && <Notice tone="warn"><ul className="list-disc pl-4 text-xs">{warnings.map((m, i) => <li key={i}>{m}</li>)}</ul></Notice>}

          {rows.length > 0 && (
            <>
              <ul className="divide-y rounded-md border" data-testid="list-import-rows">
                {rows.map((r, i) => {
                  const bad = !r.skip && (!r.playerId || r.uncertain);
                  return (
                    <li key={keys[i]} className={`grid gap-2 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_8rem_auto] sm:items-start ${r.skip ? 'opacity-50' : ''} ${bad ? 'bg-secondary/60' : ''}`} data-testid={`row-import-${i}`}>
                      <div className="min-w-0 text-xs">
                        <div className="font-semibold [overflow-wrap:anywhere]">{r.name}</div>
                        <div className="text-muted-foreground">{raw[i]?.slot} {r.team && `· ${r.team}`}</div>
                        {!r.skip && !r.playerId && <div className="font-semibold text-primary">Unmatched</div>}
                        {!r.skip && r.uncertain && <div className="font-semibold text-primary">Uncertain read</div>}
                      </div>
                      <PlayerPick id={String(i)} players={players} value={r.playerId} hint={r.name} onChange={id => patch(i, { playerId: id, slotId: '' })} />
                      <select aria-label={`Slot for ${r.name}`} className={`${field} !py-1 !text-xs`} value={r.slotId} onChange={e => patch(i, { slotId: e.target.value })} data-testid={`select-import-slot-${i}`}>
                        <option value="">Slot...</option>
                        {target.slotOptions(r).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={r.skip} onChange={e => patch(i, { skip: e.target.checked })} data-testid={`checkbox-import-skip-${i}`} />Skip</label>
                    </li>
                  );
                })}
              </ul>
              {!file && <button type="button" className={`${btn.ghost} self-start !py-1 !text-xs`} onClick={() => inputRef.current?.click()} data-testid="button-add-screenshot">Add another screenshot (cropped roster)</button>}
              {!file && <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="Add another screenshot" ref={inputRef} onChange={e => { accept(e.target.files?.[0]); e.target.value = ''; }} />}
              {unresolved > 0 && <p className="text-xs text-primary">{unresolved} selected row{unresolved === 1 ? '' : 's'} still need a player. Match or skip each.</p>}
              {blocking && <Notice tone="error" testId="text-import-blocking">{blocking}</Notice>}
              {applyError && <Notice tone="error" testId="text-import-apply-error">{applyError}</Notice>}
              <div className="space-y-2 rounded-md border bg-card p-2 text-xs">
                <p>Saved roster currently has <strong>{existing}</strong> player{existing === 1 ? '' : 's'}. Applying <strong>replaces</strong> it with the {used.length} selected. {target.replacementNote}</p>
                <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={lockOk} onChange={e => setLockOk(e.target.checked)} data-testid="checkbox-import-confirm" /><span>{target.confirmation}</span></label>
                {hasIl && <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={ilOk} onChange={e => setIlOk(e.target.checked)} data-testid="checkbox-import-il" /><span>I confirm the players in IL slots really occupy Yahoo IL slots. An Out status alone does not prove it.</span></label>}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className={btn.ghost} onClick={() => onOpenChange(false)} data-testid="button-import-cancel">Cancel</button>
                <button type="button" className={btn.primary} disabled={!canApply} onClick={apply} data-testid="button-import-apply">{target.applyLabel(used.length)}</button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function OpponentScreenshotImport({ w, onImported }: { w: W; onImported: () => void }) {
  const players = w.draft.state.players;
  return <LineupScreenshotImport onImported={onImported} target={{
    demo: w.draft.state.source.isDemo, players, slots: w.slots,
    existing: w.planner.opponentRosterIds.length,
    title: 'Import opponent lineup',
    description: 'Paste your opponent’s Yahoo lineup, including the left position column. Review every row before replacing their lineup.',
    replacementNote: 'Your own lineup and games overrides for retained players are kept; overrides for removed players are dropped.',
    confirmation: `I reviewed every name and slot for my opponent’s locked lineup, ${w.planner.start} through ${w.planner.end}. Applying replaces their entire roster with the selected rows above; any existing players not included here will be removed.`,
    reviewRows: raw => screenshotReviewRows({ rows: raw, warnings: [] }, players, w.slots),
    validate: rows => { importOpponentLineup(w.planner, rows, players, w.slots, true); },
    slotOptions: row => {
      const player = players.find(p => p.id === row.playerId);
      return player ? w.slots.filter(s => s.id === row.slotId || s.kind === 'il' || eligibleWeeklySlot(player, s, w.planner.ilEligibleIds ?? [])) : w.slots;
    },
    apply: (rows, ilConfirmed) => w.importOpponent(rows, ilConfirmed),
    successMessage: count => `Imported ${count} opponent player${count === 1 ? '' : 's'}.`,
    applyLabel: count => `Replace opponent with ${count}`,
  }} />;
}

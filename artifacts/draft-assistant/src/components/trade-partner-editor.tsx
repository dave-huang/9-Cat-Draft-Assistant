import { useState } from 'react';
import { X } from 'lucide-react';
import { btn, ConfirmButton, errMsg, field } from '@/components/bits';
import type { TradesHook } from '@/hooks/use-trades';
import type { Player } from '@/lib/draft-types';

export function TradePartnerEditor({ t, partnerId, onError }: { t: TradesHook; partnerId: string; onError: (m: string) => void }) {
  const partner = t.partners.find(p => p.id === partnerId);
  const [search, setSearch] = useState('');
  const [name, setName] = useState<string | null>(null);
  const [ilFor, setIlFor] = useState<Player | null>(null);
  const [ilOk, setIlOk] = useState(false);
  if (!partner) return null;
  const run = (fn: () => void) => { try { fn(); onError(''); } catch (e) { onError(errMsg(e)); } };
  const il = partner.reserveIds.length;
  const regular = partner.players.length - il;
  const results = t.availablePlayers(partner.id, search);
  const hasOpp = !!t.draft.state.matchup?.opponentRosterIds.length;
  const copyOpp = () => run(() => t.copyWeeklyOpponent(partner.id));
  return (
    <div className="space-y-3" data-testid={`editor-trade-partner-${partner.id}`}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[10rem] flex-1 text-xs">Team name
          <input className={field} value={name ?? partner.name} onChange={e => setName(e.target.value)} data-testid="input-trade-partner-rename" />
        </label>
        <button type="button" className={btn.ghost} disabled={name === null || !name.trim() || name === partner.name} onClick={() => run(() => { t.renamePartner(partner.id, name ?? ''); setName(null); })} data-testid="button-trade-rename">Rename</button>
        <ConfirmButton testId="button-trade-delete" label="Delete team" confirmLabel="Yes, delete saved roster" description={`Deletes ${partner.name} and its ${partner.players.length} saved players from this workspace.`} onConfirm={() => run(() => t.removePartner(partner.id))} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="text-trade-partner-count">
        <span><strong className="text-foreground">{regular}/{t.draft.state.settings.rosterSlots.length}</strong> regular</span>
        <span><strong className="text-foreground">{il}/{t.draft.state.settings.injuryReserveSlots}</strong> IL</span>
        {regular < 10 && <span className="text-destructive">Under 10 non-IL players: scan will skip this team. 12 recommended.</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {partner.players.length ? (
          <ConfirmButton testId="button-trade-copy-opponent" danger={false} disabled={!hasOpp} label="Replace with current Weekly opponent" confirmLabel="Replace roster" description="This replaces the saved roster and IL list for this team. Weekly is not changed." onConfirm={copyOpp} />
        ) : (
          <button type="button" className={btn.ghost} disabled={!hasOpp} onClick={copyOpp} data-testid="button-trade-copy-opponent">Copy current Weekly opponent</button>
        )}
        {!hasOpp && <span className="text-xs text-muted-foreground">No Weekly opponent saved. Use search.</span>}
      </div>
      <ul className="divide-y rounded-md border" data-testid="list-trade-partner-roster">
        {partner.players.map(p => {
          const isIl = partner.reserveIds.includes(p.id);
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-sm">
              <span className="min-w-0 flex-1"><strong className="font-medium">{p.name}</strong> <span className="text-[11px] text-muted-foreground">{p.positions.join('/')} - {p.team}{p.injuryStatus ? ` - ${p.injuryStatus}` : ''}</span>{isIl && <span className="ml-1.5 rounded bg-secondary px-1 text-[10px] font-semibold">IL</span>}</span>
              {isIl
                ? <button type="button" className={btn.ghost} onClick={() => run(() => t.setReserve(partner.id, p.id, false))} data-testid={`button-trade-il-${p.id}`}>Move to regular</button>
                : <button type="button" className={btn.ghost} onClick={() => { setIlFor(p); setIlOk(false); }} data-testid={`button-trade-il-${p.id}`}>Mark IL</button>}
              <button type="button" aria-label={`Remove ${p.name}`} className={btn.ghost} onClick={() => run(() => t.removePlayer(partner.id, p.id))} data-testid={`button-trade-remove-${p.id}`}><X className="h-3.5 w-3.5" /></button>
            </li>
          );
        })}
        {!partner.players.length && <li className="px-2.5 py-3 text-sm text-muted-foreground">No players yet. Search below or copy your Weekly opponent.</li>}
      </ul>
      {ilFor && (
        <div className="rounded-md border border-[hsl(40_80%_40%)]/40 bg-[hsl(44_90%_60%)]/20 p-3 text-sm" data-testid="panel-trade-il-confirm">
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={ilOk} onChange={e => setIlOk(e.target.checked)} data-testid="checkbox-trade-il-confirm" />
            <span>I confirmed in Yahoo that {ilFor.name} is actually in this team's IL slot. An Out injury status alone does not make a player IL-eligible.</span></label>
          <div className="mt-2 flex gap-2">
            <button type="button" className={btn.primary} disabled={!ilOk} onClick={() => run(() => { t.setReserve(partner.id, ilFor.id, true); setIlFor(null); })} data-testid="button-trade-il-confirm">Mark as IL</button>
            <button type="button" className={btn.ghost} onClick={() => setIlFor(null)}>Cancel</button>
          </div>
        </div>
      )}
      <div>
        <label className="text-xs">Add player
          <input className={field} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name" data-testid="input-trade-player-search" />
        </label>
        {search.trim() && (
          <ul className="mt-1 divide-y rounded-md border" data-testid="list-trade-search">
            {results.map(p => (
              <li key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-[11px] text-muted-foreground">{p.positions.join('/')} - {p.team}</span></span>
                <button type="button" className={btn.ghost} onClick={() => run(() => { t.addPlayer(partner.id, p.id); setSearch(''); })} data-testid={`button-trade-add-${p.id}`}>Add</button>
              </li>
            ))}
            {!results.length && <li className="px-2.5 py-2 text-sm text-muted-foreground">No available players match. Already-owned players are hidden.</li>}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">To add a 14th player while 12 are regular, mark one as IL first (only if Yahoo confirms).</p>
      </div>
    </div>
  );
}

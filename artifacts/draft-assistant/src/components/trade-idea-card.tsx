import { useState } from 'react';
import { ChevronDown, Copy } from 'lucide-react';
import { CAT_LABEL, btn, field } from '@/components/bits';
import { CATEGORY_KEYS, type CategoryKey, type Player } from '@/lib/draft-types';
import { tradePitch, type TradeIdea, type TradeProfile } from '@/lib/trade-engine';

const num = (k: CategoryKey, n: number) => (k === 'fg' || k === 'ft' ? `${(n * 100).toFixed(1)}%` : n.toFixed(1));
const labels = (ks: CategoryKey[]) => (ks.length ? ks.map(k => CAT_LABEL[k]).join(', ') : 'none');
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;

export function PlayerLine({ p }: { p: Player }) {
  const status = p.injuryStatus?.trim();
  return (
    <div className="min-w-0 text-sm">
      <span className="font-medium">{p.name}</span>{' '}
      <span className="text-[11px] text-muted-foreground">{p.positions.join('/')} - {p.team} - {Math.round(p.games)} GP proj{status ? ` - ${status}` : ''}</span>
      {p.injuryNote && <div className="truncate text-[11px] text-muted-foreground">{p.injuryNote}</div>}
    </div>
  );
}

function Side({ title, gains, costs, before, after }: { title: string; gains: CategoryKey[]; costs: CategoryKey[]; before: TradeProfile; after: TradeProfile }) {
  return (
    <div className="min-w-0 rounded-md border p-2.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      <p className="mt-1 text-xs"><strong>Helps:</strong> {labels(gains)}</p>
      <p className="text-xs"><strong>Costs:</strong> {labels(costs)}</p>
      <table className="mt-2 w-full text-[11px] tabular-nums">
        <thead><tr className="text-left text-muted-foreground"><th className="font-medium">Cat</th><th className="text-right font-medium">Before</th><th className="text-right font-medium">After</th></tr></thead>
        <tbody>
          {CATEGORY_KEYS.map(k => (
            <tr key={k}><td>{CAT_LABEL[k]}{k === 'turnovers' ? ' (lower better)' : ''}</td><td className="text-right">{num(k, before.values[k])}</td><td className="text-right font-medium">{num(k, after.values[k])}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TradeIdeaCard({ idea, index }: { idea: TradeIdea; index: number }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [manual, setManual] = useState('');
  const copy = async () => {
    const text = tradePitch(idea);
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setManual(''); setMsg('Proposal copied. Nothing was sent or changed.');
    } catch { setManual(text); setMsg('Clipboard blocked. Select and copy the text below.'); }
  };
  return (
    <li className="min-w-0 rounded-lg border bg-card p-3" data-testid={`trade-idea-${index}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">#{index + 1} with {idea.partnerName}</h3>
        <span className="font-mono text-[11px] text-muted-foreground">value gap {(idea.valueGap * 100).toFixed(1)}% (max 12){idea.adpGap !== undefined ? ` - ADP check ${(idea.adpGap * 100).toFixed(1)}% (max 20)` : ''}</span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div><div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">You give</div>{idea.give.map(p => <PlayerLine key={p.id} p={p} />)}</div>
        <div><div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">You receive</div>{idea.receive.map(p => <PlayerLine key={p.id} p={p} />)}</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
        <span data-testid={`text-trade-my-gain-${index}`}>Your gain {signed(idea.myGain)} index pts</span>
        <span data-testid={`text-trade-their-gain-${index}`}>Their gain {signed(idea.theirGain)} index pts</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={btn.primary} onClick={copy} data-testid={`button-copy-trade-${index}`}><Copy className="h-3.5 w-3.5" />Copy proposal</button>
        <button type="button" className={btn.ghost} aria-expanded={open} onClick={() => setOpen(!open)} data-testid={`button-trade-details-${index}`}>
          Why this works <ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {msg && <p role="status" className="mt-2 text-xs text-muted-foreground" data-testid={`text-copy-status-${index}`}>{msg}</p>}
      {manual && <textarea readOnly rows={4} value={manual} onFocus={e => e.currentTarget.select()} className={`${field} mt-1`} aria-label="Proposal text" data-testid={`text-trade-manual-${index}`} />}
      {open && (
        <div className="mt-3 space-y-2" data-testid={`trade-details-${index}`}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Side title="You" gains={idea.gains} costs={idea.costs} before={idea.mineBefore} after={idea.mineAfter} />
            <Side title={idea.partnerName} gains={idea.theirGains} costs={idea.theirCosts} before={idea.theirBefore} after={idea.theirAfter} />
          </div>
          <p className="text-[11px] text-muted-foreground">Counting values are projected season totals ÷ 82, summed across all non-IL players, including bench depth. Shooting percentages use total makes ÷ attempts. These are not one-week totals.</p>
          <ul className="list-disc pl-4 text-[11px] text-muted-foreground">{idea.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
    </li>
  );
}

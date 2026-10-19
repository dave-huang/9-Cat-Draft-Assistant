import { Link } from 'wouter';
import { useDraft } from '@/hooks/use-draft';
import { Notice, Panel, btn, fmt } from '@/components/bits';
import { InjuryReserveSlots } from '@/components/InjuryReserveSlots';

const STATUS: Record<string, { text: string; cls: string }> = {
  strong: { text: 'Strong', cls: 'bg-accent text-accent-foreground' },
  balanced: { text: 'Balanced', cls: 'bg-secondary text-secondary-foreground' },
  'needs-work': { text: 'Needs work', cls: 'bg-primary text-primary-foreground' },
  empty: { text: 'No data', cls: 'bg-muted text-muted-foreground' },
};

export default function Roster() {
  const { analysis: a, state } = useDraft();
  const filled = a.rosterAssignment.filter((s) => s.player).length;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Roster slots" aside={<span className="font-mono text-xs" data-testid="text-filled">{filled}/{a.rosterAssignment.length}</span>}>
        {a.roster.length === 0 && (
          <div className="mb-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="empty-roster">
            You have not drafted anyone yet. Your picks will fill slots here in order of eligibility.
            <div className="mt-2"><Link href="/" className={btn.primary}>Back to live draft</Link></div>
          </div>
        )}
        <ul className="divide-y">
          {a.rosterAssignment.map((s, i) => (
            <li key={i} className="flex items-center gap-3 py-2" data-testid={`row-slot-${i}`}>
              <span className="w-10 rounded bg-secondary py-0.5 text-center font-mono text-xs font-semibold">{s.slot}</span>
              {s.player ? (
                <span className="min-w-0 truncate text-sm font-semibold">{s.player.name} <span className="font-mono text-[11px] font-normal text-muted-foreground">{s.player.team} {s.player.positions.join('/')}</span></span>
              ) : (
                <span className="text-sm text-muted-foreground">Open</span>
              )}
            </li>
          ))}
        </ul>
        <InjuryReserveSlots count={state.settings.injuryReserveSlots} />
      </Panel>

      <div className="space-y-4">
        {a.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
        <Panel title="Nine-category balance">
          <ul className="space-y-2.5">
            {a.categories.map((c) => {
              const st = STATUS[c.status] ?? STATUS.empty;
              const w = Math.min(100, Math.max(4, 50 + (c.z / 3) * 50));
              return (
                <li key={c.key} data-testid={`row-cat-${c.key}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{c.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.key === 'fg' || c.key === 'ft' ? `${fmt(c.value * (c.value <= 1 ? 100 : 1))}%` : fmt(c.value)} / z {c.z >= 0 ? '+' : ''}{fmt(c.z, 2)}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${st.cls}`}>{st.text}</span>
                  </div>
                  <div className="relative mt-1 h-1.5 rounded-full bg-muted" aria-hidden>
                    <div className={`h-full origin-left rounded-full transition-transform duration-500 ${c.z >= 0 ? 'bg-accent' : 'bg-primary'}`} style={{ width: `${w}%` }} />
                    <div className="absolute left-1/2 top-[-2px] h-2.5 w-px bg-foreground/40" />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Z-scores compare your roster to the average drafted player. They are a relative guide, not a win probability. Turnovers are oriented so lower is better. Tick marks show the average.
          </p>
        </Panel>
      </div>
    </div>
  );
}

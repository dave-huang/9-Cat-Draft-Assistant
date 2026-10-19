import { useState, type ReactNode } from 'react';
import type { CategoryKey, CategoryValues } from '@/lib/draft-types';
import { CATEGORY_KEYS } from '@/lib/draft-types';

export const CAT_LABEL: Record<CategoryKey, string> = {
  fg: 'FG%',
  ft: 'FT%',
  threes: '3PM',
  points: 'PTS',
  rebounds: 'REB',
  assists: 'AST',
  steals: 'STL',
  blocks: 'BLK',
  turnovers: 'TO',
};

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function Panel({ title, aside, children, className = '' }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border bg-card ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
          {aside}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Notice({ tone = 'info', children, testId }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode; testId?: string }) {
  const tones = {
    info: 'border-accent/30 bg-accent/10 text-foreground',
    warn: 'border-[hsl(40_80%_40%)]/40 bg-[hsl(44_90%_60%)]/20 text-foreground',
    error: 'border-destructive/40 bg-destructive/10 text-destructive',
    ok: 'border-[hsl(150_36%_34%)]/40 bg-[hsl(150_36%_34%)]/10 text-foreground',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} data-testid={testId} className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export const btn = {
  primary: 'inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition active:scale-[0.97] hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  ghost: 'inline-flex items-center justify-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium transition active:scale-[0.97] hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  danger: 'inline-flex items-center justify-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground transition active:scale-[0.97] hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
};

export const field =
  'w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50';

/** Two-step inline confirmation. */
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, testId, danger = true, description }: { label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean; testId: string; danger?: boolean; description?: ReactNode }) {
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <button type="button" disabled={disabled} className={danger ? btn.ghost : btn.ghost} data-testid={testId} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-2" data-testid={`${testId}-confirm`}>
      {description && <span className="max-w-xs text-xs text-muted-foreground">{description}</span>}
      <span className="inline-flex flex-wrap items-center gap-2">
        <button type="button" autoFocus className={btn.danger} data-testid={`${testId}-yes`} onClick={() => { setArmed(false); onConfirm(); }}>
          {confirmLabel}
        </button>
        <button type="button" className={btn.ghost} data-testid={`${testId}-no`} onClick={() => setArmed(false)}>
          Cancel
        </button>
      </span>
    </span>
  );
}

/** Compact bar showing a category Z-score (positive = helps, turnovers already oriented by the engine). */
export function ZBar({ z, label }: { z: number; label: string }) {
  const c = Math.max(-3, Math.min(3, z));
  const pct = (Math.abs(c) / 3) * 50;
  const pos = c >= 0;
  return (
    <div className="flex flex-col items-center gap-0.5" title={`${label}: ${z.toFixed(2)} z`}>
      <div className="relative h-8 w-3 overflow-hidden rounded-sm bg-muted" aria-hidden>
        <div className="absolute left-0 right-0 top-1/2 h-px bg-foreground/30" />
        <div
          className={`absolute left-0 right-0 ${pos ? 'bottom-1/2 bg-accent' : 'top-1/2 bg-primary'}`}
          style={{ height: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[9px] leading-none text-muted-foreground">{label}</span>
    </div>
  );
}

export function ZStrip({ z }: { z: CategoryValues }) {
  return (
    <div className="flex gap-1.5" role="img" aria-label="Nine-category z-scores">
      {CATEGORY_KEYS.map((k) => (
        <ZBar key={k} z={z[k]} label={CAT_LABEL[k]} />
      ))}
    </div>
  );
}

export function fmt(n: number, d = 1) {
  return Number.isFinite(n) ? n.toFixed(d) : '-';
}

import type { SeasonActualsFeed } from '@workspace/api-client-react';
import { btn } from '@/components/bits';

type Basis = 'projections' | 'actuals';
type Sample = { id: string; name: string; basis: Basis; gamesPlayed?: number; fallbackReason?: string };

export interface WeeklyStatsBasisProps {
  basis: Basis;
  onChange: (basis: Basis) => void;
  actuals?: SeasonActualsFeed;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  projectionSeason: string;
  projectionLabel: string;
  samples: Sample[];
  demo: boolean;
}

const when = (s?: string) => {
  if (!s) return 'unknown';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleString();
};

export function WeeklyStatsBasis({ basis, onChange, actuals, loading, refreshing, error, onRefresh, projectionSeason, projectionLabel, samples, demo }: WeeklyStatsBasisProps) {
  const isActuals = basis === 'actuals';
  const used = samples.filter(s => s.basis === 'actuals');
  const fallbacks = samples.filter(s => s.basis !== 'actuals');
  const early = used.filter(s => (s.gamesPlayed ?? 0) < 10);
  const seg = (active: boolean) =>
    `rounded px-2 py-1 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 disabled:pointer-events-none ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`;
  const busy = loading || refreshing;

  return (
    <div className="mt-1.5 border-t pt-1.5 text-xs" data-testid="section-stats-basis">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" id="stats-basis-label">Stats basis</span>
        <div role="group" aria-labelledby="stats-basis-label" className="inline-flex gap-0.5 rounded-md border bg-card p-0.5">
          <button type="button" className={seg(!isActuals)} aria-pressed={!isActuals} data-testid="button-basis-projections" onClick={() => onChange('projections')}>Season projections</button>
          <button type="button" className={seg(isActuals)} aria-pressed={isActuals} disabled={demo} title={demo ? 'Unavailable in demo mode' : undefined} data-testid="button-basis-actuals" onClick={() => onChange('actuals')}>Season-to-date averages</button>
        </div>
        {isActuals && !demo && (
          <button type="button" className={`${btn.ghost} !py-1 !text-xs`} disabled={busy} data-testid="button-refresh-actuals" onClick={onRefresh}>
            {busy ? 'Refreshing...' : error ? 'Retry actuals' : 'Refresh actuals'}
          </button>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground" data-testid="text-basis-active">
          {isActuals ? `Using ${actuals?.season ?? 'current'} season-to-date averages` : `Using ${projectionSeason} season projections`}
        </span>
      </div>

      {demo && <p className="mt-1 text-muted-foreground">Season-to-date averages are unavailable with demo data.</p>}

      {!isActuals && (
        <p className="mt-1 text-muted-foreground" data-testid="text-basis-summary">
          Source: {projectionLabel} {projectionSeason} per-game projections. Switching basis updates both teams and recommendations, never lineups.
        </p>
      )}

      {isActuals && !demo && (
        <div className="mt-1 space-y-1 text-muted-foreground [overflow-wrap:anywhere]" data-testid="text-basis-summary">
          {loading && !actuals && <p role="status">Loading season-to-date averages...</p>}
          {error && (
            <p role="alert" className="font-medium text-destructive" data-testid="text-actuals-error">
              Could not load season-to-date averages: {error}. Estimates are disabled until you retry or switch back to season projections.
            </p>
          )}
          {!error && actuals && (
            <>
              <p className="font-mono text-[11px]">
                {actuals.provider} · {actuals.season} regular season · retrieved {when(actuals.fetchedAt)} ·{' '}
                {actuals.statsThroughDate ? `stats through ${actuals.statsThroughDate}` : 'ESPN does not supply the latest included game date'}
              </p>
              <p data-testid="text-basis-counts">
                <strong className="text-foreground">{used.length}</strong> rostered using season-to-date averages
                {fallbacks.length > 0 && <>, <strong className="text-foreground">{fallbacks.length}</strong> using {projectionLabel} {projectionSeason} projection fallback{fallbacks.length === 1 ? '' : 's'}</>}.
              </p>
              {early.length > 0 && (
                <p className="font-medium text-foreground" data-testid="warn-basis-early">
                  Early sample: {early.length} player{early.length === 1 ? ' has' : 's have'} under 10 games played, so averages are noisy.
                </p>
              )}
            </>
          )}
          <p>Current-season regular-season averages forecast the selected week. They are not live scores, and switching basis never changes lineups.</p>
        </div>
      )}

      {isActuals && !demo && !error && actuals && samples.length > 0 && (
        <details className="mt-1" data-testid="details-basis-samples">
          <summary className="cursor-pointer font-medium text-muted-foreground">Per-player basis ({samples.length})</summary>
          <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
            {samples.map(s => (
              <li key={s.id} className="flex flex-wrap justify-between gap-x-2 border-b py-0.5" data-testid={`row-basis-${s.id}`}>
                <span className="min-w-0 truncate">{s.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {s.basis === 'actuals' ? `${s.gamesPlayed ?? 0} GP` : 'Projection fallback'}
                </span>
                {s.basis !== 'actuals' && <p className="basis-full text-[11px]">{s.fallbackReason ?? 'No usable current-season actuals.'}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

import { RefreshCw, ExternalLink } from 'lucide-react';
import { useDraft } from '@/hooks/use-draft';
import { useDraftData } from '@/hooks/use-draft-data';
import { btn, Notice, Panel } from './bits';

export function DraftDataPanel() {
  const d = useDraft();
  const data = useDraftData();
   const { source, injuryFeed, eligibilityFeed } = d.state;
   const busy = data.loadingProjections || data.refreshing || data.loadingEligibility;
  return (
    <Panel title="Current player data — no Yahoo connection">
      <p className="text-sm leading-relaxed">Use Yahoo position eligibility for roster fit, with ESPN full-season projections and injury reports. No Yahoo sign-in required. Refreshes preserve your picks, shortlist and manual position corrections.</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-testid="data-provenance">
        <dt className="text-muted-foreground">Season / players</dt><dd>{source.season} / {d.state.players.length}</dd>
        <dt className="text-muted-foreground">Last projection check</dt><dd>{source.checkedAt ? new Date(source.checkedAt).toLocaleString() : 'Not checked'}</dd>
        <dt className="text-muted-foreground">Snapshot from ESPN</dt><dd>{source.fetchedAt ? new Date(source.fetchedAt).toLocaleString() : 'Not retrieved from a feed'}{source.provider === 'ESPN' && ' (cached up to 15 min)'}</dd>
        <dt className="text-muted-foreground">Forecast published</dt><dd>{source.updatedAt ? new Date(source.updatedAt).toLocaleString() : 'Not supplied by provider — retrieval time is not forecast age'}</dd>
        <dt className="text-muted-foreground">Injuries checked</dt><dd>{injuryFeed ? new Date(injuryFeed.checkedAt).toLocaleString() : 'Not checked'}</dd>
        {injuryFeed?.reportUpdatedAt && <><dt className="text-muted-foreground">Report updated</dt><dd>{new Date(injuryFeed.reportUpdatedAt).toLocaleString()}</dd></>}
        <dt className="text-muted-foreground">Yahoo eligibility</dt><dd data-testid="text-eligibility-coverage">{eligibilityFeed ? `${eligibilityFeed.matchedPlayers}/${d.state.players.length} matched from ${eligibilityFeed.totalPlayers} Yahoo players · ${eligibilityFeed.season}` : 'Not checked — positions are not Yahoo-verified'}</dd>
        <dt className="text-muted-foreground">Yahoo last check</dt><dd>{eligibilityFeed ? new Date(eligibilityFeed.checkedAt).toLocaleString() : 'Not checked'}</dd>
        <dt className="text-muted-foreground">Yahoo snapshot</dt><dd>{eligibilityFeed ? `${new Date(eligibilityFeed.fetchedAt).toLocaleString()} (cached up to 15 min)` : 'Not retrieved'}</dd>
        <dt className="text-muted-foreground">Position overrides</dt><dd>{d.state.players.filter(p => p.positionsVerified).length} manual · {d.state.players.filter(p => p.positionsConflict).length} conflicts · {eligibilityFeed?.unmatchedPlayers ?? d.state.players.length} unmatched</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={btn.primary} disabled={busy || (source.isDemo && d.state.picks.length > 0)} data-testid="button-refresh-projections" onClick={() => {
          if (!source.isDemo && source.provider !== 'ESPN' && !window.confirm('Replace imported stats with ESPN projections? Existing picks and manual position corrections are kept. Yahoo eligibility is applied separately. Export a backup first if you want to retain imported stats.')) return;
          void data.refreshProjections();
        }}><RefreshCw className={`h-4 w-4 ${data.loadingProjections ? 'animate-spin' : ''}`} />{data.loadingProjections ? 'Loading current data…' : source.provider === 'ESPN' ? 'Refresh all player data' : 'Load season data + Yahoo positions'}</button>
        <button className={btn.ghost} disabled={busy || source.isDemo} data-testid="button-data-injuries" onClick={() => void data.refreshInjuries()}>Refresh injuries only</button>
        <button className={btn.ghost} disabled={busy || source.isDemo} data-testid="button-data-eligibility" onClick={() => void data.refreshEligibility()}>{data.loadingEligibility ? 'Checking Yahoo positions…' : 'Refresh Yahoo positions only'}</button>
      </div>
      {data.error && <div className="mt-3"><Notice tone="error" testId="text-feed-error">{data.error}</Notice></div>}
      {data.eligibilityError && <div className="mt-3"><Notice tone="warn" testId="text-feed-eligibility-error">Yahoo eligibility: {data.eligibilityError} Previous positions and all picks were kept.</Notice></div>}
      {eligibilityFeed && eligibilityFeed.unmatchedPlayers > 0 && <div className="mt-3"><Notice tone="warn">{eligibilityFeed.unmatchedPlayers} players were not matched to Yahoo. Their saved or fallback positions are labeled individually; verify these in your Yahoo draft.</Notice></div>}
      {data.success && !busy && !data.error && <div className="mt-3"><Notice tone="ok" testId="text-feed-success">{data.success}</Notice></div>}
      {source.isDemo && d.state.picks.length > 0 && <div className="mt-3"><Notice tone="warn">Your saved practice picks use demo player IDs. Export a backup, then explicitly reset the practice draft below before loading current projections.</Notice></div>}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Positions come from Yahoo’s public standard Draft Analysis data, not your private league. Your league’s display is authoritative for any commissioner-specific changes. Manual corrections take priority; unmatched players retain clearly labeled saved or unverified positions. Yahoo positions and ESPN projections refresh every 15 minutes while visible; injuries refresh every five minutes. Yahoo’s public resource is not a guaranteed stable feed. Retrieval times are not publication dates. ADP remains ESPN’s, not Yahoo’s. Unreported injuries do not mean healthy; expected return dates are estimates, not clearance.</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Projected games remain the provider’s forecast. A small, explicit uncertainty adjustment for Out / doubtful / day-to-day reports affects your fit ranking; no medical absence length is invented. This is a no-punt nine-category draft heuristic, not guaranteed optimal picks or calibrated win odds.</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <a href="https://fantasy.espn.com/basketball/players/projections" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">ESPN projections<ExternalLink className="h-3 w-3" /></a>
        <a href="https://www.espn.com/nba/injuries" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">ESPN injury reports<ExternalLink className="h-3 w-3" /></a>
        <a href="https://basketball.fantasysports.yahoo.com/nba/draftanalysis?pos=ALL" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Fantasy data provided by Yahoo Fantasy — positions<ExternalLink className="h-3 w-3" /></a>
      </div>
    </Panel>
  );
}

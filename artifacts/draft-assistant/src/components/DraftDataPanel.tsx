import { RefreshCw, ExternalLink } from 'lucide-react';
import { useDraft } from '@/hooks/use-draft';
import { useDraftData } from '@/hooks/use-draft-data';
import { btn, Notice, Panel } from './bits';

export function DraftDataPanel() {
  const d = useDraft();
  const data = useDraftData();
  const { source, injuryFeed } = d.state;
  const busy = data.loadingProjections || data.refreshing;
  return (
    <Panel title="Current player data — no Yahoo connection">
      <p className="text-sm leading-relaxed">Load full-season ESPN projections and current NBA injury reports. Recommendations recalculate locally after every Mine or Taken selection. Refreshes keep your picks and shortlist.</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-testid="data-provenance">
        <dt className="text-muted-foreground">Season / players</dt><dd>{source.season} / {d.state.players.length}</dd>
        <dt className="text-muted-foreground">Last projection check</dt><dd>{source.checkedAt ? new Date(source.checkedAt).toLocaleString() : 'Not checked'}</dd>
        <dt className="text-muted-foreground">Snapshot from ESPN</dt><dd>{source.fetchedAt ? new Date(source.fetchedAt).toLocaleString() : 'Not retrieved from a feed'}{source.provider === 'ESPN' && ' (cached up to 15 min)'}</dd>
        <dt className="text-muted-foreground">Forecast published</dt><dd>{source.updatedAt ? new Date(source.updatedAt).toLocaleString() : 'Not supplied by provider — retrieval time is not forecast age'}</dd>
        <dt className="text-muted-foreground">Injuries checked</dt><dd>{injuryFeed ? new Date(injuryFeed.checkedAt).toLocaleString() : 'Not checked'}</dd>
        {injuryFeed?.reportUpdatedAt && <><dt className="text-muted-foreground">Report updated</dt><dd>{new Date(injuryFeed.reportUpdatedAt).toLocaleString()}</dd></>}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={btn.primary} disabled={busy || (source.isDemo && d.state.picks.length > 0)} data-testid="button-refresh-projections" onClick={() => {
          if (!source.isDemo && source.provider !== 'ESPN' && !window.confirm('Replace imported projections with ESPN projections? Existing drafted players are kept; ESPN positions will replace imported positions. Export a backup first if you want to retain the imported stats.')) return;
          void data.refreshProjections();
        }}><RefreshCw className={`h-4 w-4 ${data.loadingProjections ? 'animate-spin' : ''}`} />{data.loadingProjections ? 'Loading current projections…' : source.provider === 'ESPN' ? 'Refresh projections + injuries' : 'Load ESPN projections + injuries'}</button>
        <button className={btn.ghost} disabled={busy || source.isDemo} data-testid="button-data-injuries" onClick={() => void data.refreshInjuries()}>Refresh injuries only</button>
      </div>
      {data.error && <div className="mt-3"><Notice tone="error" testId="text-feed-error">{data.error}</Notice></div>}
      {data.success && !busy && !data.error && <div className="mt-3"><Notice tone="ok" testId="text-feed-success">{data.success}</Notice></div>}
      {source.isDemo && d.state.picks.length > 0 && <div className="mt-3"><Notice tone="warn">Your saved practice picks use demo player IDs. Export a backup, then explicitly reset the practice draft below before loading current projections.</Notice></div>}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">ESPN positions and ADP are not Yahoo eligibility or Yahoo ADP. Click a player’s positions on the board to correct them from your Yahoo draft; corrections survive refreshes. The public projection API does not publish a forecast timestamp. Data retrieval can be current without proving when each forecast was revised. While the board or Settings is visible, projections refresh every 15 minutes and injury reports every five minutes. Unreported does not mean healthy. A report’s expected return date is an estimate, not clearance.</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Projected games remain the provider’s forecast. A small, explicit uncertainty adjustment for Out / doubtful / day-to-day reports affects your fit ranking; no medical absence length is invented. This is a no-punt nine-category draft heuristic, not guaranteed optimal picks or calibrated win odds.</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <a href="https://fantasy.espn.com/basketball/players/projections" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">ESPN projections<ExternalLink className="h-3 w-3" /></a>
        <a href="https://www.espn.com/nba/injuries" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">ESPN injury reports<ExternalLink className="h-3 w-3" /></a>
      </div>
    </Panel>
  );
}

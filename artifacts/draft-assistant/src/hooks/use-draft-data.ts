import { useEffect, useSyncExternalStore } from 'react';
import { getDraftInjuries, getDraftProjections } from '@workspace/api-client-react';
import { draftActions, getDraftSnapshot, useDraft } from './use-draft';

let snapshot = { refreshing: false, loadingProjections: false, error: null as string | null, success: null as string | null };
const listeners = new Set<() => void>();
let projectionRequest: Promise<void> | null = null;
let injuryRequest: Promise<void> | null = null;
let attemptedInitialLoad = false;
function publish(change: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...change };
  listeners.forEach(fn => fn());
}
const message = (e: unknown) => {
  const data = (e as { data?: { error?: unknown } })?.data;
  return typeof data?.error === 'string' ? data.error : e instanceof Error ? e.message : 'Current NBA data could not be loaded. The saved board is unchanged.';
};

async function refreshInjuries(): Promise<void> {
  if (injuryRequest) return injuryRequest;
  if (getDraftSnapshot().state.source.isDemo) {
    publish({ error: 'Load current season projections in Settings before checking injuries.' });
    return;
  }
  publish({ refreshing: true, error: null });
  injuryRequest = (async () => {
    try {
      const feed = await getDraftInjuries({ signal: AbortSignal.timeout(30_000) });
      draftActions.applyInjuries(feed.reports, feed.checkedAt, feed.reportUpdatedAt);
    } catch (e) { publish({ error: message(e) }); }
    finally { injuryRequest = null; publish({ refreshing: false }); }
  })();
  return injuryRequest;
}

async function refreshProjections(): Promise<void> {
  if (projectionRequest) return projectionRequest;
  publish({ loadingProjections: true, error: null, success: null });
  projectionRequest = (async () => {
    try {
      const feed = await getDraftProjections({ signal: AbortSignal.timeout(45_000) });
      const old = getDraftSnapshot().state.source;
      const now = new Date().toISOString();
      draftActions.loadCurrentProjections(feed.players, { ...feed.source, importedAt: old.provider === 'ESPN' ? old.importedAt ?? now : now, checkedAt: now });
      await refreshInjuries();
      if (!snapshot.error) publish({ success: `Checked ${feed.players.length} season projections and injury reports. Picks kept. Provider snapshots may be cached for up to 15 minutes; publication date is not supplied.` });
    } catch (e) { publish({ error: message(e) }); }
    finally { projectionRequest = null; publish({ loadingProjections: false }); }
  })();
  return projectionRequest;
}

/** One shared feed state across Settings and the board; picks never need network.
 * Injury refresh runs every five minutes while the screen is visible. Failed
 * requests retain the previous dated notes and surface an error, not "healthy".
 */
export function useDraftData() {
  const d = useDraft();
  const status = useSyncExternalStore(
    fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => snapshot,
  );
  useEffect(() => {
    if (!attemptedInitialLoad && d.state.source.isDemo && d.state.picks.length === 0 && !d.saveError && d.state.settings.trackingMode === 'manual') {
      attemptedInitialLoad = true;
      void refreshProjections();
    } else if (!attemptedInitialLoad && !d.saveError && d.state.source.provider === 'ESPN' &&
      (!d.state.source.fetchedAt || Date.now() - Date.parse(d.state.source.fetchedAt) > 15 * 60_000)) {
      attemptedInitialLoad = true;
      void refreshProjections();
    }
  }, [d.state.source.isDemo, d.state.source.provider, d.state.source.fetchedAt, d.state.picks.length, d.state.settings.trackingMode, d.saveError]);
  useEffect(() => {
    if (d.state.source.isDemo) return;
    const check = () => {
      const latest = getDraftSnapshot();
      if (document.visibilityState !== 'visible') return;
      if (latest.state.source.provider === 'ESPN' && (!latest.state.source.fetchedAt || Date.now() - Date.parse(latest.state.source.fetchedAt) > 15 * 60_000)) {
        void refreshProjections();
      } else if (!latest.state.injuryFeed || Date.now() - Date.parse(latest.state.injuryFeed.checkedAt) > 5 * 60_000) void refreshInjuries();
    };
    check();
    const timer = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, [d.state.source.isDemo]);
  return { ...status, refreshInjuries, refreshProjections };
}

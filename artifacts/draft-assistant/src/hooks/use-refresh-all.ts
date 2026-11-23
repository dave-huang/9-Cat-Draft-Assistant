import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetNbaScheduleQueryKey, getGetSeasonActualsQueryKey } from '@workspace/api-client-react';
import { useDraft } from './use-draft';
import { useDraftData } from './use-draft-data';

/** The single "refresh everything" action: projections, Yahoo positions and injuries (one combined
 * refresh) plus whichever schedule and season-to-date queries the current screen is showing.
 * Failures stay in the existing per-feed messages; a failed feed never discards saved data. */
export function useRefreshAll() {
  const draft = useDraft();
  const data = useDraftData();
  const queryClient = useQueryClient();
  const [refetching, setRefetching] = useState(false);
  const { source, picks } = draft.state;
  const busy = data.loadingProjections || data.refreshing || data.loadingEligibility || refetching;
  // Demo data can be replaced by real data only before any practice picks exist.
  const disabled = busy || (source.isDemo && picks.length > 0);
  // Importing a CSV then refreshing replaces its stats with ESPN's: ask first.
  const replacesImport = !source.isDemo && source.provider !== 'ESPN';

  async function refreshAll() {
    setRefetching(true);
    try {
      await Promise.allSettled([
        data.refreshProjections(),
        queryClient.refetchQueries({ queryKey: getGetNbaScheduleQueryKey(), type: 'active' }),
        queryClient.refetchQueries({ queryKey: getGetSeasonActualsQueryKey(), type: 'active' }),
      ]);
    } finally { setRefetching(false); }
  }

  return { busy, disabled, isDemo: source.isDemo, replacesImport, refreshAll, data };
}

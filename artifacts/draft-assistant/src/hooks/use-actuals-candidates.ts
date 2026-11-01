import { useMemo } from 'react';
import { getGetSeasonActualsQueryKey, useGetSeasonActuals } from '@workspace/api-client-react';
import { useDraft } from './use-draft';
import { actualsOnlyCandidates } from '@/lib/weekly-stats';

/** Real-games-but-no-projection players for screens that share the weekly stats basis (Trades).
 * Offered only while Weekly is set to season-to-date averages; shares the Weekly feed request. */
export function useActualsCandidates() {
  const { state } = useDraft();
  const enabled = state.matchup?.statsBasis === 'actuals' && !state.source.isDemo;
  const request = useGetSeasonActuals({ query: {
    queryKey: getGetSeasonActualsQueryKey(), enabled, staleTime: 5 * 60_000, refetchOnWindowFocus: true, retry: 1,
  } });
  return useMemo(() => enabled ? actualsOnlyCandidates(state.players, state.source.season, request.data) : [],
    [enabled, state.players, state.source.season, request.data]);
}

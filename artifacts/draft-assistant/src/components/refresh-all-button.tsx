import { RefreshCw } from 'lucide-react';
import { useRefreshAll } from '@/hooks/use-refresh-all';
import { btn } from '@/components/bits';

/** The one data refresh control: projections, Yahoo positions, injuries, schedule and season-to-date averages. */
export function RefreshAllButton({ compact = false, primary = false }: { compact?: boolean; primary?: boolean }) {
  const { busy, disabled, isDemo, replacesImport, refreshAll } = useRefreshAll();
  const label = busy ? 'Refreshing…' : isDemo || replacesImport ? 'Load season data' : 'Refresh data';
  const onClick = () => {
    if (replacesImport && !window.confirm('Replace imported stats with ESPN projections? Existing picks and manual position corrections are kept. Yahoo eligibility is applied separately. Export a backup first if you want to retain imported stats.')) return;
    void refreshAll();
  };
  return (
    <button type="button" className={`${primary ? btn.primary : btn.ghost} ${compact ? '!py-1 !text-xs' : ''}`} disabled={disabled} onClick={onClick}
      title="Refresh projections, Yahoo positions, injuries, schedule and season-to-date averages" data-testid="button-refresh-all">
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />{label}
    </button>
  );
}

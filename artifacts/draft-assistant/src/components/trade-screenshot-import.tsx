import { LineupScreenshotImport } from './opponent-screenshot-import';
import { importTradePartnerRoster, tradeImportSlots, tradeScreenshotReviewRows } from '@/lib/trade-roster-import';
import type { TradesHook } from '@/hooks/use-trades';

export function TradeScreenshotImport({ t, partnerId, onImported }: { t: TradesHook; partnerId: string; onImported: () => void }) {
  const partner = t.partners.find(p => p.id === partnerId);
  if (!partner) return null;
  const state = t.draft.state;
  return <LineupScreenshotImport onImported={onImported} target={{
    demo: state.source.isDemo, players: state.players, slots: tradeImportSlots,
    existing: partner.rosterIds.length,
    title: `Import roster: ${partner.name}`,
    description: 'Paste or upload this team’s Yahoo lineup, including the left position column. Include active, bench and IL players; add more screenshots if the roster spans multiple images.',
    replacementNote: 'Only this saved trade partner changes. Your Weekly matchup, your team and other trade partners stay unchanged. Active and bench players are both Regular for trades.',
    confirmation: 'I reviewed every player and Regular / IL designation. Replace this saved trade partner’s entire roster with the selected rows above; existing players not included will be removed.',
    reviewRows: raw => tradeScreenshotReviewRows(raw, state.players),
    validate: rows => { importTradePartnerRoster(state, partnerId, rows, true); },
    slotOptions: () => tradeImportSlots,
    apply: (rows, ilConfirmed) => t.importScreenshot(partnerId, rows, ilConfirmed),
    successMessage: count => `Imported ${count} players for ${partner.name}. Weekly lineups unchanged.`,
    applyLabel: count => `Replace saved roster with ${count}`,
  }} />;
}

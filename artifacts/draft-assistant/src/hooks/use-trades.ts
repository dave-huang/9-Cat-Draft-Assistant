import { useMemo, useState } from 'react';
import { useDraft } from './use-draft';
import { useDraftData } from './use-draft-data';
import { recommendTrades, type TradeScan } from '@/lib/trade-engine';
import type { TradePartner, TradeWorkspace } from '@/lib/draft-types';
import type { LineupImportRow } from '@/lib/lineup-import';

const EMPTY: TradeWorkspace = { partners: [], lockedPlayerIds: [], packageSize: 'both' };

export function useTrades() {
  const draft = useDraft();
  const dataStatus = useDraftData();
  const { state } = draft;
  const workspace = state.trades ?? EMPTY;
  const ownIds = state.matchup?.myRosterIds ?? state.picks.filter(p => p.team === state.settings.myPosition).map(p => p.playerId);
  const reserveIds = state.matchup?.myReserveIds ?? [];
  const mine = state.players.filter(p => ownIds.includes(p.id));
  const partners = workspace.partners.map(p => ({ ...p, players: state.players.filter(player => p.rosterIds.includes(player.id)) }));
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<{ key: string; result: TradeScan } | null>(null);
  const key = useMemo(() => JSON.stringify([state.players, state.source, state.settings, ownIds, reserveIds, workspace]), [state.players, state.source, state.settings, ownIds.join(','), reserveIds.join(','), workspace]);
  const result = scan?.key === key ? scan.result : undefined;
  const update = (next: TradeWorkspace) => draft.updateTrades(next);
  const changePartner = (id: string, change: (p: TradePartner) => TradePartner) => {
    if (!workspace.partners.some(p => p.id === id)) throw new Error('Select a saved trade partner first.');
    update({ ...workspace, partners: workspace.partners.map(p => p.id === id ? change(p) : p) });
  };
  return {
    draft, dataStatus, workspace, mine, reserveIds, partners, busy, result,
    stale: !!scan && scan.key !== key,
    ownRosterSource: state.matchup ? 'Weekly roster' : 'Draft roster',
    availablePlayers(partnerId: string, search: string) {
      const excluded = new Set([...ownIds, ...workspace.partners.flatMap(p => p.rosterIds)]);
      if (!partnerId || !search.trim()) return [];
      const term = search.trim().toLocaleLowerCase();
      return state.players.filter(p => !excluded.has(p.id) && p.name.toLocaleLowerCase().includes(term)).slice(0, 12);
    },
    addPartner(name: string) {
      const id = crypto.randomUUID();
      update({ ...workspace, partners: [...workspace.partners, { id, name: name.trim(), rosterIds: [], reserveIds: [] }] });
      return id;
    },
    renamePartner(id: string, name: string) { changePartner(id, p => ({ ...p, name: name.trim() })); },
    removePartner(id: string) { update({ ...workspace, partners: workspace.partners.filter(p => p.id !== id) }); },
    addPlayer(partnerId: string, playerId: string) {
      changePartner(partnerId, p => ({ ...p, rosterIds: [...p.rosterIds, playerId] }));
    },
    removePlayer(partnerId: string, playerId: string) {
      changePartner(partnerId, p => ({ ...p, rosterIds: p.rosterIds.filter(id => id !== playerId), reserveIds: p.reserveIds.filter(id => id !== playerId) }));
    },
    setReserve(partnerId: string, playerId: string, confirmed: boolean) {
      changePartner(partnerId, p => ({ ...p, reserveIds: confirmed ? [...new Set([...p.reserveIds, playerId])] : p.reserveIds.filter(id => id !== playerId) }));
    },
    copyWeeklyOpponent(partnerId: string) {
      const opponent = state.matchup;
      if (!opponent?.opponentRosterIds.length) throw new Error('Add your opponent on Weekly first, or use player search here.');
      changePartner(partnerId, p => ({ ...p, rosterIds: [...opponent.opponentRosterIds], reserveIds: [...(opponent.opponentReserveIds ?? [])] }));
    },
    importScreenshot(partnerId: string, rows: LineupImportRow[], ilConfirmed: boolean) {
      draft.importTradePartner(partnerId, rows, ilConfirmed);
    },
    toggleLocked(id: string) {
      if (!ownIds.includes(id)) throw new Error('Only your players can be marked untouchable.');
      update({ ...workspace, lockedPlayerIds: workspace.lockedPlayerIds.includes(id) ? workspace.lockedPlayerIds.filter(p => p !== id) : [...workspace.lockedPlayerIds, id] });
    },
    setPackageSize(packageSize: TradeWorkspace['packageSize']) { update({ ...workspace, packageSize }); },
    async generate() {
      if (state.source.isDemo) throw new Error('Load current-season projections before evaluating real trades.');
      if (!partners.length) throw new Error('Add at least one potential trade partner and their full roster.');
      setBusy(true);
      try {
        await new Promise(resolve => setTimeout(resolve, 25));
        const result = recommendTrades({
          pool: state.players, mine, myReserveIds: reserveIds, partners,
          settings: state.settings, lockedPlayerIds: workspace.lockedPlayerIds, packageSize: workspace.packageSize,
        });
        setScan({ key, result });
      } finally { setBusy(false); }
    },
  };
}

export type TradesHook = ReturnType<typeof useTrades>;

import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Check, Search, Star, Undo2 } from 'lucide-react';
import { useDraft } from '@/hooks/use-draft';
import type { Recommendation } from '@/lib/draft-types';
import { btn, errMsg, field, fmt, Notice, Panel, ZStrip } from '@/components/bits';

const FILTERS = ['ALL', 'PG', 'SG', 'G', 'SF', 'PF', 'F', 'C'] as const;
type Filter = (typeof FILTERS)[number];

function matches(r: Recommendation, f: Filter) {
  if (f === 'ALL') return true;
  const p = r.player.positions as string[];
  if (f === 'G') return p.includes('PG') || p.includes('SG');
  if (f === 'F') return p.includes('SF') || p.includes('PF');
  return p.includes(f);
}

export default function Live() {
  const d = useDraft();
  const { state, analysis: a } = d;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [onlyList, setOnlyList] = useState(false);
  const [limit, setLimit] = useState(25);
  const [err, setErr] = useState<string | null>(null);

  const run = (fn: () => void) => {
    try {
      fn();
      setErr(null);
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return a.recommendations.filter(
      (r) => matches(r, filter) && (!onlyList || state.shortlist.includes(r.player.id)) && (!s || r.player.name.toLowerCase().includes(s) || r.player.team.toLowerCase().includes(s)),
    );
  }, [a.recommendations, q, filter, onlyList, state.shortlist]);

  const top = a.recommendations[0];
  const pickLabel = a.isMyTurn ? 'My pick' : 'Opponent pick';
  const shortlisted = state.shortlist.map((id) => byId.get(id)).filter((p) => p && !a.draftedIds.has(p.id));
  const history = [...state.picks].reverse();
  const noPlayers = state.players.length === 0;

  if (noPlayers)
    return (
      <Panel title="No players loaded">
        <p className="mb-3 text-sm">The player pool is empty. Import a per-game projections CSV to begin.</p>
        <Link href="/settings" className={btn.primary} data-testid="link-import-empty">Go to Settings</Link>
      </Panel>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4 min-w-0">
        {/* Clock */}
        <div className={`rounded-lg border-2 p-4 ${a.isMyTurn ? 'border-primary bg-primary/10' : 'border-border bg-card'}`} data-testid="panel-clock">
          {a.complete ? (
            <p className="text-lg font-bold" data-testid="text-complete">Draft complete. {a.totalPicks} picks made. Review your build on the Roster page.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{a.isMyTurn ? 'You are on the clock' : `Team ${a.currentTeam} is picking`}</div>
                <div className="text-3xl font-extrabold leading-none tracking-tight" data-testid="text-pick">
                  Pick <span className="font-mono">{a.nextPick}</span>
                </div>
              </div>
              <Stat label="Round" v={a.round} id="round" />
              <Stat label="Team" v={a.currentTeam} id="team" />
              <Stat label="Until mine" v={a.isMyTurn ? 'Now' : a.picksUntilMine} id="until" />
              <Stat label="My next" v={a.myNextPick ?? 'None'} id="mynext" />
            </div>
          )}
        </div>

        {err && <Notice tone="error" testId="text-error">{err}</Notice>}
        {a.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}

        {/* Top rec */}
        {top && !a.complete && (
          <Panel title={a.isMyTurn ? 'Top recommendation' : 'Best available (if it were your turn)'} aside={<span className="text-[11px] text-muted-foreground">Heuristic, not a guarantee</span>}>
            <div className="flex flex-wrap items-start justify-between gap-3" data-testid="card-top">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="text-2xl font-extrabold tracking-tight" data-testid="text-top-name">{top.player.name}</h3>
                  <span className="font-mono text-xs text-muted-foreground">{top.player.team} / {top.player.positions.join(', ')}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Overall rank {top.overallRank}{top.player.adp ? ` / ADP ${fmt(top.player.adp)}` : ''}{top.fillsSlot ? ' / fits your roster' : ' / no eligible slot'}
                </div>
              </div>
              <ZStrip z={top.categoryZ} />
            </div>
            <StatLine r={top} />
            <ul className="mt-3 space-y-1 text-sm">
              {top.reasons.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{x}</li>)}
              {top.warnings.map((x) => <li key={x} className="flex gap-2 text-destructive"><span className="font-mono font-bold">!</span>{x}</li>)}
            </ul>
            <div className="mt-4 flex gap-2">
              <button className={btn.primary} disabled={a.isMyTurn && !top.fillsSlot} data-testid="button-draft-top" onClick={() => run(() => d.markPick(top.player.id))}>{pickLabel}: {top.player.name}</button>
              <button className={btn.ghost} onClick={() => run(() => d.toggleShortlist(top.player.id))} data-testid="button-shortlist-top" aria-pressed={state.shortlist.includes(top.player.id)}>
                <Star className="h-4 w-4" />Shortlist
              </button>
            </div>
          </Panel>
        )}

        {/* Pool */}
        <Panel title={`Available players (${filtered.length})`}>
          <div className="mb-3 flex flex-wrap gap-2">
            <label className="relative min-w-[180px] flex-1">
              <span className="sr-only">Search players</span>
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(25); }} placeholder="Search name or team" className={`${field} pl-8`} data-testid="input-search" />
            </label>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Position filter">
              {FILTERS.map((f) => (
                <button key={f} aria-pressed={filter === f} data-testid={`filter-${f}`} onClick={() => { setFilter(f); setLimit(25); }} className={`rounded-md border px-2 py-1 font-mono text-xs transition active:scale-95 ${filter === f ? 'border-accent bg-accent text-accent-foreground' : 'bg-card hover:bg-secondary'}`}>{f}</button>
              ))}
              <button aria-pressed={onlyList} data-testid="filter-shortlist" onClick={() => setOnlyList(!onlyList)} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition active:scale-95 ${onlyList ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}`}><Star className="h-3 w-3" />List</button>
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="empty-pool">
              No available players match. Clear the search or filter{onlyList ? ', or turn off the shortlist view' : ''}.
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.slice(0, limit).map((r, i) => {
                const p = r.player;
                const on = state.shortlist.includes(p.id);
                return (
                  <li key={p.id} className="py-2.5" data-testid={`row-player-${p.id}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{r.rank}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="truncate font-semibold">{p.name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{p.team} {p.positions.join('/')}</span>
                          {p.adp !== undefined && <AdpTag adp={p.adp} next={a.nextPick} />}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {fmt(p.points)}p {fmt(p.rebounds)}r {fmt(p.assists)}a {fmt(p.steals)}s {fmt(p.blocks)}b {fmt(p.threes)}3 {fmt(p.turnovers)}to / {fmt(p.fga ? (p.fgm / p.fga) * 100 : 0)}% {fmt(p.fta ? (p.ftm / p.fta) * 100 : 0)}% / {p.games}gp
                        </div>
                        {i < 8 && !q && <div className="mt-0.5 text-[11px] text-accent">{r.reasons[0]}</div>}
                      </div>
                      <div className="hidden sm:block"><ZStrip z={r.categoryZ} /></div>
                      <button className="rounded p-1.5 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring" aria-label={on ? `Remove ${p.name} from shortlist` : `Shortlist ${p.name}`} aria-pressed={on} data-testid={`button-star-${p.id}`} onClick={() => run(() => d.toggleShortlist(p.id))}>
                        <Star className={`h-4 w-4 transition ${on ? 'fill-primary text-primary' : 'text-muted-foreground'}`} />
                      </button>
                      <button className={btn.primary} data-testid={`button-pick-${p.id}`} disabled={a.complete} onClick={() => run(() => d.markPick(p.id))}>Draft</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {filtered.length > limit && <button className={`${btn.ghost} mt-3 w-full`} onClick={() => setLimit(limit + 25)} data-testid="button-more">Show more ({filtered.length - limit} left)</button>}
        </Panel>
      </div>

      <aside className="space-y-4">
        <Panel title="Shortlist" aside={<span className="font-mono text-xs">{shortlisted.length}</span>}>
          {shortlisted.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="empty-shortlist">Star players you are watching. Drafted players drop off automatically.</p>
          ) : (
            <ul className="space-y-1.5">
              {shortlisted.map((p) => p && (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{p.name} <span className="font-mono text-[11px] text-muted-foreground">{p.positions.join('/')}</span></span>
                  <button className="text-xs underline" onClick={() => run(() => d.toggleShortlist(p.id))} data-testid={`button-unlist-${p.id}`}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Pick history" aside={<button className={btn.ghost} disabled={history.length === 0} onClick={() => run(d.undoPick)} data-testid="button-undo"><Undo2 className="h-3.5 w-3.5" />Undo</button>}>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="empty-history">No picks yet. The draft is empty.</p>
          ) : (
            <ol className="max-h-[360px] space-y-1 overflow-y-auto pr-1 text-sm">
              {history.map((p) => (
                <li key={p.overall} className={`flex gap-2 ${p.team === state.settings.myPosition ? 'font-semibold text-primary' : ''}`} data-testid={`row-pick-${p.overall}`}>
                  <span className="w-7 font-mono text-xs text-muted-foreground">{p.overall}</span>
                  <span className="font-mono text-xs">T{p.team}</span>
                  <span className="truncate">{byId.get(p.playerId)?.name ?? p.playerId}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
          Manual entry mode. This app is not connected to Yahoo; record each pick yourself as it happens.
        </p>
      </aside>
    </div>
  );
}

function Stat({ label, v, id }: { label: string; v: string | number; id: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="font-mono text-xl font-semibold" data-testid={`text-${id}`}>{v}</div>
    </div>
  );
}

function AdpTag({ adp, next }: { adp: number; next: number }) {
  const diff = next - adp;
  if (diff < 3) return <span className="font-mono text-[10px] text-muted-foreground">ADP {fmt(adp)}</span>;
  return <span className="rounded bg-[hsl(44_90%_60%)]/40 px-1 font-mono text-[10px]" title="Going later than his ADP: ADP watch">ADP {fmt(adp)} watch</span>;
}

function StatLine({ r }: { r: Recommendation }) {
  const p = r.player;
  const rows: [string, string][] = [
    ['PTS', fmt(p.points)], ['REB', fmt(p.rebounds)], ['AST', fmt(p.assists)], ['STL', fmt(p.steals)], ['BLK', fmt(p.blocks)], ['3PM', fmt(p.threes)], ['TO', fmt(p.turnovers)],
    ['FG%', fmt(p.fga ? (p.fgm / p.fga) * 100 : 0)], ['FT%', fmt(p.fta ? (p.ftm / p.fta) * 100 : 0)], ['GP', String(p.games)],
  ];
  return (
    <div className="mt-3 grid grid-cols-5 gap-2 rounded-md bg-muted p-2 sm:grid-cols-10">
      {rows.map(([k, v]) => (
        <div key={k} className="text-center">
          <div className="font-mono text-sm font-semibold">{v}</div>
          <div className="text-[10px] text-muted-foreground">{k}</div>
        </div>
      ))}
    </div>
  );
}


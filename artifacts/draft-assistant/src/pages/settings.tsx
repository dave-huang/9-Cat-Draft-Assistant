import { useEffect, useState, type ReactNode } from 'react';
import { Download, Plus, X } from 'lucide-react';
import { useDraft } from '@/hooks/use-draft';
import type { RosterSlot } from '@/lib/draft-types';
import { CSV_TEMPLATE } from '@/lib/projections';
import { LEAGUE_IL_SLOTS, LEAGUE_ROSTER_SLOTS } from '@/lib/league-roster';
import { DraftDataPanel } from '@/components/DraftDataPanel';
import { btn, ConfirmButton, errMsg, field, Notice, Panel } from '@/components/bits';

const SLOT_OPTIONS: RosterSlot[] = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'BN'];

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Msg({ m }: { m: { ok: boolean; t: string } | null }) {
  if (!m) return null;
  return <Notice tone={m.ok ? 'ok' : 'error'} testId={m.ok ? 'text-ok' : 'text-error'}>{m.t}</Notice>;
}

function L({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export default function Settings() {
  const d = useDraft();
  const { state, saveError } = d;
  const frozen = state.picks.length > 0;
  const [name, setName] = useState(state.settings.name);
  const [teams, setTeams] = useState(String(state.settings.teamCount));
  const [pos, setPos] = useState(String(state.settings.myPosition));
  const [slots, setSlots] = useState<RosterSlot[]>(state.settings.rosterSlots);
  const [ilSlots, setIlSlots] = useState(String(state.settings.injuryReserveSlots));
  const [lm, setLm] = useState<{ ok: boolean; t: string } | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [season, setSeason] = useState('');
  const [im, setIm] = useState<{ ok: boolean; t: string } | null>(null);

  const [bm, setBm] = useState<{ ok: boolean; t: string } | null>(null);
  const [backup, setBackup] = useState<string | null>(null);
  const [rm, setRm] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => {
    setName(state.settings.name);
    setTeams(String(state.settings.teamCount));
    setPos(String(state.settings.myPosition));
    setSlots(state.settings.rosterSlots);
    setIlSlots(String(state.settings.injuryReserveSlots));
  }, [state.settings]);

  const saveLeague = () => {
    try {
      d.updateSettings({ ...state.settings, name: name.trim(), teamCount: Number(teams), myPosition: Number(pos), rosterSlots: slots, injuryReserveSlots: Number(ilSlots) });
      setLm({ ok: true, t: 'League settings saved.' });
    } catch (e) {
      setLm({ ok: false, t: errMsg(e) });
    }
  };

  const doImport = async () => {
    if (!file) return setIm({ ok: false, t: 'Choose a CSV file first.' });
    try {
      const text = await file.text();
      d.importProjections(text, label.trim(), season.trim());
      setIm({ ok: true, t: `Imported projections from ${file.name}. Player pool replaced.` });
      setFile(null);
    } catch (e) {
      setIm({ ok: false, t: errMsg(e) });
    }
  };

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <Panel title="League setup">
          {frozen && <div className="mb-3"><Notice tone="info">Draft order and roster slots are locked because picks exist. Reset the draft to change them.</Notice></div>}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3"><L label="League name"><input className={field} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-league-name" /></L></div>
            <L label="Teams (4-20)"><input type="number" min={4} max={20} className={field} value={teams} disabled={frozen} onChange={(e) => setTeams(e.target.value)} data-testid="input-team-count" /></L>
            <L label="My draft slot"><input type="number" min={1} max={Number(teams) || 20} className={field} value={pos} disabled={frozen} onChange={(e) => setPos(e.target.value)} data-testid="input-my-position" /></L>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Draftable roster slots ({slots.length})</span>
              <button className="text-xs underline disabled:opacity-40" disabled={frozen} onClick={() => { setSlots([...LEAGUE_ROSTER_SLOTS]); setIlSlots(String(LEAGUE_IL_SLOTS)); }} data-testid="button-default-slots">Use my Yahoo roster</button>
            </div>
            <div className="mt-3 max-w-sm">
              <L label="IL reserve spots" hint="Your league: 12 draft picks + 2 IL reserves. IL does not add draft rounds or accept additional draft picks.">
                <input type="number" min={0} max={10} className={field} value={ilSlots} onChange={e => setIlSlots(e.target.value)} data-testid="input-il-slots" />
              </L>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {slots.map((s, i) => (
                <span key={i} className="inline-flex items-center rounded-md border bg-background">
                  <select aria-label={`Slot ${i + 1}`} disabled={frozen} value={s} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? (e.target.value as RosterSlot) : x)))} className="rounded-l-md bg-transparent px-1.5 py-1 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring" data-testid={`select-slot-${i}`}>
                    {SLOT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <button aria-label={`Remove slot ${i + 1}`} disabled={frozen} className="px-1 text-muted-foreground hover:text-destructive disabled:opacity-40" onClick={() => setSlots(slots.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
                </span>
              ))}
              <button disabled={frozen} className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs hover:bg-secondary disabled:opacity-40" onClick={() => setSlots([...slots, 'BN'])} data-testid="button-add-slot"><Plus className="h-3 w-3" />Slot</button>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <button className={btn.primary} onClick={saveLeague} data-testid="button-save-league">Save league</button>
            <Msg m={lm} />
          </div>
        </Panel>

        <Panel title="Projections source">
          <p className="break-words text-sm" data-testid="text-source">
            <strong>{state.source.label || 'Unlabeled'}</strong> / season {state.source.season || 'unspecified'} / {state.players.length} players
            {state.source.isDemo && <span className="ml-2 rounded bg-[hsl(44_90%_60%)]/50 px-1.5 text-xs font-semibold">Illustrative demo</span>}
          </p>
          {state.source.importedAt && <p className="mt-1 text-xs text-muted-foreground">Imported into this app {new Date(state.source.importedAt).toLocaleString()} (not the forecast date)</p>}
          <p className="mt-1 text-xs text-muted-foreground">Forecast date: {state.source.updatedAt ? new Date(state.source.updatedAt).toLocaleDateString() : 'unknown'}</p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Numbers must be per-game averages for one season. Games is the projected games played, from 1 to 82. Columns: <code className="break-all font-mono">name,team,positions,games,points,rebounds,assists,steals,blocks,threes,turnovers,fgm,fga,ftm,fta,adp,note</code>. Positions use PG, SG, SF, PF, C (for example PG/SG). ADP and note are optional; every other column is required. Any invalid row rejects the whole file.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <L label="Source label"><input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. My blended sheet" data-testid="input-source-label" /></L>
            <L label="Season"><input className={field} value={season} onChange={(e) => setSeason(e.target.value)} placeholder="e.g. 2026-27" data-testid="input-season" /></L>
            <div className="sm:col-span-2"><L label="CSV file"><input key={state.source.importedAt ?? 'initial'} type="file" accept=".csv,text/csv" className={field} onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={frozen} data-testid="input-csv-file" /></L></div>
          </div>
          {frozen && <div className="mt-3"><Notice tone="warn">Importing replaces the player pool, so it requires an empty draft. Reset picks first.</Notice></div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={btn.primary} disabled={frozen} onClick={doImport} data-testid="button-import-csv">Import and replace pool</button>
            <button className={btn.ghost} onClick={() => download('projections-template.csv', CSV_TEMPLATE, 'text/csv')} data-testid="button-download-template"><Download className="h-4 w-4" />CSV template</button>
          </div>
          <div className="mt-2"><Msg m={im} /></div>
        </Panel>
      </div>

      <div className="min-w-0 space-y-4">
        <Panel title="Saving and backup">
          <p className="text-sm" data-testid="text-save-state">{saveError ? '' : 'Your draft is saved automatically in this browser only. Clearing site data erases it, so export a backup.'}</p>
          {saveError && <Notice tone="error" testId="text-save-error">Could not save to this browser: {String(saveError)}. Export a backup now.</Notice>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={btn.ghost} onClick={() => download('draft-session.json', d.exportSession(), 'application/json')} data-testid="button-export-session"><Download className="h-4 w-4" />Export session JSON</button>
          </div>
          <div className="mt-4 border-t pt-3">
            <L label="Restore from backup JSON">
              <input type="file" accept=".json,application/json" className={field} data-testid="input-backup-file" onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try { setBackup(await f.text()); setBm(null); } catch (x) { setBm({ ok: false, t: errMsg(x) }); }
              }} />
            </L>
            {backup !== null && (
              <div className="mt-2 space-y-2">
                <Notice tone="warn">Restoring replaces your current league, players, picks and shortlist.</Notice>
                <div className="flex gap-2">
                  <button className={btn.danger} data-testid="button-confirm-restore" onClick={() => {
                    try { d.importSession(backup); setBm({ ok: true, t: 'Backup restored.' }); } catch (x) { setBm({ ok: false, t: errMsg(x) }); }
                    setBackup(null);
                  }}>Confirm restore</button>
                  <button className={btn.ghost} onClick={() => setBackup(null)}>Cancel</button>
                </div>
              </div>
            )}
            <div className="mt-2"><Msg m={bm} /></div>
          </div>
        </Panel>

        <Panel title="Reset draft">
          <p className="mb-3 text-sm text-muted-foreground">Clears all picks and the shortlist. Your projections and league setup stay.</p>
          <ConfirmButton testId="button-reset" label="Reset draft" confirmLabel="Yes, clear picks" description="This permanently clears picks and the shortlist for this draft. Export a session backup first if you want to keep the mock. Players, injury data and league settings stay; the earlier default roster, if present, updates to your Yahoo layout." disabled={!frozen && state.shortlist.length === 0 && !d.saveError} onConfirm={() => {
            try { d.resetDraft(); setRm({ ok: true, t: 'Draft reset.' }); } catch (x) { setRm({ ok: false, t: errMsg(x) }); }
          }} />
          <div className="mt-2"><Msg m={rm} /></div>
        </Panel>

        <Panel title="Draft tracking">
          <p className="text-sm" data-testid="text-tracking-mode">Mode: <strong>{state.settings.trackingMode === 'snake' ? 'Snake order' : 'Manual'}</strong>. No Yahoo sign-in required; you mark picks yourself while watching Yahoo.</p>
          {state.settings.trackingMode === 'snake' && (
            <button className={`${btn.ghost} mt-3`} data-testid="button-set-manual" onClick={() => { try { d.updateSettings({ ...state.settings, trackingMode: 'manual' }); setLm({ ok: true, t: 'Switched to manual tracking. Picks kept.' }); } catch (e) { setLm({ ok: false, t: errMsg(e) }); } }}>Switch to manual</button>
          )}
        </Panel>

        <DraftDataPanel />

        <Panel title="How recommendations work">
          <ul className="space-y-2 text-sm leading-relaxed">
            <li><strong>Nine categories, equal baseline.</strong> FG%, FT%, 3PM, PTS, REB, AST, STL, BLK and TO all start with the same weight. No category is deliberately punted.</li>
            <li><strong>Volume-weighted percentages.</strong> FG% and FT% are scored by makes versus attempts, so a high-volume shooter moves your team percentage more than a low-volume one.</li>
            <li><strong>Turnovers: lower is better.</strong> Turnover z-scores are flipped so fewer turnovers help.</li>
            <li><strong>Weakness attention, capped.</strong> Once you have players, categories where your roster trails get extra weight, with a cap so one weak category cannot take over the board.</li>
            <li><strong>Health weighting.</strong> Projected games played scale a player's value. Current Out / doubtful / day-to-day reports add a small uncertainty discount, without inventing a new games forecast.</li>
            <li><strong>Position eligibility.</strong> Players fill slots they qualify for, including bench slots. A pick that cannot fit your roster is not recommended for your turn.</li>
            <li><strong>ADP watch.</strong> If your CSV includes ADP, players who may be selected before your next pick are flagged. It is only a market signal.</li>
            <li><strong>A heuristic, not a guarantee.</strong> Z-scores use the draftable projection pool as a fixed baseline and are not win odds. Demo data is illustrative only. Injury reports are dated and refreshed separately; missing reports do not confirm health. Playoff schedules and lineup streaming are not modeled.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

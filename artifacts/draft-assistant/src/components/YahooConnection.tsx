import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw } from 'lucide-react';
import {
  getGetYahooLeaguesQueryKey,
  getGetYahooStatusQueryKey,
  useDisconnectYahoo,
  useGetYahooLeagues,
  useGetYahooStatus,
  useStartYahooAuthorization,
} from '@workspace/api-client-react';
import { btn, ConfirmButton, Notice, Panel } from '@/components/bits';

const ERRORS: Record<string, string> = {
  denied: 'You declined the new authorization request. Any previously saved Yahoo connection is unchanged.',
  state_invalid: 'The sign-in could not be matched to this browser session (expired or opened in a different browser or origin). Start again from the published app in a normal browser tab.',
  token_failed: 'Yahoo did not return access after approval. Try connecting again.',
  invalid_client: 'Yahoo rejected the app credentials. Check YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET in Replit Secrets.',
  invalid_grant: 'The Yahoo authorization code expired or was already used. Start again.',
  invalid_scope: 'Yahoo rejected the requested permission. Confirm the Yahoo app has Fantasy Sports read access.',
  provider_unavailable: 'Yahoo is unavailable right now. Try again shortly.',
};

const FANTASY_ACCESS_ERRORS = new Set([
  'fantasy_read_denied', 'fantasy_app_not_authorized',
  'fantasy_additional_authorization_required', 'fantasy_scope_denied',
]);

type CallbackResult = { ok: boolean; text: string } | null;

function readCallback(): CallbackResult {
  try {
    const u = new URL(window.location.href);
    const ok = u.searchParams.get('yahoo');
    const err = u.searchParams.get('yahoo_error');
    if (ok === 'connected') return { ok: true, text: 'Yahoo authorization completed. Read access is being verified below.' };
    if (err && err in ERRORS) return { ok: false, text: ERRORS[err] };
    if (err) return { ok: false, text: 'Yahoo sign-in failed for an unrecognized reason. Try again.' };
  } catch { /* ignore */ }
  return null;
}

function cleanUrl() {
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has('yahoo') && !u.searchParams.has('yahoo_error')) return;
    u.searchParams.delete('yahoo');
    u.searchParams.delete('yahoo_error');
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
  } catch { /* ignore */ }
}

function safeErr(e: unknown, fallback: string): string {
  const d = (e as { data?: { error?: unknown; code?: unknown } } | null)?.data;
  if (d && typeof d.error === 'string') return typeof d.code === 'string' ? `${d.error} (${d.code})` : d.error;
  return fallback;
}

function fantasyAccessDenied(e: unknown): boolean {
  const code = (e as { data?: { code?: unknown } } | null)?.data?.code;
  return typeof code === 'string' && FANTASY_ACCESS_ERRORS.has(code);
}

function isYahooAuthUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && u.host === 'api.login.yahoo.com' && u.pathname === '/oauth2/request_auth';
  } catch {
    return false;
  }
}

function inFrame(): boolean {
  try { return window.top !== window.self; } catch { return true; }
}

function originOf(uri: string | null): string | null {
  if (!uri) return null;
  try { return new URL(uri).origin; } catch { return null; }
}

export function YahooConnection() {
  const qc = useQueryClient();
  const [cb] = useState<CallbackResult>(readCallback);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(cleanUrl, []);

  const status = useGetYahooStatus({ query: { queryKey: getGetYahooStatusQueryKey(), refetchOnWindowFocus: true } });
  const s = status.data;
  const connected = !!s?.connected;
  const leagues = useGetYahooLeagues({ query: { queryKey: getGetYahooLeaguesQueryKey(), enabled: connected, retry: false } });
  const start = useStartYahooAuthorization();
  const disc = useDisconnectYahoo();

  const framed = inFrame();
  const redirectOrigin = originOf(s?.redirectUri ?? null);
  const mismatch = !!redirectOrigin && redirectOrigin !== window.location.origin;
  const appLink = redirectOrigin ? `${redirectOrigin}${import.meta.env.BASE_URL}settings` : null;
  const blocked = framed || mismatch;

  const connect = async () => {
    setActionErr(null);
    setDone(null);
    if (!s?.csrfToken) return setActionErr('No session token is available. Reload and try again.');
    try {
      const r = await start.mutateAsync({ data: { csrfToken: s.csrfToken } });
      if (!isYahooAuthUrl(r.authorizationUrl)) return setActionErr('The server returned an unexpected sign-in address, so navigation was refused.');
      window.open(r.authorizationUrl, '_top');
    } catch (e) {
      setActionErr(safeErr(e, 'Could not start Yahoo authorization.'));
    }
  };

  const disconnect = async () => {
    setActionErr(null);
    if (!s?.csrfToken) return setActionErr('No session token is available. Reload and try again.');
    try {
      await disc.mutateAsync({ data: { csrfToken: s.csrfToken } });
      await qc.cancelQueries({ queryKey: getGetYahooLeaguesQueryKey() });
      qc.setQueryData(getGetYahooStatusQueryKey(), { ...s, connected: false, connectedAt: null, csrfToken: null });
      qc.removeQueries({ queryKey: getGetYahooLeaguesQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetYahooStatusQueryKey() });
      setDone('Saved Yahoo connection deleted from this app.');
    } catch (e) {
      setActionErr(safeErr(e, 'Could not disconnect.'));
    }
  };

  const busy = start.isPending || disc.isPending;
  const t = 'text-xs leading-relaxed text-muted-foreground';

  let body;
  if (status.isLoading) {
    body = <div className="space-y-2" data-testid="yahoo-loading" aria-busy><div className="h-4 w-1/2 animate-pulse rounded bg-muted" /><div className="h-3 w-3/4 animate-pulse rounded bg-muted" /></div>;
  } else if (status.isError || !s) {
    body = (
      <div className="space-y-2">
        <Notice tone="error" testId="text-yahoo-error">Could not read Yahoo connection status: {safeErr(status.error, 'the server did not respond.')}</Notice>
        <button className={btn.ghost} onClick={() => status.refetch()} data-testid="button-yahoo-retry"><RefreshCw className="h-4 w-4" />Retry</button>
      </div>
    );
  } else if (!s.configured) {
    body = (
      <div className="space-y-3">
        <p className="text-sm" data-testid="text-yahoo-status"><strong>Setup required.</strong> Complete the published callback and Yahoo application credentials before connecting.</p>
        {s.missingConfig.length > 0 && (
          <p className="text-sm">Missing: {s.missingConfig.map((m) => <code key={m} className="mr-1.5 break-all rounded bg-muted px-1 font-mono text-xs">{m}</code>)}</p>
        )}
        <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>Export a draft backup before switching URLs, then publish this app to get a stable URL. Restore the backup in the published app: draft storage is separate for each site.</li>
          <li>Create a Yahoo Web Application at <a className="break-all underline" href="https://developer.yahoo.com/apps/create/" target="_blank" rel="noreferrer">developer.yahoo.com/apps/create</a> with Fantasy Sports read access (private data).</li>
          <li>Set the redirect URI to your published origin followed by <code className="break-all font-mono text-xs">/api/yahoo/callback</code>. It must match exactly, as <code className="font-mono text-xs">YAHOO_REDIRECT_URI</code>.</li>
          <li>Add <code className="font-mono text-xs">YAHOO_CLIENT_ID</code> and <code className="font-mono text-xs">YAHOO_CLIENT_SECRET</code> in Replit Secrets. <code className="font-mono text-xs">SESSION_SECRET</code> is already available.</li>
        </ol>
        {s.redirectUri && <p className={t}>Server redirect URI: <code className="break-all font-mono">{s.redirectUri}</code></p>}
        <p className={t}>This uses your own Yahoo application, not the Replit managed connector.</p>
        <button className={btn.ghost} onClick={() => status.refetch()} disabled={status.isFetching} data-testid="button-yahoo-recheck"><RefreshCw className="h-4 w-4" />Check again</button>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        <p className="text-sm" data-testid="text-yahoo-status">
          {connected ? <><strong>Connected to Yahoo.</strong>{s.connectedAt && <span className="text-muted-foreground"> Since {new Date(s.connectedAt).toLocaleString()}.</span>}</> : <><strong>Not connected.</strong> Manual mode: you record each pick yourself.</>}
        </p>
        {s.redirectUri && <p className={t}>Redirect URI: <code className="break-all font-mono">{s.redirectUri}</code></p>}

        {framed && (
          <Notice tone="warn" testId="text-yahoo-iframe">
            This app is inside a preview frame, and Yahoo sign-in cannot complete here. Export a draft backup before switching URLs, then open the published app in a normal browser tab and restore it there.
            {appLink && <> <a className="break-all underline" href={appLink} target="_blank" rel="noreferrer" data-testid="link-yahoo-published">Open published app<ExternalLink className="ml-1 inline h-3 w-3" /></a></>}
          </Notice>
        )}
        {!framed && mismatch && (
          <Notice tone="warn" testId="text-yahoo-origin">
            You are on a different site than the Yahoo redirect URI ({redirectOrigin}). Export a draft backup before switching, then open the published app outside the preview and restore it there.
            {appLink && <> <a className="break-all underline" href={appLink} target="_blank" rel="noreferrer" data-testid="link-yahoo-published">Open published app<ExternalLink className="ml-1 inline h-3 w-3" /></a></>}
          </Notice>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button className={btn.primary} onClick={connect} disabled={busy || blocked || !s.csrfToken} data-testid="button-yahoo-connect">
            {start.isPending ? 'Opening Yahoo...' : connected ? 'Reconnect' : 'Connect Yahoo'}
          </button>
          {connected && <ConfirmButton testId="button-yahoo-disconnect" label="Disconnect" confirmLabel="Yes, disconnect" disabled={busy || blocked || !s.csrfToken} onConfirm={disconnect} />}
        </div>

        {connected && (
          <div className="border-t pt-3" data-testid="yahoo-leagues">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Read verification: NBA leagues</span>
              <button className={btn.ghost} onClick={() => leagues.refetch()} disabled={leagues.isFetching} data-testid="button-yahoo-leagues-refresh"><RefreshCw className="h-4 w-4" />Verify again</button>
            </div>
            {leagues.isLoading ? (
              <div className="space-y-2" aria-busy><div className="h-10 animate-pulse rounded bg-muted" /><div className="h-10 animate-pulse rounded bg-muted" /></div>
            ) : leagues.isError ? (
              <Notice tone="error" testId="text-yahoo-leagues-error">
                Yahoo league read failed: {safeErr(leagues.error, 'request failed.')}
                {fantasyAccessDenied(leagues.error)
                  ? ' Your saved connection is still present. Check Yahoo application access before repeatedly reconnecting, then use Verify again.'
                  : ' Try again, or reconnect if access was revoked.'}
              </Notice>
            ) : leagues.data && leagues.data.leagues.length === 0 ? (
              <Notice tone="info" testId="text-yahoo-leagues-empty">Yahoo accepted the connection but returned no NBA leagues for this account. Nothing is being made up; check that you joined a league on this Yahoo account.</Notice>
            ) : (
              <>
                <ul className="space-y-1.5">
                  {leagues.data?.leagues.map((l) => (
                    <li key={l.key} className="min-w-0 rounded-md border bg-background px-3 py-2 text-sm" data-testid={`row-yahoo-league-${l.key}`}>
                      <div className="break-words font-semibold">{l.name}</div>
                      <div className="break-words text-xs text-muted-foreground">Season {l.season} / {l.teamCount} teams / {l.scoringType} / draft: {l.draftStatus}</div>
                    </li>
                  ))}
                </ul>
                {leagues.data && <p className={`mt-1.5 ${t}`}>Fetched from Yahoo {new Date(leagues.data.checkedAt).toLocaleString()}.</p>}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Panel title="Yahoo connection">
      <div className="space-y-3">
        {cb && (!cb.ok || s) && <Notice tone={cb.ok && connected ? 'ok' : 'error'} testId="text-yahoo-callback">
          {cb.ok && !connected ? 'Yahoo returned to the app, but no saved connection is available in this browser. Open the published app in a normal tab and connect again.' : cb.text}
        </Notice>}
        {done && <Notice tone="ok" testId="text-yahoo-disconnected">{done}</Notice>}
        {actionErr && <Notice tone="error" testId="text-yahoo-action-error">{actionErr}</Notice>}
        {body}
        <div className={`border-t pt-3 ${t} space-y-1`}>
          <p><strong>This connection supports:</strong> Yahoo authorization and NBA league reads, to be verified with your account after setup. <strong>Not yet implemented or verified:</strong> automatic pick sync and live draft-result freshness. Keep recording picks yourself.</p>
          <p>Disconnect deletes the saved connection from this app only. It does not change your picks or projections and does not revoke permission at Yahoo. To revoke there, review the app permissions in your Yahoo account settings.</p>
        </div>
      </div>
    </Panel>
  );
}

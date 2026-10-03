import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import { db, pool, yahooSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  csrfTokenFor, decryptTokens, encryptTokens, hashOpaqueValue, inspectYahooConfig,
  randomOpaqueValue, SESSION_COOKIE, validateRedirectUri, YahooConnectionError,
  type YahooConfig, type YahooTokens,
} from "../src/lib/yahoo-security";
import { authorizationUrl, exchangeYahooTokens, fetchYahooLeagues, parseYahooLeagues } from "../src/lib/yahoo-provider";
import { consumeYahooState, deleteYahooSession, readYahooSession, startYahooSession } from "../src/lib/yahoo-store";
import { createYahooRouter } from "../src/routes/yahoo";

// Explicitly synthetic fixtures; never use real Yahoo credentials or contact
// Yahoo. Database tests create only randomly identified, short-lived test rows.
const secret = "synthetic-test-key-never-a-real-credential";
const config: YahooConfig = {
  clientId: "synthetic-client", clientSecret: "synthetic-client-secret",
  sessionSecret: secret, origin: "https://draft.example.test",
  redirectUri: "https://draft.example.test/api/yahoo/callback",
};
const tokens: YahooTokens = {
  accessToken: "synthetic-access-token", refreshToken: "synthetic-refresh-token",
  expiresAt: Date.now() + 3600_000,
};
const rowsToDelete = new Set<string>();
after(async () => {
  for (const id of rowsToDelete) await deleteYahooSession(id);
  await pool.end();
});

test("configuration rejects development, unsafe, malformed or non-exact callback URLs", () => {
  const incomplete = inspectYahooConfig({});
  assert.equal(incomplete.config, null);
  assert.ok(incomplete.missingConfig.includes("YAHOO_CLIENT_ID"));
  for (const url of [
    "http://draft.example.test/api/yahoo/callback",
    "https://someone.replit.dev/api/yahoo/callback",
    "https://user:password@draft.example.test/api/yahoo/callback",
    "https://draft.example.test/api/yahoo/callback?next=evil",
    "https://draft.example.test/api/yahoo/callback#fragment",
    "https://draft.example.test/api/yahoo/callback/",
    "https://localhost/api/yahoo/callback",
  ]) assert.equal(validateRedirectUri(url), null);
  assert.equal(validateRedirectUri(config.redirectUri)?.origin, config.origin);
});

test("tokens are encrypted, authenticated and purpose-separated from CSRF", () => {
  const encrypted = encryptTokens(tokens, secret);
  assert.ok(!encrypted.includes(tokens.accessToken));
  assert.ok(!encrypted.includes(tokens.refreshToken));
  assert.deepEqual(decryptTokens(encrypted, secret), tokens);
  assert.notEqual(encrypted, encryptTokens(tokens, secret));
  assert.throws(() => decryptTokens(encrypted, "different-synthetic-key"), YahooConnectionError);
  const parts = encrypted.split(".");
  parts[3] = (parts[3]![0] === "a" ? "b" : "a") + parts[3]!.slice(1);
  assert.throws(() => decryptTokens(parts.join("."), secret), YahooConnectionError);
  assert.notEqual(csrfTokenFor(randomOpaqueValue(), secret), csrfTokenFor(randomOpaqueValue(), secret));
});

test("authorization uses fixed Yahoo endpoints, exact callback, and Fantasy read scope", () => {
  const state = randomOpaqueValue();
  const url = new URL(authorizationUrl(config, state));
  assert.equal(url.origin, "https://api.login.yahoo.com");
  assert.equal(url.pathname, "/oauth2/request_auth");
  assert.equal(url.searchParams.get("scope"), "fspt-r");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("state"), state);
  assert.ok(!url.href.includes(config.clientSecret));
});

test("provider exchanges and refresh rotation remain server-side and sanitize errors", async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://api.login.yahoo.com/oauth2/get_token");
    assert.equal(init?.redirect, "error");
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("redirect_url"), null);
    assert.ok(init?.signal);
    if (form.get("grant_type") === "authorization_code") {
      assert.equal(form.get("redirect_uri"), config.redirectUri);
      return Response.json({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken, token_type: "bearer", expires_in: 3600 });
    }
    assert.equal(form.get("refresh_token"), tokens.refreshToken);
    return Response.json({ access_token: "synthetic-rotated-access", refresh_token: "synthetic-rotated-refresh", expires_in: 3600 });
  };
  const initial = await exchangeYahooTokens(config, { code: "synthetic-code" }, fetcher);
  assert.equal(initial.accessToken, tokens.accessToken);
  const refreshed = await exchangeYahooTokens(config, { refreshToken: tokens.refreshToken }, fetcher);
  assert.equal(refreshed.refreshToken, "synthetic-rotated-refresh");
  const withoutRotation = await exchangeYahooTokens(config, { refreshToken: tokens.refreshToken }, async () =>
    Response.json({ access_token: "synthetic-next-access", expires_in: 3600 }));
  assert.equal(withoutRotation.refreshToken, tokens.refreshToken);
  await assert.rejects(exchangeYahooTokens(config, { code: "synthetic-code" }, async () =>
    Response.json({ error: "invalid_client", error_description: "must-never-leak" }, { status: 401 })),
  (error: unknown) => error instanceof YahooConnectionError && error.code === "invalid_client" && !error.message.includes("must-never-leak"));
  await assert.rejects(exchangeYahooTokens(config, { code: "synthetic-code" }, async () =>
    Response.json({ access_token: "incomplete", expires_in: 3600 })), YahooConnectionError);
});

const leagueFixture = {
  fantasy_content: { users: { "0": { user: [
    [{ guid: "synthetic" }],
    { games: { "0": { game: [
      { code: "nba", season: "2026" },
      { leagues: { "0": { league: [{ league_key: "synthetic.l.1", name: "Synthetic NBA League", season: "2026", num_teams: 12, scoring_type: "head", draft_status: "predraft" }] }, count: 1 } },
    ] }, count: 1 } },
  ] }, count: 1 } },
};

test("NBA reads parse Yahoo numbered JSON and distinguish empty from malformed or denied", async () => {
  assert.deepEqual(parseYahooLeagues(leagueFixture), [{
    key: "synthetic.l.1", name: "Synthetic NBA League", season: "2026",
    teamCount: 12, scoringType: "head", draftStatus: "predraft",
  }]);
  assert.deepEqual(parseYahooLeagues({ fantasy_content: { users: { count: 0 } } }), []);
  assert.throws(() => parseYahooLeagues({ error: "not league data" }), YahooConnectionError);
  const leagues = await fetchYahooLeagues(tokens.accessToken, async (url, init) => {
    assert.ok(String(url).startsWith("https://fantasysports.yahooapis.com/"));
    assert.ok(String(url).includes("game_codes=nba"));
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${tokens.accessToken}`);
    return Response.json(leagueFixture);
  });
  assert.equal(leagues.length, 1);
  await assert.rejects(fetchYahooLeagues(tokens.accessToken, async () => new Response("", { status: 403 })),
    (error: unknown) => error instanceof YahooConnectionError && error.code === "fantasy_read_denied");
});

test("Fantasy denials classify app access, additional authorization and scope without leaking provider data", async () => {
  const cases = [
    { status: 403, body: { error: { description: "This application is not authorized to perform this action. must-never-leak" } }, code: "fantasy_app_not_authorized" },
    { status: 401, body: { error: { description: 'OAuth oauth_problem="additional_authorization_required", realm="yahooapis.com" must-never-leak' } }, code: "fantasy_additional_authorization_required" },
    { status: 403, body: { error: "additional_authorization_required", error_description: "must-never-leak" }, code: "fantasy_additional_authorization_required" },
    { status: 403, body: { error: { code: "insufficient_scope", description: "must-never-leak" } }, code: "fantasy_scope_denied" },
    { status: 401, body: { error: "invalid_scope" }, code: "fantasy_scope_denied" },
    { status: 401, body: { error: { description: 'OAuth oauth_problem="token_rejected" must-never-leak' } }, code: "access_expired" },
    { status: 403, body: { error: { description: "Unclassified refusal must-never-leak" } }, code: "fantasy_read_denied" },
  ];
  for (const fixture of cases) {
    await assert.rejects(fetchYahooLeagues(tokens.accessToken, async () => Response.json(fixture.body, { status: fixture.status })),
      (error: unknown) => {
        assert.ok(error instanceof YahooConnectionError);
        assert.equal(error.code, fixture.code);
        assert.ok(!error.message.includes("must-never-leak"));
        assert.ok(!error.message.includes(tokens.accessToken));
        if (fixture.code === "access_expired") assert.equal(error.status, 401);
        else assert.ok(error.message.includes(`HTTP ${fixture.status}`));
        return true;
      });
  }
  for (const body of ["<html>must-never-leak</html>", JSON.stringify({ error: { description: "must-never-leak" } })]) {
    await assert.rejects(fetchYahooLeagues(tokens.accessToken, async () => new Response(body, { status: 403 })),
      (error: unknown) => error instanceof YahooConnectionError &&
        error.code === "fantasy_read_denied" && !error.message.includes("must-never-leak"));
  }
});

test("database state is browser-bound, expiring and atomically single-use", async () => {
  const id = hashOpaqueValue(randomOpaqueValue());
  const otherId = hashOpaqueValue(randomOpaqueValue());
  const state = hashOpaqueValue(randomOpaqueValue());
  rowsToDelete.add(id);
  await startYahooSession(id, state, config.redirectUri);
  assert.equal(await consumeYahooState(otherId, state, config.redirectUri), false);
  assert.equal(await consumeYahooState(id, state, "https://other.example.test/api/yahoo/callback"), false);
  const attempts = await Promise.all([
    consumeYahooState(id, state, config.redirectUri),
    consumeYahooState(id, state, config.redirectUri),
  ]);
  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal(await consumeYahooState(id, state, config.redirectUri), false);
  await startYahooSession(id, state, config.redirectUri);
  await db.update(yahooSessionsTable).set({ pendingStateExpiresAt: new Date(Date.now() - 60_000) })
    .where(eq(yahooSessionsTable.idHash, id));
  assert.equal(await consumeYahooState(id, state, config.redirectUri), false);
  await deleteYahooSession(id);
});

test("HTTP flow rejects cross-site actions, protects callback, exposes no tokens and deletes connection", async () => {
  const application = express();
  application.use(express.json());
  application.use("/api", createYahooRouter(
    () => ({ config, missingConfig: [], redirectUri: config.redirectUri }),
    async () => tokens,
  ));
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/yahoo`;
  try {
    const statusResponse = await fetch(`${base}/status`);
    assert.equal(statusResponse.headers.get("cache-control"), "no-store");
    const cookieHeader = statusResponse.headers.get("set-cookie")!;
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /Secure/);
    assert.match(cookieHeader, /SameSite=Lax/);
    const cookie = cookieHeader.split(";")[0]!;
    const id = cookie.slice(`${SESSION_COOKIE}=`.length);
    const idHash = hashOpaqueValue(id);
    rowsToDelete.add(idHash);
    const status = await statusResponse.json();
    assert.equal(status.connected, false);
    assert.equal(await readYahooSession(idHash), undefined);
    const repeatedStatus = await fetch(`${base}/status`, { headers: { Cookie: cookie } });
    assert.equal(repeatedStatus.headers.get("set-cookie"), null);
    assert.equal((await repeatedStatus.json()).csrfToken, status.csrfToken);
    const headers = { Cookie: cookie, Origin: config.origin, "Content-Type": "application/json" };
    const body = JSON.stringify({ csrfToken: status.csrfToken });
    const forbidden = await fetch(`${base}/start`, { method: "POST", headers: { ...headers, Origin: "https://untrusted.example.test" }, body });
    assert.equal(forbidden.status, 403);
    assert.equal(await readYahooSession(idHash), undefined);
    const invalidCsrf = await fetch(`${base}/start`, { method: "POST", headers, body: JSON.stringify({ csrfToken: "invalid" }) });
    assert.equal(invalidCsrf.status, 403);
    const start = await fetch(`${base}/start`, { method: "POST", headers, body });
    assert.equal(start.status, 200);
    const state = new URL((await start.json()).authorizationUrl).searchParams.get("state")!;
    const stranger = await fetch(`${base}/callback?state=${state}&code=synthetic`, { redirect: "manual" });
    assert.equal(stranger.headers.get("location"), `${config.origin}/settings?yahoo_error=state_invalid`);
    const callback = await fetch(`${base}/callback?state=${state}&code=synthetic`, { headers: { Cookie: cookie }, redirect: "manual" });
    assert.equal(callback.headers.get("location"), `${config.origin}/settings?yahoo=connected`);
    assert.equal(callback.headers.get("referrer-policy"), "no-referrer");
    const stored = await readYahooSession(idHash);
    assert.ok(stored?.encryptedTokens);
    assert.ok(!stored.encryptedTokens.includes(tokens.accessToken));
    const publicStatus = await (await fetch(`${base}/status`, { headers: { Cookie: cookie } })).json();
    assert.equal(publicStatus.connected, true);
    assert.ok(!JSON.stringify(publicStatus).includes(tokens.accessToken));
    assert.ok(!JSON.stringify(publicStatus).includes(tokens.refreshToken));
    const replay = await fetch(`${base}/callback?state=${state}&code=synthetic`, { headers: { Cookie: cookie }, redirect: "manual" });
    assert.equal(replay.headers.get("location"), `${config.origin}/settings?yahoo_error=state_invalid`);
    const unconnected = await fetch(`${base}/leagues`);
    assert.equal(unconnected.status, 401);
    const badDisconnect = await fetch(`${base}/connection`, { method: "DELETE", headers: { ...headers, Origin: "https://untrusted.example.test" }, body });
    assert.equal(badDisconnect.status, 403);
    assert.ok((await readYahooSession(idHash))?.encryptedTokens);
    const disconnect = await fetch(`${base}/connection`, { method: "DELETE", headers, body });
    assert.equal(disconnect.status, 200);
    assert.equal(await readYahooSession(idHash), undefined);
    assert.equal((await (await fetch(`${base}/status`, { headers: { Cookie: cookie } })).json()).connected, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
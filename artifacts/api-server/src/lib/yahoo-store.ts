import { db, yahooSessionsTable, type YahooSession } from "@workspace/db";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import {
  decryptTokens, encryptTokens, SESSION_LIFETIME_MS, STATE_LIFETIME_MS,
  YahooConnectionError, type YahooConfig, type YahooTokens,
} from "./yahoo-security";
import { exchangeYahooTokens, fetchYahooLeagues } from "./yahoo-provider";

function activeSession(idHash: string) {
  return and(eq(yahooSessionsTable.idHash, idHash), gt(yahooSessionsTable.expiresAt, new Date()));
}

export async function readYahooSession(idHash: string): Promise<YahooSession | undefined> {
  const [session] = await db.select().from(yahooSessionsTable).where(activeSession(idHash));
  return session;
}

export async function startYahooSession(idHash: string, stateHash: string, redirectUri: string): Promise<void> {
  const now = new Date();
  // Expired credentials are removed when a new authorization starts.
  await db.delete(yahooSessionsTable).where(lt(yahooSessionsTable.expiresAt, now));
  const pending = {
    pendingStateHash: stateHash,
    pendingStateExpiresAt: new Date(now.getTime() + STATE_LIFETIME_MS),
    pendingRedirectUri: redirectUri,
    expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
  };
  await db.insert(yahooSessionsTable).values({ idHash, ...pending })
    .onConflictDoUpdate({ target: yahooSessionsTable.idHash, set: pending });
}

// An atomic, browser-bound consume prevents state replay and parallel callback
// races. Invalid callbacks cannot clear another browser's pending state.
export async function consumeYahooState(idHash: string, stateHash: string, redirectUri: string): Promise<boolean> {
  const rows = await db.update(yahooSessionsTable).set({
    pendingStateHash: null, pendingStateExpiresAt: null, pendingRedirectUri: null,
  }).where(and(
    activeSession(idHash),
    eq(yahooSessionsTable.pendingStateHash, stateHash),
    eq(yahooSessionsTable.pendingRedirectUri, redirectUri),
    gt(yahooSessionsTable.pendingStateExpiresAt, new Date()),
  )).returning({ idHash: yahooSessionsTable.idHash });
  return rows.length === 1;
}

export async function saveYahooTokens(idHash: string, tokens: YahooTokens, secret: string): Promise<boolean> {
  const rows = await db.update(yahooSessionsTable).set({
    encryptedTokens: encryptTokens(tokens, secret),
    connectedAt: new Date(),
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
  }).where(and(activeSession(idHash), isNull(yahooSessionsTable.pendingStateHash)))
    .returning({ idHash: yahooSessionsTable.idHash });
  return rows.length === 1;
}

export async function deleteYahooSession(idHash: string): Promise<void> {
  await db.delete(yahooSessionsTable).where(eq(yahooSessionsTable.idHash, idHash));
}

export async function purgeExpiredYahooSessions(): Promise<void> {
  await db.delete(yahooSessionsTable).where(lt(yahooSessionsTable.expiresAt, new Date()));
}

async function currentTokens(idHash: string, config: YahooConfig, rejectedAccessToken?: string): Promise<YahooTokens> {
  // Lock the row across refresh: rotated refresh tokens must never be consumed
  // concurrently, including by different server instances.
  const result = await db.transaction(async (tx) => {
    const [session] = await tx.select().from(yahooSessionsTable).where(activeSession(idHash)).for("update");
    if (!session?.encryptedTokens) {
      return new YahooConnectionError("not_connected", "Connect Yahoo before checking leagues.", 401);
    }
    let tokens: YahooTokens;
    try {
      tokens = decryptTokens(session.encryptedTokens, config.sessionSecret);
    } catch {
      await tx.update(yahooSessionsTable).set({ encryptedTokens: null, connectedAt: null }).where(activeSession(idHash));
      return new YahooConnectionError("connection_unreadable", "The saved Yahoo connection cannot be read. Connect again.", 401);
    }
    if (tokens.expiresAt > Date.now() + 60_000 && tokens.accessToken !== rejectedAccessToken) return tokens;
    try {
      const refreshed = await exchangeYahooTokens(config, { refreshToken: tokens.refreshToken });
      await tx.update(yahooSessionsTable).set({
        encryptedTokens: encryptTokens(refreshed, config.sessionSecret),
      }).where(activeSession(idHash));
      return refreshed;
    } catch (error) {
      if (error instanceof YahooConnectionError && error.code === "invalid_grant") {
        await tx.update(yahooSessionsTable).set({ encryptedTokens: null, connectedAt: null }).where(activeSession(idHash));
        // Return then throw outside transaction so revocation persists.
        return error;
      }
      throw error;
    }
  });
  if (result instanceof YahooConnectionError) throw result;
  return result;
}

export async function readConnectedYahooLeagues(idHash: string, config: YahooConfig) {
  const tokens = await currentTokens(idHash, config);
  try {
    return await fetchYahooLeagues(tokens.accessToken);
  } catch (error) {
    if (!(error instanceof YahooConnectionError) || error.code !== "access_expired") throw error;
    const refreshed = await currentTokens(idHash, config, tokens.accessToken);
    return fetchYahooLeagues(refreshed.accessToken);
  }
}
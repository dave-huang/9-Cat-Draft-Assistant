import { Router, type IRouter, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import {
  GetYahooStatusResponse, StartYahooAuthorizationBody, StartYahooAuthorizationResponse,
  DisconnectYahooBody, DisconnectYahooResponse, GetYahooLeaguesResponse,
} from "@workspace/api-zod";
import {
  csrfTokenFor, hashOpaqueValue, inspectYahooConfig, isOpaqueValue, randomOpaqueValue, safeEqual,
  SESSION_COOKIE, SESSION_LIFETIME_MS, YahooConnectionError, type YahooConfig,
} from "../lib/yahoo-security";
import { authorizationUrl, exchangeYahooTokens } from "../lib/yahoo-provider";
import {
  consumeYahooState, deleteYahooSession, readConnectedYahooLeagues,
  readYahooSession, saveYahooTokens, startYahooSession,
} from "../lib/yahoo-store";

const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };

function sessionId(req: Request): string | null {
  const value: unknown = req.cookies?.[SESSION_COOKIE];
  return isOpaqueValue(value) ? value : null;
}

function requireConfig(readConfig: typeof inspectYahooConfig): YahooConfig {
  const { config } = readConfig();
  if (!config) throw new YahooConnectionError("not_configured", "Set up the published Yahoo application and required Secrets before connecting.", 503);
  return config;
}

function requireConsent(req: Request, config: YahooConfig): string {
  // Never trust Host/forwarded headers for OAuth or mutation origins.
  if (req.get("origin") !== config.origin) {
    throw new YahooConnectionError("origin_mismatch", "Open the published app in its own browser tab before connecting or disconnecting Yahoo.", 403);
  }
  const parsed = (req.method === "DELETE" ? DisconnectYahooBody : StartYahooAuthorizationBody).safeParse(req.body);
  if (!parsed.success) throw new YahooConnectionError("invalid_request", "The authorization request is incomplete. Reload Settings and try again.", 400);
  const id = sessionId(req);
  if (!id || !safeEqual(parsed.data.csrfToken, csrfTokenFor(id, config.sessionSecret))) {
    throw new YahooConnectionError("session_invalid", "Your browser session is missing or expired. Open the published app in a browser tab, reload Settings and try again.", 403);
  }
  return id;
}

function sendSafeError(res: Response, error: unknown) {
  if (error instanceof YahooConnectionError) {
    res.status(error.status).json({ code: error.code, error: error.message });
  } else {
    // Do not serialize upstream errors: they can embed credentials or codes.
    res.status(503).json({ code: "storage_unavailable", error: "The Yahoo connection service is unavailable. Try again; manual drafting still works." });
  }
}

function appResult(config: YahooConfig, errorCode?: string): string {
  const url = new URL("/settings", config.origin);
  url.searchParams.set(errorCode ? "yahoo_error" : "yahoo", errorCode ?? "connected");
  return url.href;
}

// Bounded in-process budget supplements browser-bound state/CSRF protection.
// No forwarded IPs are trusted; proxied users share a generous upstream budget.
const attempts = new Map<string, { count: number; until: number }>();
function checkStartBudget(req: Request) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
  const key = req.socket.remoteAddress ?? "unknown";
  const entry = attempts.get(key) ?? { count: 0, until: now + 10 * 60 * 1000 };
  if (entry.count >= 100 || (attempts.size >= 1024 && !attempts.has(key))) {
    throw new YahooConnectionError("rate_limited", "Too many connection attempts. Wait a few minutes before trying again.", 429);
  }
  entry.count++;
  attempts.set(key, entry);
}

// Dependencies allow isolated tests with synthetic credentials and a fake
// provider; the real server always uses environment-backed configuration.
export function createYahooRouter(
  readConfig: typeof inspectYahooConfig = inspectYahooConfig,
  exchange: typeof exchangeYahooTokens = exchangeYahooTokens,
): IRouter {
const router: IRouter = Router();

router.use("/yahoo", cookieParser(), (_req, res, next) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  next();
});

router.get("/yahoo/status", async (req, res) => {
  try {
    const { config, missingConfig, redirectUri } = readConfig();
    if (!config) {
      res.json(GetYahooStatusResponse.parse({ configured: false, connected: false, missingConfig, redirectUri, connectedAt: null, csrfToken: null }));
      return;
    }
    let id = sessionId(req);
    const session = id ? await readYahooSession(hashOpaqueValue(id)) : undefined;
    // Only explicit authorization creates a database row. Status establishes
    // an opaque browser cookie and CSRF token without storing anonymous visits.
    if (!id) {
      id = randomOpaqueValue();
      res.cookie(SESSION_COOKIE, id, { ...cookieOptions, maxAge: SESSION_LIFETIME_MS });
    }
    res.json(GetYahooStatusResponse.parse({
      configured: true, connected: !!session?.encryptedTokens, missingConfig: [], redirectUri,
      connectedAt: session?.connectedAt?.toISOString() ?? null,
      csrfToken: csrfTokenFor(id, config.sessionSecret),
    }));
  } catch (error) { sendSafeError(res, error); }
});

router.post("/yahoo/start", async (req, res) => {
  try {
    const config = requireConfig(readConfig);
    const id = requireConsent(req, config);
    checkStartBudget(req);
    const state = randomOpaqueValue();
    await startYahooSession(hashOpaqueValue(id), hashOpaqueValue(state), config.redirectUri);
    res.cookie(SESSION_COOKIE, id, { ...cookieOptions, maxAge: SESSION_LIFETIME_MS });
    res.json(StartYahooAuthorizationResponse.parse({ authorizationUrl: authorizationUrl(config, state) }));
  } catch (error) { sendSafeError(res, error); }
});

router.get("/yahoo/callback", async (req, res) => {
  try {
    const config = requireConfig(readConfig);
    const id = sessionId(req);
    const state = req.query.state;
    if (!id || !isOpaqueValue(state) ||
        !await consumeYahooState(hashOpaqueValue(id), hashOpaqueValue(state), config.redirectUri)) {
      res.redirect(302, appResult(config, "state_invalid"));
      return;
    }
    if (req.query.error) {
      res.redirect(302, appResult(config, req.query.error === "access_denied" ? "denied" : "token_failed"));
      return;
    }
    if (typeof req.query.code !== "string" || !req.query.code || req.query.code.length > 4096) {
      res.redirect(302, appResult(config, "token_failed"));
      return;
    }
    try {
      const tokens = await exchange(config, { code: req.query.code });
      if (!await saveYahooTokens(hashOpaqueValue(id), tokens, config.sessionSecret)) {
        res.redirect(302, appResult(config, "state_invalid"));
        return;
      }
      res.cookie(SESSION_COOKIE, id, { ...cookieOptions, maxAge: SESSION_LIFETIME_MS });
      res.redirect(302, appResult(config));
    } catch (error) {
      const allowed = new Set(["invalid_client", "invalid_grant", "invalid_scope", "provider_unavailable"]);
      const code = error instanceof YahooConnectionError && allowed.has(error.code) ? error.code : "token_failed";
      res.redirect(302, appResult(config, code));
    }
  } catch (error) { sendSafeError(res, error); }
});

router.delete("/yahoo/connection", async (req, res) => {
  try {
    const config = requireConfig(readConfig);
    const id = requireConsent(req, config);
    await deleteYahooSession(hashOpaqueValue(id));
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.json(DisconnectYahooResponse.parse({ disconnected: true }));
  } catch (error) { sendSafeError(res, error); }
});

router.get("/yahoo/leagues", async (req, res) => {
  try {
    const config = requireConfig(readConfig);
    const id = sessionId(req);
    if (!id) throw new YahooConnectionError("not_connected", "Connect Yahoo before checking leagues.", 401);
    const leagues = await readConnectedYahooLeagues(hashOpaqueValue(id), config);
    res.json(GetYahooLeaguesResponse.parse({ leagues, checkedAt: new Date().toISOString() }));
  } catch (error) { sendSafeError(res, error); }
});

return router;
}

export default createYahooRouter();
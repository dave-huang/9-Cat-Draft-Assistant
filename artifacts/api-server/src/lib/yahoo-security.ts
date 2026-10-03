import {
  createCipheriv, createDecipheriv, createHash, createHmac,
  randomBytes, timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE = "__Host-draft_yahoo";
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const STATE_LIFETIME_MS = 10 * 60 * 1000;
export const AUTHORIZATION_URL = "https://api.login.yahoo.com/oauth2/request_auth";
export const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
export const LEAGUES_URL = "https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_codes=nba;is_available=1/leagues?format=json";

export interface YahooConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  origin: string;
  sessionSecret: string;
}

export interface YahooTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class YahooConnectionError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 502) {
    super(message);
    this.name = "YahooConnectionError";
  }
}

// Accept only an explicit HTTPS callback. Never derive it from Host,
// forwarded headers, the workspace domain, or an untrusted request.
export function validateRedirectUri(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        url.pathname !== "/api/yahoo/callback" || url.hostname === "localhost" ||
        url.hostname.endsWith(".replit.dev") || url.hostname.endsWith(".replit.internal") ||
        /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.includes(":")) return null;
    return url;
  } catch {
    return null;
  }
}

export function inspectYahooConfig(env: NodeJS.ProcessEnv = process.env) {
  const missingConfig: string[] = [];
  if (!env.YAHOO_CLIENT_ID?.trim()) missingConfig.push("YAHOO_CLIENT_ID");
  if (!env.YAHOO_CLIENT_SECRET?.trim()) missingConfig.push("YAHOO_CLIENT_SECRET");
  const redirect = validateRedirectUri(env.YAHOO_REDIRECT_URI);
  if (!redirect) missingConfig.push("YAHOO_REDIRECT_URI (published HTTPS callback)");
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) missingConfig.push("SESSION_SECRET (at least 32 characters)");
  const config: YahooConfig | null = missingConfig.length ? null : {
    clientId: env.YAHOO_CLIENT_ID!,
    clientSecret: env.YAHOO_CLIENT_SECRET!,
    sessionSecret: env.SESSION_SECRET!,
    redirectUri: redirect!.href,
    origin: redirect!.origin,
  };
  return { config, missingConfig, redirectUri: redirect?.href ?? null };
}

export function randomOpaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

export function isOpaqueValue(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function hashOpaqueValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function csrfTokenFor(sessionId: string, secret: string): string {
  return createHmac("sha256", secret).update(`draft-yahoo-csrf-v1:${sessionId}`).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function tokenKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("draft-yahoo-token-encryption-v1").digest();
}

export function encryptTokens(tokens: YahooTokens, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(secret), iv);
  cipher.setAAD(Buffer.from("draft-yahoo-tokens-v1"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptTokens(value: string, secret: string): YahooTokens {
  try {
    const [version, iv, tag, ciphertext, extra] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error("Invalid envelope");
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(secret), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from("draft-yahoo-tokens-v1"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const decoded: unknown = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final(),
    ]).toString("utf8"));
    if (!decoded || typeof decoded !== "object" ||
        !("accessToken" in decoded) || typeof decoded.accessToken !== "string" || !decoded.accessToken ||
        !("refreshToken" in decoded) || typeof decoded.refreshToken !== "string" || !decoded.refreshToken ||
        !("expiresAt" in decoded) || typeof decoded.expiresAt !== "number" || !Number.isFinite(decoded.expiresAt)) {
      throw new Error("Invalid token record");
    }
    return decoded as YahooTokens;
  } catch {
    throw new YahooConnectionError("connection_unreadable", "The saved Yahoo connection cannot be read. Disconnect and authorize again.", 401);
  }
}
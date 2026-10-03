import {
  AUTHORIZATION_URL, LEAGUES_URL, TOKEN_URL, YahooConnectionError,
  type YahooConfig, type YahooTokens,
} from "./yahoo-security";

type JsonObject = Record<string, unknown>;
function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function authorizationUrl(config: YahooConfig, state: string): string {
  const url = new URL(AUTHORIZATION_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "fspt-r");
  url.searchParams.set("state", state);
  return url.href;
}

// Limit provider response sizes and request duration. Provider text, tokens,
// authorization codes and error_description must never reach logs or clients.
async function readJson(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new Error("Response too large");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new YahooConnectionError("provider_response_invalid", "Yahoo returned an unexpected response. Try again.");
  } finally {
    reader.releaseLock();
  }
}

async function providerFetch(url: string, init: RequestInit, fetcher: typeof fetch): Promise<Response> {
  try {
    return await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new YahooConnectionError("provider_unavailable", "Yahoo could not be reached. Try again.");
  }
}

export async function exchangeYahooTokens(
  config: YahooConfig,
  grant: { code: string } | { refreshToken: string },
  fetcher: typeof fetch = fetch,
): Promise<YahooTokens> {
  const body = new URLSearchParams("code" in grant
    ? { grant_type: "authorization_code", code: grant.code, redirect_uri: config.redirectUri }
    : { grant_type: "refresh_token", refresh_token: grant.refreshToken });
  const response = await providerFetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  }, fetcher);
  const json = await readJson(response);
  if (!response.ok) {
    const code = isObject(json) && typeof json.error === "string" ? json.error : "";
    if (code === "invalid_client") throw new YahooConnectionError(code, "Yahoo rejected the application's credentials. Check the registered client ID and secret.");
    if (code === "invalid_grant") throw new YahooConnectionError(code, "The Yahoo authorization expired or was revoked. Connect again.", 401);
    if (code === "invalid_scope") throw new YahooConnectionError(code, "Enable Fantasy Sports Read access in the Yahoo application, then connect again.");
    throw new YahooConnectionError("token_failed", "Yahoo did not complete authorization. Check the application's callback and Fantasy Sports Read access.");
  }
  if (!isObject(json) || typeof json.access_token !== "string" || !json.access_token ||
      (json.token_type !== undefined && (typeof json.token_type !== "string" || json.token_type.toLowerCase() !== "bearer")) ||
      !Number.isFinite(Number(json.expires_in)) || Number(json.expires_in) <= 0) {
    throw new YahooConnectionError("provider_response_invalid", "Yahoo returned an incomplete authorization response.");
  }
  const refreshToken = typeof json.refresh_token === "string" && json.refresh_token
    ? json.refresh_token : "refreshToken" in grant ? grant.refreshToken : null;
  if (!refreshToken) throw new YahooConnectionError("provider_response_invalid", "Yahoo did not provide a refresh token. Authorize again.");
  return { accessToken: json.access_token, refreshToken, expiresAt: Date.now() + Number(json.expires_in) * 1000 };
}

export interface YahooLeague {
  key: string;
  name: string;
  season: string;
  draftStatus: string;
  teamCount: number;
  scoringType: string;
}

// Yahoo's JSON uses numbered object keys and nested property arrays rather
// than conventional arrays. Read actual league wrappers, not guessed seasons.
export function parseYahooLeagues(json: unknown): YahooLeague[] {
  if (!isObject(json) || !isObject(json.fantasy_content) || !isObject(json.fantasy_content.users)) {
    throw new YahooConnectionError("provider_response_invalid", "Yahoo did not return the expected NBA league data.");
  }
  const leagues = new Map<string, YahooLeague>();
  let visited = 0;
  function visit(value: unknown, depth = 0) {
    if (++visited > 50_000 || depth > 40) {
      throw new YahooConnectionError("provider_response_invalid", "Yahoo returned an unexpectedly large league response.");
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
    } else if (isObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (key === "league") {
          if (!Array.isArray(child)) throw new YahooConnectionError("provider_response_invalid", "Yahoo returned an unexpected league format.");
          const metadata: JsonObject = Object.assign({}, ...child.filter(isObject));
          if (typeof metadata.league_key !== "string" || typeof metadata.name !== "string") {
            throw new YahooConnectionError("provider_response_invalid", "Yahoo returned incomplete league details.");
          }
          leagues.set(metadata.league_key, {
            key: metadata.league_key, name: metadata.name,
            season: String(metadata.season ?? ""),
            draftStatus: typeof metadata.draft_status === "string" ? metadata.draft_status : "unknown",
            teamCount: Number.isSafeInteger(Number(metadata.num_teams)) ? Math.max(0, Number(metadata.num_teams)) : 0,
            scoringType: typeof metadata.scoring_type === "string" ? metadata.scoring_type : "unknown",
          });
        }
        visit(child, depth + 1);
      }
    }
  }
  visit(json.fantasy_content.users);
  return [...leagues.values()].sort((a, b) => b.season.localeCompare(a.season) || a.name.localeCompare(b.name));
}

async function fantasyAccessError(response: Response): Promise<YahooConnectionError> {
  // Inspect a bounded body only to select fixed, safe diagnostics. Never expose
  // or log provider descriptions, which can contain reflected credentials.
  let json: unknown;
  try { json = await readJson(response); } catch { json = null; }
  const error = isObject(json) ? json.error : null;
  const details = typeof error === "string" ? error :
    isObject(error) ? [error.description, error.code, error.error]
      .filter((value): value is string => typeof value === "string").join(" ") : "";

  if (/\bthis application is not authorized\b/i.test(details)) {
    return new YahooConnectionError("fantasy_app_not_authorized",
      `Yahoo Fantasy API returned HTTP ${response.status} and explicitly rejected this application's access. Sign-in succeeded, but Fantasy API access is not accepted. Confirm Yahoo's approval applies to the same registered app and Client ID; reconnecting alone may not resolve this.`);
  }
  if (/\badditional_authorization_required\b/i.test(details)) {
    return new YahooConnectionError("fantasy_additional_authorization_required",
      `Yahoo Fantasy API returned HTTP ${response.status} and requires additional Fantasy authorization. Successful sign-in is not sufficient. Confirm this application's Fantasy API access and reconnect after its permissions or provisioning are corrected.`);
  }
  if (/\b(?:insufficient_scope|invalid_scope)\b/i.test(details)) {
    return new YahooConnectionError("fantasy_scope_denied",
      `Yahoo Fantasy API returned HTTP ${response.status} and reported an insufficient permission scope. Confirm Fantasy Sports Read access for this application's Client ID, then reconnect after permissions are corrected.`);
  }
  if (response.status === 401) {
    return new YahooConnectionError("access_expired", "Yahoo requires renewed authorization.", 401);
  }
  return new YahooConnectionError("fantasy_read_denied",
    "Yahoo Fantasy API returned HTTP 403 (Forbidden). Sign-in succeeded, but NBA league access was refused. This response does not establish whether app provisioning, permissions or another Yahoo access restriction caused it. Confirm current Fantasy API access for this registered app.");
}

export async function fetchYahooLeagues(accessToken: string, fetcher: typeof fetch = fetch): Promise<YahooLeague[]> {
  const response = await providerFetch(LEAGUES_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  }, fetcher);
  if (response.status === 401 || response.status === 403) {
    throw await fantasyAccessError(response);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new YahooConnectionError("provider_unavailable", "Yahoo league data is temporarily unavailable. Try again.");
  }
  return parseYahooLeagues(await readJson(response));
}
import type { KickGrant } from "../domain/kick-grant";

type KickTokenSuccess = { readonly access_token: string; readonly token_type: string; readonly refresh_token?: string; readonly expires_in?: number; readonly scope?: string | string[] };
const ALLOWED_KICK_OAUTH_ERRORS = { access_denied: true, invalid_client: true, invalid_grant: true, invalid_request: true, invalid_scope: true, server_error: true, temporarily_unavailable: true, unauthorized_client: true, unsupported_grant_type: true } satisfies Record<string, true>;
type KickOAuthError = keyof typeof ALLOWED_KICK_OAUTH_ERRORS;
type KickUpstreamOutcome = { readonly kind: "token_success"; readonly status: number; readonly token: KickTokenSuccess } | { readonly kind: "oauth_failure"; readonly status: number; readonly error: KickOAuthError } | { readonly kind: "invalid_response" } | { readonly kind: "timeout" } | { readonly kind: "transport_failure" };

const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";
const KICK_TOKEN_TIMEOUT_MS = 10_000;

export async function exchangeKickGrant(grant: KickGrant, credentials: { readonly clientId: string; readonly clientSecret: string }): Promise<Response> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), KICK_TOKEN_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(KICK_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: createKickTokenForm(grant, credentials), signal: controller.signal });
    } catch { return mapKickUpstreamOutcome(controller.signal.aborted ? { kind: "timeout" } : { kind: "transport_failure" }); }
    let data: unknown;
    try { data = await response.json(); } catch { return mapKickUpstreamOutcome(controller.signal.aborted ? { kind: "timeout" } : { kind: "invalid_response" }); }
    return mapKickUpstreamOutcome(parseKickUpstreamOutcome(response, data));
  } finally { clearTimeout(deadline); }
}

function createKickTokenForm(grant: KickGrant, credentials: { readonly clientId: string; readonly clientSecret: string }): URLSearchParams {
  switch (grant.kind) {
    case "authorization_code": return new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, code: grant.code, grant_type: "authorization_code", redirect_uri: grant.redirectUri, code_verifier: grant.codeVerifier });
    case "refresh_token": return new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: grant.refreshToken, grant_type: "refresh_token" });
  }
}
function parseKickUpstreamOutcome(response: Response, data: unknown): KickUpstreamOutcome {
  if (response.ok) { const token = parseKickTokenSuccess(data); return token ? { kind: "token_success", status: response.status, token } : { kind: "invalid_response" }; }
  return isRecord(data) && isAllowedKickOAuthError(data.error) ? { kind: "oauth_failure", status: response.status, error: data.error } : { kind: "invalid_response" };
}
function parseKickTokenSuccess(value: unknown): KickTokenSuccess | null {
  if (!isRecord(value)) return null;
  const { access_token, token_type, refresh_token, expires_in, scope } = value;
  if (!isBoundedString(access_token, 8192) || !isBoundedString(token_type, 256) || (refresh_token !== undefined && !isBoundedString(refresh_token, 8192)) || (expires_in !== undefined && (typeof expires_in !== "number" || !Number.isFinite(expires_in) || expires_in < 0)) || (scope !== undefined && !isKickScope(scope))) return null;
  return { access_token, token_type, ...(refresh_token === undefined ? {} : { refresh_token }), ...(expires_in === undefined ? {} : { expires_in }), ...(scope === undefined ? {} : { scope }) };
}
function mapKickUpstreamOutcome(outcome: KickUpstreamOutcome): Response {
  switch (outcome.kind) {
    case "token_success": return authJson(outcome.token, outcome.status);
    case "oauth_failure": return authJson({ error: outcome.error }, outcome.status);
    case "invalid_response": return authJson({ error: "upstream_invalid_response" }, 502);
    case "timeout": return authJson({ error: "upstream_timeout" }, 504);
    case "transport_failure": return authJson({ error: "upstream_unavailable" }, 502);
  }
}
function authJson(body: object, status: number): Response { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isBoundedString(value: unknown, maximumLength: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximumLength; }
function isKickScope(value: unknown): value is string | string[] { return (typeof value === "string" && value.length <= 4096) || (Array.isArray(value) && value.length <= 100 && value.every((scope) => typeof scope === "string" && scope.length <= 256)); }
function isAllowedKickOAuthError(value: unknown): value is KickOAuthError { return typeof value === "string" && Object.hasOwn(ALLOWED_KICK_OAUTH_ERRORS, value); }

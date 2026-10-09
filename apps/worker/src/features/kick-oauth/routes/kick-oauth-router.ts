import { enforceKickAuthIpLimit, enforceKickAuthSubjectLimit, type RateLimitResult } from "../adapters/cloudflare-rate-limit";
import { exchangeKickGrant } from "../adapters/kick-token-client";
import type { RateLimiter } from "../capabilities/rate-limiter";
import { readKickAuthorizationCodeGrant, readKickRefreshGrant } from "../domain/kick-grant";

const AUTH_PATHS = new Set(["/auth/kick/token", "/auth/kick/refresh", "/auth/kick/config", "/auth/kick/android/callback"]);

const KICK_CALLBACK_STATE = /^sf1\.([dp])\.[A-Za-z0-9_-]{43}$/u;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function kickCallbackLanding(request: Request): Response {
  if (request.url.length > 8192) return authJson({ error: "invalid_request" }, 400);
  const parameters = new URL(request.url).searchParams;
  const stateValues = parameters.getAll("state");
  const codeValues = parameters.getAll("code");
  const errorValues = parameters.getAll("error");
  const descriptions = parameters.getAll("error_description");
  const scopes = parameters.getAll("scope");
  const state = stateValues[0];
  const stateMatch = state?.match(KICK_CALLBACK_STATE);
  if (
    stateValues.length !== 1 || codeValues.length > 1 || errorValues.length > 1 ||
    descriptions.length > 1 || scopes.length > 1 ||
    (descriptions[0]?.length ?? 0) > 1024 || (scopes[0]?.length ?? 0) > 1024 ||
    !stateMatch ||
    (codeValues.length === 1 && errorValues.length === 0) ===
      (errorValues.length === 1 && codeValues.length === 0)
  ) return authJson({ error: "invalid_request" }, 400);
  const payload = codeValues.length ? codeValues[0] : errorValues[0];
  if (!payload || payload.length > (codeValues.length ? 2048 : 128) ||
      !/^[\x21-\x7E]+$/u.test(payload))
    return authJson({ error: "invalid_request" }, 400);
  const callback = new URL(stateMatch[1] === "d"
    ? "streamfusion-development://auth/kick/callback"
    : "streamfusion://auth/kick/callback");
  callback.search = new URLSearchParams({
    ...(codeValues.length ? { code: payload } : { error: payload }), state,
  }).toString();
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Return to StreamFusion</title>
  <style>
    html { color-scheme: dark; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #0f0f0f; color: #fff; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    main { box-sizing: border-box; width: min(calc(100% - 32px), 440px); padding: 24px; border: 1px solid #333; border-radius: 12px; background: #1a1a1a; text-align: center; }
    h1 { font-size: 1.5rem; line-height: 1.2; margin: 0 0 16px; }
    p { color: #a0a0a0; font-size: .875rem; line-height: 1.5; margin: 0 0 24px; }
    .button { display: inline-block; box-sizing: border-box; min-height: 44px; padding: 12px 20px; border-radius: 8px; background: #53fc18; color: #0f0f0f; font-size: .875rem; font-weight: 700; text-decoration: none; }
    .button:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  </style>
</head>
<body>
  <main>
    <h1>Continue in StreamFusion</h1>
    <p>Return to the app to finish connecting your Kick account.</p>
    <a class="button" role="button" href="${escapeHtml(callback.toString())}">Open StreamFusion</a>
  </main>
</body>
</html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  } });
}

export async function handleKickOAuthRequest(request: Request, options: { readonly clientId: string; readonly clientSecret: string; readonly ipLimiter: RateLimiter | undefined; readonly subjectLimiter: RateLimiter | undefined }): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/auth/kick/config" && request.method === "GET")
    return options.clientId?.trim()
      ? authJson({ clientId: options.clientId.trim() }, 200)
      : authJson({ error: "configuration_unavailable" }, 503);
  if (path === "/auth/kick/android/callback" && request.method === "GET")
    return kickCallbackLanding(request);
  if (path === "/auth/kick/token" && request.method === "POST") {
    const limit = await enforceKickAuthIpLimit(request, options.ipLimiter);
    if (limit !== "allowed") return rateLimitResponse(limit);
    const grant = await readKickAuthorizationCodeGrant(request);
    if (!grant) return authJson({ error: "invalid_request" }, 400);
    const subjectLimit = await enforceKickAuthSubjectLimit(grant.code, options.subjectLimiter);
    if (subjectLimit !== "allowed") return rateLimitResponse(subjectLimit);
    return exchangeKickGrant(grant, options);
  }
  if (path === "/auth/kick/refresh" && request.method === "POST") {
    const limit = await enforceKickAuthIpLimit(request, options.ipLimiter);
    if (limit !== "allowed") return rateLimitResponse(limit);
    const grant = await readKickRefreshGrant(request);
    if (!grant) return authJson({ error: "invalid_request" }, 400);
    const subjectLimit = await enforceKickAuthSubjectLimit(grant.refreshToken, options.subjectLimiter);
    if (subjectLimit !== "allowed") return rateLimitResponse(subjectLimit);
    return exchangeKickGrant(grant, options);
  }
  if (AUTH_PATHS.has(path)) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response("Not Found", { status: 404 });
}

function rateLimitResponse(result: Exclude<RateLimitResult, "allowed">): Response { return result === "denied" ? Response.json({ error: "rate_limited" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } }) : authJson({ error: "rate_limit_unavailable" }, 503); }
function authJson(body: object, status: number): Response { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

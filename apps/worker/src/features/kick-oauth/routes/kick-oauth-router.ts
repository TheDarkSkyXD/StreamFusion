import { enforceKickAuthIpLimit, enforceKickAuthSubjectLimit, type RateLimitResult } from "../adapters/cloudflare-rate-limit";
import { exchangeKickGrant } from "../adapters/kick-token-client";
import type { RateLimiter } from "../capabilities/rate-limiter";
import { readKickAuthorizationCodeGrant, readKickRefreshGrant } from "../domain/kick-grant";

const AUTH_PATHS = new Set(["/auth/kick/token", "/auth/kick/refresh"]);

export async function handleKickOAuthRequest(request: Request, options: { readonly clientId: string; readonly clientSecret: string; readonly ipLimiter: RateLimiter | undefined; readonly subjectLimiter: RateLimiter | undefined }): Promise<Response> {
  const path = new URL(request.url).pathname;
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

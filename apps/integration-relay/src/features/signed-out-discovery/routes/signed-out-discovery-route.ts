import {
  createRelayFailureEnvelope,
  createRelaySuccessEnvelope,
  signedOutCategoriesBodySchema,
  signedOutSearchBodySchema,
  signedOutTopStreamsBodySchema,
  type JsonValue
} from "@streamfusion/core/relay";

import type {
  DiscoveryPlatform,
  DiscoveryRateLimiter,
  DiscoveryReadAuthorizer
} from "../capabilities/discovery-catalog";
import type { createSignedOutDiscoveryService } from "../domain/discovery-service";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
};
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_BEARER_CREDENTIAL_LENGTH = 4_096;

type DiscoveryService = ReturnType<typeof createSignedOutDiscoveryService>;
type DiscoveryReadResult = Awaited<ReturnType<DiscoveryService["read"]>>;
type AvailableDiscoveryReadResult = Exclude<
  DiscoveryReadResult,
  { readonly kind: "unavailable" }
>;
type DiscoveryRouteKind = AvailableDiscoveryReadResult["kind"];

export function createSignedOutDiscoveryRoute(input: {
  readonly authorizer: DiscoveryReadAuthorizer;
  readonly now: () => number;
  readonly rateLimiter: DiscoveryRateLimiter;
  readonly service: DiscoveryService;
}) {
  return async function route(
    request: Request,
    requestId: string
  ): Promise<Response | null> {
    const url = new URL(request.url);
    const kind = routeKind(url.pathname, request.method);
    if (kind === null) return null;
    const credential = bearerCredential(request);
    if (credential === null)
      return failure(requestId, "unauthorized", 401, "never");
    const platform = platformFrom(url);
    if (!(await consumeAbuseLimit(input, request, kind, platform)))
      return failure(requestId, "rate_limited", 429, "after");
    const installation =
      await input.authorizer.authenticatedInstallation(credential);
    if (installation === null)
      return failure(requestId, "unauthorized", 401, "never");
    if (platform === null)
      return failure(requestId, "invalid_request", 400, "never");
    if (!(await consumeInstallationLimit(input, kind, platform, installation)))
      return failure(requestId, "rate_limited", 429, "after");
    if ((await input.authorizer.authorizeRead(credential)) === null)
      return failure(requestId, "unauthorized", 401, "never");
    const command = commandFrom(kind, platform, url);
    if (command === null)
      return failure(requestId, "invalid_request", 400, "never");
    return discoveryResponse(requestId, await input.service.read(command));
  };
}

async function consumeAbuseLimit(
  input: Parameters<typeof createSignedOutDiscoveryRoute>[0],
  request: Request,
  kind: DiscoveryRouteKind,
  platform: DiscoveryPlatform | null
): Promise<boolean> {
  return input.rateLimiter.consume({
    limit: 120,
    nowEpochMs: input.now(),
    scope: `abuse:discovery:${kind}:${platform ?? "invalid"}:${clientAddress(request)}`,
    windowMs: RATE_LIMIT_WINDOW_MS
  });
}

async function consumeInstallationLimit(
  input: Parameters<typeof createSignedOutDiscoveryRoute>[0],
  kind: DiscoveryRouteKind,
  platform: DiscoveryPlatform,
  installation: Awaited<
    ReturnType<DiscoveryReadAuthorizer["authenticatedInstallation"]>
  >
): Promise<boolean> {
  if (installation === null) return false;
  return input.rateLimiter.consume({
    limit: 60,
    nowEpochMs: input.now(),
    scope: `discovery:${kind}:${platform}:${installation.environment}:${installation.installationId}`,
    windowMs: RATE_LIMIT_WINDOW_MS
  });
}

function routeKind(
  pathname: string,
  method: string
): DiscoveryRouteKind | null {
  if (method !== "GET") return null;
  if (pathname === "/v1/discovery/top-streams") return "top-streams";
  if (pathname === "/v1/discovery/categories") return "categories";
  if (pathname === "/v1/discovery/search") return "search";
  return null;
}

function platformFrom(url: URL): DiscoveryPlatform | null {
  const platform = url.searchParams.get("platform");
  return platform === "twitch" || platform === "kick" ? platform : null;
}

function commandFrom(
  kind: DiscoveryRouteKind,
  platform: DiscoveryPlatform,
  url: URL
) {
  if (kind !== "search") return { kind, platform };
  const query =
    url.searchParams.get("query")?.trim() ||
    url.searchParams.get("q")?.trim() ||
    "";
  return query === "" ? null : { kind, platform, query };
}

function discoveryResponse(
  requestId: string,
  result: DiscoveryReadResult
): Response {
  if (result.kind === "unavailable")
    return failure(requestId, "unavailable", 503, "after");
  const body = validBody(result);
  return body === null
    ? failure(requestId, "unavailable", 503, "after")
    : success(requestId, body);
}

function validBody(result: AvailableDiscoveryReadResult): JsonValue | null {
  if (result.kind === "top-streams")
    return signedOutTopStreamsBodySchema.is(result.body) ? result.body : null;
  if (result.kind === "categories")
    return signedOutCategoriesBodySchema.is(result.body) ? result.body : null;
  return signedOutSearchBodySchema.is(result.body) ? result.body : null;
}

function success(requestId: string, body: JsonValue): Response {
  return new Response(
    JSON.stringify(createRelaySuccessEnvelope({ body, requestId })),
    { headers: RESPONSE_HEADERS, status: 200 }
  );
}

function failure(
  requestId: string,
  code: "invalid_request" | "rate_limited" | "unauthorized" | "unavailable",
  status: number,
  retry: "after" | "never"
): Response {
  return new Response(
    JSON.stringify(
      createRelayFailureEnvelope({
        error: {
          code,
          retry:
            retry === "after"
              ? { kind: "after", seconds: 60 }
              : { kind: "never" }
        },
        requestId
      })
    ),
    { headers: RESPONSE_HEADERS, status }
  );
}

function bearerCredential(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (header === null || !header.startsWith("Bearer ") || header.length <= 7)
    return null;
  const credential = header.slice("Bearer ".length);
  return credential.length <= MAX_BEARER_CREDENTIAL_LENGTH ? credential : null;
}

function clientAddress(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown-client";
}

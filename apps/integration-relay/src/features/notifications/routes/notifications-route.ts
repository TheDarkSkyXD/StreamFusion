import {
  createRelayFailureEnvelope,
  createRelaySuccessEnvelope,
  nativePushDisableRequestSchema,
  nativePushRegistrationRequestSchema,
  type JsonValue,
  type RelayRetry
} from "@streamfusion/core/relay";

import type {
  DiscoveryRateLimiter,
  DiscoveryReadAuthorizer
} from "../../signed-out-discovery/capabilities/discovery-catalog";
import type { createNativePushService } from "../domain/native-push-service";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
};
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_BEARER_CREDENTIAL_LENGTH = 4_096;
const MAX_REQUEST_BODY_BYTES = 65_536;

type NativePushService = ReturnType<typeof createNativePushService>;

export function createNotificationsRoute(input: {
  readonly authorizer: DiscoveryReadAuthorizer;
  readonly now: () => number;
  readonly rateLimiter: DiscoveryRateLimiter;
  readonly service: NativePushService;
}) {
  return async function route(
    request: Request,
    requestId: string
  ): Promise<Response | null> {
    const url = new URL(request.url);
    if (
      url.pathname === "/v1/notifications/register" &&
      request.method === "POST"
    ) {
      return handleRegister(input, request, requestId);
    }
    if (
      url.pathname === "/v1/notifications/disable" &&
      request.method === "POST"
    ) {
      return handleDisable(input, request, requestId);
    }
    return null;
  };
}

async function handleRegister(
  input: Parameters<typeof createNotificationsRoute>[0],
  request: Request,
  requestId: string
): Promise<Response> {
  const credential = bearerCredential(request);
  if (credential === null)
    return failure(requestId, "unauthorized", 401, { kind: "never" });
  if (
    !(await input.rateLimiter.consume({
      limit: 20,
      nowEpochMs: input.now(),
      scope: `abuse:notifications:${clientAddress(request)}`,
      windowMs: RATE_LIMIT_WINDOW_MS
    }))
  ) {
    return failure(requestId, "rate_limited", 429, {
      kind: "after",
      seconds: 60
    });
  }
  const body = await readJson(request);
  if (!nativePushRegistrationRequestSchema.is(body)) {
    return failure(requestId, "invalid_request", 400, { kind: "never" });
  }
  const installation =
    await input.authorizer.authenticatedInstallation(credential);
  if (installation === null)
    return failure(requestId, "unauthorized", 401, { kind: "never" });
  const grant = await input.service.register({ installation, request: body });
  return success(requestId, grant);
}

async function handleDisable(
  input: Parameters<typeof createNotificationsRoute>[0],
  request: Request,
  requestId: string
): Promise<Response> {
  const credential = bearerCredential(request);
  if (credential === null)
    return failure(requestId, "unauthorized", 401, { kind: "never" });
  const body = await readJson(request);
  if (!nativePushDisableRequestSchema.is(body)) {
    return failure(requestId, "invalid_request", 400, { kind: "never" });
  }
  const installation =
    await input.authorizer.authenticatedInstallation(credential);
  if (installation === null)
    return failure(requestId, "unauthorized", 401, { kind: "never" });
  await input.service.disable(installation);
  return success(requestId, { disabled: true });
}

function success(requestId: string, body: JsonValue): Response {
  return new Response(
    JSON.stringify(createRelaySuccessEnvelope({ requestId, body })),
    { headers: RESPONSE_HEADERS, status: 200 }
  );
}

function failure(
  requestId: string,
  code: "invalid_request" | "rate_limited" | "unauthorized",
  status: number,
  retry: RelayRetry
): Response {
  return new Response(
    JSON.stringify(
      createRelayFailureEnvelope({
        requestId,
        error: { code, retry }
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

async function readJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > MAX_REQUEST_BODY_BYTES)
  ) {
    return null;
  }
  if (request.body === null) return null;
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

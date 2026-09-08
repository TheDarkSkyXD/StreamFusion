import {
  createRelayFailureEnvelope,
  installationRegistrationRequestSchema,
  installationRotationRequestSchema,
  type JsonValue,
  type SignedCapabilityManifest
} from "@streamfusion/core/relay";

import type { RelayRateLimiter } from "../capabilities/installation-registry";
import type { createInstallationService } from "../domain/installation-service";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
};
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_BEARER_CREDENTIAL_LENGTH = 4_096;
const MAX_REQUEST_BODY_BYTES = 4_096;

type InstallationService = ReturnType<typeof createInstallationService>;

export function createInstallationPolicyRoute(input: {
  readonly manifest: SignedCapabilityManifest | null;
  readonly now: () => number;
  readonly rateLimiter: RelayRateLimiter;
  readonly service: InstallationService;
}) {
  return async function route(
    request: Request,
    requestId: string
  ): Promise<Response | null> {
    const url = new URL(request.url);
    if (
      url.pathname === "/v1/installations/register" &&
      request.method === "POST"
    ) {
      if (
        !(await input.rateLimiter.consume({
          limit: 8,
          nowEpochMs: input.now(),
          scope: `register:${clientAddress(request)}`,
          windowMs: RATE_LIMIT_WINDOW_MS
        }))
      ) {
        return failure(requestId, "rate_limited", 429, {
          kind: "after",
          seconds: 60
        });
      }
      const body = await readJson(request);
      if (!installationRegistrationRequestSchema.is(body)) {
        return failure(requestId, "invalid_request", 400, { kind: "never" });
      }
      const result = await input.service.register({
        authorization: bearerCredential(request),
        request: body
      });
      return installationResult(requestId, result);
    }

    if (
      url.pathname === "/v1/installations/rotate" &&
      request.method === "POST"
    ) {
      const credential = bearerCredential(request);
      if (credential === null)
        return failure(requestId, "unauthorized", 401, { kind: "never" });
      if (
        !(await input.rateLimiter.consume({
          limit: 40,
          nowEpochMs: input.now(),
          scope: `abuse:rotate:${clientAddress(request)}`,
          windowMs: RATE_LIMIT_WINDOW_MS
        }))
      ) {
        return failure(requestId, "rate_limited", 429, {
          kind: "after",
          seconds: 60
        });
      }
      const body = await readJson(request);
      if (!installationRotationRequestSchema.is(body)) {
        return failure(requestId, "invalid_request", 400, { kind: "never" });
      }
      const installation =
        await input.service.authenticatedInstallation(credential);
      if (installation === null)
        return failure(requestId, "unauthorized", 401, { kind: "never" });
      if (
        !(await input.rateLimiter.consume({
          limit: 12,
          nowEpochMs: input.now(),
          scope: `rotate:${installation.environment}:${installation.installationId}`,
          windowMs: RATE_LIMIT_WINDOW_MS
        }))
      ) {
        return failure(requestId, "rate_limited", 429, {
          kind: "after",
          seconds: 60
        });
      }
      return installationResult(
        requestId,
        await input.service.rotate({ credential, rotationId: body.rotationId })
      );
    }

    if (
      url.pathname === "/v1/capability-manifest" &&
      request.method === "GET"
    ) {
      const credential = bearerCredential(request);
      if (credential === null)
        return failure(requestId, "unauthorized", 401, { kind: "never" });
      if (
        !(await input.rateLimiter.consume({
          limit: 120,
          nowEpochMs: input.now(),
          scope: `abuse:manifest:${clientAddress(request)}`,
          windowMs: RATE_LIMIT_WINDOW_MS
        }))
      ) {
        return failure(requestId, "rate_limited", 429, {
          kind: "after",
          seconds: 60
        });
      }
      const installation =
        await input.service.authenticatedInstallation(credential);
      if (installation === null) {
        return failure(requestId, "unauthorized", 401, { kind: "never" });
      }
      if (
        !(await input.rateLimiter.consume({
          limit: 60,
          nowEpochMs: input.now(),
          scope: `manifest:${installation.environment}:${installation.installationId}`,
          windowMs: RATE_LIMIT_WINDOW_MS
        }))
      ) {
        return failure(requestId, "rate_limited", 429, {
          kind: "after",
          seconds: 60
        });
      }
      if ((await input.service.authorizeRead(credential)) === null)
        return failure(requestId, "unauthorized", 401, { kind: "never" });
      if (input.manifest === null)
        return failure(requestId, "unavailable", 503, {
          kind: "after",
          seconds: 60
        });
      return success(requestId, input.manifest as unknown as JsonValue);
    }

    return null;
  };
}

function installationResult(
  requestId: string,
  result: Awaited<ReturnType<InstallationService["register"]>>
): Response {
  if (result.kind === "grant") return success(requestId, result.grant);
  if (result.kind === "unauthorized")
    return failure(requestId, "unauthorized", 401, { kind: "never" });
  return failure(requestId, "unavailable", 503, { kind: "after", seconds: 10 });
}

function success(requestId: string, body: JsonValue): Response {
  return new Response(
    JSON.stringify({
      kind: "response",
      outcome: { body, kind: "success" },
      protocolVersion: 1,
      requestId
    }),
    { headers: RESPONSE_HEADERS, status: 200 }
  );
}

function failure(
  requestId: string,
  code: "invalid_request" | "rate_limited" | "unauthorized" | "unavailable",
  status: number,
  retry:
    | { readonly kind: "after"; readonly seconds: number }
    | { readonly kind: "never" }
): Response {
  return new Response(
    JSON.stringify(
      createRelayFailureEnvelope({ error: { code, retry }, requestId })
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

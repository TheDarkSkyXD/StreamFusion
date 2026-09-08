import { describe, expect, it } from "vitest";

import { createHmacInstallationCredentialAuthority } from "../adapters/hmac-installation-credential-authority";
import { developmentCapabilityManifest } from "../adapters/development-capability-manifest";
import type {
  InstallationRegistry,
  InstallationRegistryRecord,
  RelayRateLimiter
} from "../capabilities/installation-registry";
import { createInstallationService } from "../domain/installation-service";
import { createInstallationPolicyRoute } from "../routes/installation-policy-route";

function createRoute() {
  const records = new Map<string, InstallationRegistryRecord>();
  const scopes: string[] = [];
  const registry: InstallationRegistry = {
    async get(input) {
      return (
        records.get(`${input.environment}:${input.installationId}`) ?? null
      );
    },
    async insert(record) {
      const key = `${record.environment}:${record.installationId}`;
      if (records.has(key)) return false;
      records.set(key, record);
      return true;
    },
    async replace(record) {
      const key = `${record.environment}:${record.installationId}`;
      if (records.get(key)?.revision !== record.revision - 1) return false;
      records.set(key, record);
      return true;
    }
  };
  const limiter: RelayRateLimiter = {
    async consume(input) {
      scopes.push(input.scope);
      return true;
    }
  };
  const now = () => Date.parse("2026-09-07T00:00:00.000Z");
  const service = createInstallationService({
    authority: createHmacInstallationCredentialAuthority({
      secret: "development-local-proof-secret-2026-09-07"
    }),
    environment: "development",
    now,
    registry
  });
  return {
    route: createInstallationPolicyRoute({
      manifest: developmentCapabilityManifest,
      now,
      rateLimiter: limiter,
      service
    }),
    scopes
  };
}

async function register(
  route: ReturnType<typeof createRoute>["route"],
  installationId: string
) {
  const response = await route(
    new Request("https://relay.test/v1/installations/register", {
      body: JSON.stringify({
        environment: "development",
        installationId,
        registrationId: `register-${installationId}-95B4xv59NSmcKQz33cAj9g`
      }),
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "127.0.0.1"
      },
      method: "POST"
    }),
    "request-95B4xv59NSmcKQz33cAj9g"
  );
  if (response === null)
    throw new Error("Expected installation registration response");
  return (await response.json()) as {
    readonly outcome: { readonly body: { readonly credential: string } };
  };
}

describe("installation policy Relay route", () => {
  it("contains malformed and oversized unauthenticated input in no-store envelopes", async () => {
    const { route, scopes } = createRoute();
    const malformed = await route(
      new Request("https://relay.test/v1/installations/register", {
        body: "{",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }),
      "request-95B4xv59NSmcKQz33cAj9g"
    );
    const oversizedBearer = await route(
      new Request("https://relay.test/v1/capability-manifest", {
        headers: { Authorization: `Bearer ${"x".repeat(4_097)}` }
      }),
      "request-95B4xv59NSmcKQz33cAj9g"
    );
    if (malformed === null || oversizedBearer === null)
      throw new Error("Expected policy route response");

    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("Cache-Control")).toBe("no-store");
    expect(oversizedBearer.status).toBe(401);
    expect(scopes).toContain("register:unknown-client");
  });

  it("uses authenticated environment and installation scopes instead of bearer prefixes", async () => {
    const { route, scopes } = createRoute();
    const one = await register(route, "installation-one");
    const two = await register(route, "installation-two");
    await route(
      new Request("https://relay.test/v1/capability-manifest", {
        headers: { Authorization: `Bearer ${one.outcome.body.credential}` }
      }),
      "request-95B4xv59NSmcKQz33cAj9g"
    );
    await route(
      new Request("https://relay.test/v1/capability-manifest", {
        headers: { Authorization: `Bearer ${two.outcome.body.credential}` }
      }),
      "request-95B4xv59NSmcKQz33cAj9g"
    );

    expect(scopes).toContain("manifest:development:installation-one");
    expect(scopes).toContain("manifest:development:installation-two");
    expect(
      scopes.some((scope) => scope.includes(one.outcome.body.credential))
    ).toBe(false);
  });
});

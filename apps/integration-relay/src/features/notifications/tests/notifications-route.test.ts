import { describe, expect, it } from "vitest";

import {
  fingerprintNativePushToken,
  nativePushRegistrationGrantSchema
} from "@streamfusion/core/relay";

import type {
  NativePushRecord,
  NativePushRegistry
} from "../capabilities/native-push-registry";
import { createNativePushService } from "../domain/native-push-service";
import { createNotificationsRoute } from "../routes/notifications-route";

const nativeToken =
  "dK3kExampleFcmTokenValue:APA91bProofTokenWithoutSecrets0123456789";

function memoryRegistry(): NativePushRegistry & {
  readonly records: Map<string, NativePushRecord>;
} {
  const records = new Map<string, NativePushRecord>();
  return {
    records,
    async get(installationId) {
      return records.get(installationId) ?? null;
    },
    async upsert(record) {
      records.set(record.installationId, record);
    },
    async disable(installationId, rotatedAt) {
      const existing = records.get(installationId);
      if (existing === undefined) return false;
      records.set(installationId, {
        ...existing,
        remoteDeliveryEnabled: false,
        rotatedAt
      });
      return true;
    },
    async listEnabled() {
      return [...records.values()].filter(
        (record) => record.remoteDeliveryEnabled
      );
    },
    async retireByTokenHash(tokenHash, rotatedAt) {
      for (const [id, record] of records) {
        if (record.tokenHash !== tokenHash || !record.remoteDeliveryEnabled) {
          continue;
        }
        records.set(id, {
          ...record,
          remoteDeliveryEnabled: false,
          rotatedAt
        });
        return true;
      }
      return false;
    }
  };
}

function createRoute() {
  const registry = memoryRegistry();
  const route = createNotificationsRoute({
    authorizer: {
      async authenticatedInstallation(credential) {
        return credential === "install-credential"
          ? { environment: "development", installationId: "install-1" }
          : null;
      },
      async authorizeRead() {
        return {};
      }
    },
    now: () => Date.parse("2026-09-15T12:00:00.000Z"),
    rateLimiter: {
      async consume() {
        return true;
      }
    },
    service: createNativePushService({
      now: () => Date.parse("2026-09-15T12:00:00.000Z"),
      registry
    })
  });
  return { registry, route };
}

function registrationBody(token = nativeToken) {
  return {
    schemaVersion: 1,
    nativeToken: token,
    tokenType: "fcm",
    projection: {
      schemaVersion: 1,
      version: 2,
      pairs: [{ platform: "twitch", channelId: "chan-1" }]
    },
    remoteDeliveryEnabled: true
  };
}

describe("native push registration route", () => {
  it("rejects missing credentials and unsafe payloads without returning the token", async () => {
    const { route } = createRoute();
    const unauthorized = await route(
      new Request("https://relay.test/v1/notifications/register", {
        body: JSON.stringify(registrationBody()),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }),
      "request-notifications-1"
    );
    expect(unauthorized?.status).toBe(401);
    const invalid = await route(
      new Request("https://relay.test/v1/notifications/register", {
        body: JSON.stringify({ ...registrationBody(), tokenType: "expo" }),
        headers: {
          Authorization: "Bearer install-credential",
          "Content-Type": "application/json"
        },
        method: "POST"
      }),
      "request-notifications-2"
    );
    expect(invalid?.status).toBe(400);
    const body = (await invalid?.json()) as {
      readonly outcome: { readonly error: { readonly code: string } };
    };
    expect(body.outcome.error.code).toBe("invalid_request");
    expect(JSON.stringify(body)).not.toContain(nativeToken);
  });

  it("upserts a rotated native FCM token and returns only the fingerprint", async () => {
    const { registry, route } = createRoute();
    const first = await route(
      new Request("https://relay.test/v1/notifications/register", {
        body: JSON.stringify(registrationBody()),
        headers: {
          Authorization: "Bearer install-credential",
          "Content-Type": "application/json"
        },
        method: "POST"
      }),
      "request-notifications-3"
    );
    expect(first?.status).toBe(200);
    const firstBody = (await first?.json()) as {
      readonly outcome: {
        readonly body: {
          readonly overflowPairs: number;
          readonly topicSubscriptions: number;
        };
      };
    };
    expect(nativePushRegistrationGrantSchema.is(firstBody.outcome.body)).toBe(
      true
    );
    expect(firstBody.outcome.body).toMatchObject({
      topicSubscriptions: 1,
      overflowPairs: 0
    });
    const rotatedToken = `${nativeToken}Rotated`;
    const second = await route(
      new Request("https://relay.test/v1/notifications/register", {
        body: JSON.stringify(registrationBody(rotatedToken)),
        headers: {
          Authorization: "Bearer install-credential",
          "Content-Type": "application/json"
        },
        method: "POST"
      }),
      "request-notifications-4"
    );
    const secondBody = (await second?.json()) as {
      readonly outcome: {
        readonly body: { readonly tokenFingerprint: string };
      };
    };
    expect(secondBody.outcome.body.tokenFingerprint).toBe(
      await fingerprintNativePushToken(rotatedToken)
    );
    expect(JSON.stringify(secondBody)).not.toContain(rotatedToken);
    expect(registry.records.get("install-1")?.nativeToken).toBe(rotatedToken);
    expect(registry.records.get("install-1")?.projection.version).toBe(2);
  });
});

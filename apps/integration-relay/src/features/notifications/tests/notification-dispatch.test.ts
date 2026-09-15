import { describe, expect, it } from "vitest";

import {
  MAX_FCM_TOPIC_SUBSCRIPTIONS,
  fingerprintNativePushToken,
  liveNotificationTopicName,
  type SafeNotificationPayload
} from "@streamfusion/core/relay";

import type {
  DeliveryLedger,
  DeliveryRecord
} from "../capabilities/delivery-ledger";
import type {
  FcmPushSender,
  FcmSendResult
} from "../capabilities/fcm-push-sender";
import type {
  NativePushRecord,
  NativePushRegistry
} from "../capabilities/native-push-registry";
import { createNotificationDispatchService } from "../domain/notification-dispatch-service";

const topicToken =
  "dK3kExampleFcmTokenValue:APA91bProofTokenWithoutSecrets0123456789";
const overflowToken = `${topicToken}Overflow`;
const retiredToken = `${topicToken}Retired`;

function memoryRegistry(
  records: NativePushRecord[]
): NativePushRegistry & { readonly records: Map<string, NativePushRecord> } {
  const store = new Map(
    records.map((record) => [record.installationId, record])
  );
  return {
    records: store,
    async get(installationId) {
      return store.get(installationId) ?? null;
    },
    async listEnabled() {
      return [...store.values()].filter(
        (record) => record.remoteDeliveryEnabled
      );
    },
    async upsert(record) {
      store.set(record.installationId, record);
    },
    async disable(installationId, rotatedAt) {
      const existing = store.get(installationId);
      if (existing === undefined) return false;
      store.set(installationId, {
        ...existing,
        remoteDeliveryEnabled: false,
        rotatedAt
      });
      return true;
    },
    async retireByTokenHash(tokenHash, rotatedAt) {
      for (const [id, record] of store) {
        if (record.tokenHash !== tokenHash || !record.remoteDeliveryEnabled) {
          continue;
        }
        store.set(id, {
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

function memoryLedger(): DeliveryLedger & { readonly rows: DeliveryRecord[] } {
  const rows: DeliveryRecord[] = [];
  return {
    rows,
    async get(eventId, mode, target) {
      return (
        rows.find(
          (row) =>
            row.eventId === eventId &&
            row.mode === mode &&
            row.target === target
        ) ?? null
      );
    },
    async put(record) {
      const index = rows.findIndex(
        (row) =>
          row.eventId === record.eventId &&
          row.mode === record.mode &&
          row.target === record.target
      );
      if (index === -1) rows.push(record);
      else rows[index] = record;
    }
  };
}

async function recordFor(
  installationId: string,
  token: string,
  pairs: NativePushRecord["projection"]["pairs"]
): Promise<NativePushRecord> {
  return {
    installationId,
    nativeToken: token,
    tokenHash: await fingerprintNativePushToken(token),
    tokenType: "fcm",
    projection: { schemaVersion: 1, version: 1, pairs },
    remoteDeliveryEnabled: true,
    registeredAt: "2026-09-15T12:00:00.000Z",
    rotatedAt: "2026-09-15T12:00:00.000Z"
  };
}

function livePayload(eventId: string): SafeNotificationPayload {
  return {
    schemaVersion: 1,
    eventId,
    sourceId: "relay:live-alert:v1",
    channel: "live",
    title: "ProofStreamer is live",
    body: "Just Chatting",
    destination: {
      kind: "watch-channel",
      platform: "kick",
      channelId: "overflow-channel",
      channelLogin: "overflowchannel",
      streamState: "live"
    },
    occurredAt: "2026-09-15T12:00:00.000Z"
  };
}

function overflowPairs() {
  return [
    ...Array.from({ length: MAX_FCM_TOPIC_SUBSCRIPTIONS }, (_, index) => ({
      platform: "twitch" as const,
      channelId: `pad-${index + 1}`
    })),
    { platform: "kick" as const, channelId: "overflow-channel" }
  ];
}

function createService(input: {
  readonly records: NativePushRecord[];
  readonly sender: FcmPushSender;
  readonly sleeps?: number[];
}) {
  const registry = memoryRegistry(input.records);
  const ledger = memoryLedger();
  const sleeps = input.sleeps ?? [];
  const service = createNotificationDispatchService({
    ledger,
    now: () => Date.parse("2026-09-15T12:00:00.000Z"),
    random: () => 0.5,
    registry,
    sender: input.sender,
    sleep: async (ms) => {
      sleeps.push(ms);
    }
  });
  return { ledger, registry, service, sleeps };
}

// Guards: one live event uses topic XOR direct per token; overflow stays direct; retries and unregistered tokens retire
describe("notification dispatch service", () => {
  it("sends one topic event plus direct overflow and never both to the same token", async () => {
    const pair = { platform: "kick" as const, channelId: "overflow-channel" };
    const topic = liveNotificationTopicName(pair);
    const topics: string[] = [];
    const directs: string[] = [];
    const { ledger, service } = createService({
      records: [
        await recordFor("install-topic", topicToken, [pair]),
        await recordFor("install-overflow", overflowToken, overflowPairs())
      ],
      sender: {
        async sendTopic(name) {
          topics.push(name);
          return { kind: "accepted" };
        },
        async sendDirect(token) {
          directs.push(token);
          return { kind: "accepted" };
        }
      }
    });
    const payload = livePayload("live:kick:overflow-channel:1");
    const first = await service.dispatch({ pair, payload });
    const second = await service.dispatch({ pair, payload });
    expect(topics).toEqual([topic]);
    expect(directs).toEqual([overflowToken]);
    expect(first.map((row) => `${row.mode}:${row.outcome}`)).toEqual([
      "topic:accepted",
      "direct:accepted"
    ]);
    expect(second).toEqual(first);
    expect(JSON.stringify(ledger.rows)).not.toContain(overflowToken);
    expect(JSON.stringify(ledger.rows)).not.toContain(topicToken);
  });

  it("retries after Retry-After then retires an unregistered direct token", async () => {
    const pair = { platform: "twitch" as const, channelId: "chan-1" };
    const results: FcmSendResult[] = [
      { kind: "retryable", retryAfterMs: 12 },
      { kind: "unregistered" }
    ];
    const sleeps: number[] = [];
    const { registry, service } = createService({
      records: [await recordFor("install-direct", retiredToken, [pair])],
      sleeps,
      sender: {
        async sendTopic() {
          return { kind: "accepted" };
        },
        async sendDirect() {
          return results.shift() ?? { kind: "unregistered" };
        }
      }
    });
    const recorded = await service.dispatch({
      pair: null,
      payload: {
        ...livePayload("media:job-1"),
        channel: "media",
        eventId: "media:job-1",
        destination: { kind: "media-job", jobId: "job-1" }
      }
    });
    expect(sleeps).toEqual([12]);
    expect(recorded[0]?.outcome).toBe("terminal-token");
    expect(registry.records.get("install-direct")?.remoteDeliveryEnabled).toBe(
      false
    );
    expect(JSON.stringify(recorded)).not.toContain(retiredToken);
  });
});

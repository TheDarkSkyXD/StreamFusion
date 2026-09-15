import {
  liveNotificationPairKey,
  planInstallationFanout,
  planLogicalEventDelivery,
  type LiveNotificationPair,
  type PlannedNotificationSend,
  type SafeNotificationPayload
} from "@streamfusion/core/relay";

import type {
  DeliveryLedger,
  DeliveryOutcome,
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

const MAX_SEND_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 30_000;

export function createNotificationDispatchService(input: {
  readonly ledger: DeliveryLedger;
  readonly now: () => number;
  readonly random: () => number;
  readonly registry: NativePushRegistry;
  readonly sender: FcmPushSender;
  readonly sleep: (ms: number) => Promise<void>;
}) {
  return {
    async dispatch(command: {
      readonly pair: LiveNotificationPair | null;
      readonly payload: SafeNotificationPayload;
    }): Promise<readonly DeliveryRecord[]> {
      const records = await input.registry.listEnabled();
      if (records.length === 0) {
        return [localRecord(command.payload.eventId, input.now())];
      }
      const planned = planLogicalEventDelivery({
        eventId: command.payload.eventId,
        channel: command.payload.channel,
        pair: command.pair,
        recipients: records.map(recipientFromRecord)
      });
      const recorded: DeliveryRecord[] = [];
      for (const send of planned) {
        recorded.push(
          ...(await executePlannedSend(input, send, command.payload, records))
        );
      }
      return recorded.length > 0
        ? recorded
        : [localRecord(command.payload.eventId, input.now())];
    }
  };
}

async function executePlannedSend(
  input: Parameters<typeof createNotificationDispatchService>[0],
  send: PlannedNotificationSend,
  payload: SafeNotificationPayload,
  records: readonly NativePushRecord[]
): Promise<readonly DeliveryRecord[]> {
  if (send.mode === "topic") {
    return [await dispatchTopic(input, send.topic, payload)];
  }
  const recorded: DeliveryRecord[] = [];
  for (const fingerprint of send.fingerprints) {
    recorded.push(await dispatchDirect(input, fingerprint, payload, records));
  }
  return recorded;
}

async function dispatchTopic(
  input: Parameters<typeof createNotificationDispatchService>[0],
  topic: string,
  payload: SafeNotificationPayload
): Promise<DeliveryRecord> {
  const existing = await input.ledger.get(payload.eventId, "topic", topic);
  if (existing?.outcome === "accepted") return existing;
  const result = await sendWithRetry(input, () =>
    input.sender.sendTopic(topic, payload)
  );
  return persist(input, {
    eventId: payload.eventId,
    mode: "topic",
    target: topic,
    outcome: topicOutcome(result),
    recordedAt: new Date(input.now()).toISOString()
  });
}

async function dispatchDirect(
  input: Parameters<typeof createNotificationDispatchService>[0],
  fingerprint: string,
  payload: SafeNotificationPayload,
  records: readonly NativePushRecord[]
): Promise<DeliveryRecord> {
  const existing = await input.ledger.get(
    payload.eventId,
    "direct",
    fingerprint
  );
  if (
    existing?.outcome === "accepted" ||
    existing?.outcome === "terminal-token"
  ) {
    return existing;
  }
  const record = records.find((item) => item.tokenHash === fingerprint);
  if (record === undefined) {
    return persist(input, {
      eventId: payload.eventId,
      mode: "direct",
      target: fingerprint,
      outcome: "local-reconciled",
      recordedAt: new Date(input.now()).toISOString()
    });
  }
  const result = await sendWithRetry(input, () =>
    input.sender.sendDirect(record.nativeToken, payload)
  );
  if (result.kind === "unregistered") {
    await input.registry.retireByTokenHash(
      fingerprint,
      new Date(input.now()).toISOString()
    );
  }
  return persist(input, {
    eventId: payload.eventId,
    mode: "direct",
    target: fingerprint,
    outcome: directOutcome(result),
    recordedAt: new Date(input.now()).toISOString()
  });
}

async function sendWithRetry(
  input: Parameters<typeof createNotificationDispatchService>[0],
  send: () => Promise<FcmSendResult>
): Promise<FcmSendResult> {
  let attempt = 0;
  let last: FcmSendResult = { kind: "retryable", retryAfterMs: 1_000 };
  while (attempt < MAX_SEND_ATTEMPTS) {
    last = await send();
    if (last.kind !== "retryable") return last;
    await input.sleep(retryDelayMs(attempt, last.retryAfterMs, input.random));
    attempt += 1;
  }
  return last;
}

async function persist(
  input: Parameters<typeof createNotificationDispatchService>[0],
  record: DeliveryRecord
): Promise<DeliveryRecord> {
  await input.ledger.put(record);
  return record;
}

function recipientFromRecord(record: NativePushRecord) {
  const fanout = planInstallationFanout(record.projection.pairs);
  return {
    tokenFingerprint: record.tokenHash,
    topicNames: fanout.topicNames,
    overflowKeys: fanout.overflowPairs.map(liveNotificationPairKey)
  };
}

function retryDelayMs(
  attempt: number,
  retryAfterMs: number,
  random: () => number
): number {
  if (retryAfterMs > 0) return retryAfterMs;
  const base = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempt);
  return Math.floor(base * (0.5 + random()));
}

function topicOutcome(result: FcmSendResult): DeliveryOutcome {
  return result.kind === "accepted" ? "accepted" : "retryable";
}

function directOutcome(result: FcmSendResult): DeliveryOutcome {
  if (result.kind === "accepted") return "accepted";
  if (result.kind === "unregistered") return "terminal-token";
  return "retryable";
}

function localRecord(eventId: string, now: number): DeliveryRecord {
  return {
    eventId,
    mode: "direct",
    target: "local",
    outcome: "local-reconciled",
    recordedAt: new Date(now).toISOString()
  };
}

import {
  safeNotificationPayloadSchema,
  type LiveNotificationPair,
  type SafeNotificationPayload
} from "@streamfusion/core/relay";

import type { FollowedContentCatalog } from "../../followed-content/capabilities/followed-content-catalog";
import type { LiveNotificationState } from "../capabilities/live-notification-state";
import type { FcmPushSender } from "../capabilities/fcm-push-sender";
import type {
  NativePushRecord,
  NativePushRegistry
} from "../capabilities/native-push-registry";

const MAX_PROVIDER_BATCHES = 4;
const MAX_DIRECT_SENDS = 100;
const SEND_CONCURRENCY = 4;
const D1_QUERY_BUDGET = 900;
const FIXED_QUERY_RESERVE = 24;
const QUERY_COST_PER_SEND = 7;
const MAX_TICK_WALL_MS = 50_000;
const POLL_INTERVAL_MS = 60_000;

export function createLiveNotificationWorkflow(input: {
  readonly catalogs: readonly FollowedContentCatalog[];
  readonly now: () => number;
  readonly registry: NativePushRegistry;
  readonly sender: FcmPushSender;
  readonly state: LiveNotificationState;
}) {
  return {
    async tick(): Promise<void> {
      const deadline = performance.now() + MAX_TICK_WALL_MS;
      let queriesRemaining = D1_QUERY_BUDGET - FIXED_QUERY_RESERVE;
      const nowMs = input.now();
      const records = await input.registry.listEnabled();
      const lastObserved = await input.state.lastObserved();
      const pairs = uniquePairs(records)
        .filter(
          ({ pair }) =>
            (lastObserved.get(pairKey(pair))?.observedAtMs ?? 0) <=
            nowMs - POLL_INTERVAL_MS
        )
        .sort(
          (left, right) =>
            (lastObserved.get(pairKey(left.pair))?.observedAtMs ?? 0) -
            (lastObserved.get(pairKey(right.pair))?.observedAtMs ?? 0)
        );

      const queues = {
        twitch: pairs.filter(({ pair }) => pair.platform === "twitch"),
        kick: pairs.filter(
          ({ pair }) =>
            pair.platform === "kick" && pair.channelLogin !== undefined
        )
      };
      const unavailablePairs: typeof pairs = [];
      let batches = 0;
      let budgetExhausted = false;
      while (
        batches < MAX_PROVIDER_BATCHES &&
        !budgetExhausted &&
        performance.now() < deadline &&
        (queues.twitch.length > 0 || queues.kick.length > 0)
      ) {
        for (const platform of ["twitch", "kick"] as const) {
          if (batches >= MAX_PROVIDER_BATCHES || performance.now() >= deadline)
            break;
          const catalog = input.catalogs.find(
            (candidate) => candidate.platform === platform
          );
          if (catalog === undefined) {
            unavailablePairs.push(...queues[platform]);
            queues[platform].length = 0;
            continue;
          }
          if (queues[platform].length === 0) continue;
          const batch = queues[platform].splice(
            0,
            platform === "twitch" ? 100 : 50
          );
          batches += 1;
          const refs = batch.map(({ pair }) =>
            platform === "twitch"
              ? { kind: "id" as const, value: pair.channelId }
              : { kind: "login" as const, value: pair.channelLogin ?? "" }
          );
          const result = await catalog.followedStreams(refs);
          if (result === null) {
            unavailablePairs.push(...batch);
            continue;
          }
          for (let index = 0; index < batch.length; index += 1) {
            const entry = batch[index];
            if (entry === undefined) continue;
            const { pair } = entry;
            if (performance.now() >= deadline) {
              queues[platform].unshift(...batch.slice(index));
              break;
            }
            if (
              result.unavailableRefs?.some(
                (ref) =>
                  ref.kind === "login" &&
                  ref.value.toLowerCase() === pair.channelLogin?.toLowerCase()
              )
            ) {
              unavailablePairs.push(entry);
              continue;
            }
            const stream = result.streams.find((candidate) =>
              platform === "twitch"
                ? candidate.channelId === pair.channelId
                : candidate.channelName.toLowerCase() ===
                  pair.channelLogin?.toLowerCase()
            );
            const sessionKey =
              stream === undefined
                ? null
                : platform === "twitch"
                  ? stream.id
                  : `${stream.channelId}:${stream.startedAt}`;
            if (
              stream !== undefined &&
              (stream.startedAt === null || sessionKey === null)
            )
              continue;
            const eventId =
              sessionKey === null
                ? null
                : await eventIdentifier(
                    platform,
                    stream?.channelId ?? pair.channelId,
                    sessionKey
                  );
            const payload =
              eventId === null
                ? null
                : livePayload(
                    eventId,
                    pair,
                    stream?.channelDisplayName ||
                      pair.channelLogin ||
                      "Channel",
                    pair.channelLogin ?? stream?.channelName ?? "channel",
                    nowMs
                  );
            const previous = lastObserved.get(pairKey(pair));
            const deliveryPayload =
              payload !== null &&
              previous !== undefined &&
              previous.sessionKey !== sessionKey &&
              safeNotificationPayloadSchema.is(payload)
                ? payload
                : null;
            const queryCost = deliveryPayload === null ? 2 : 4;
            if (queryCost > queriesRemaining) {
              queues[platform].unshift(...batch.slice(index));
              budgetExhausted = true;
              break;
            }
            queriesRemaining -= queryCost;
            await input.state.observe({
              pair,
              sessionKey,
              eventId,
              observedAtMs: nowMs,
              payload: deliveryPayload
            });
          }
        }
      }

      let sent = 0;
      while (sent < MAX_DIRECT_SENDS && performance.now() < deadline) {
        const capacity = Math.min(
          SEND_CONCURRENCY,
          MAX_DIRECT_SENDS - sent,
          Math.floor((queriesRemaining - 2) / QUERY_COST_PER_SEND)
        );
        if (capacity <= 0) break;
        queriesRemaining -= capacity * QUERY_COST_PER_SEND + 2;
        const due = await input.state.claimDue(input.now(), capacity);
        if (due.length === 0) break;
        sent += due.length;
        await Promise.all(
          due.map(async (delivery) => {
            if (performance.now() >= deadline) {
              await input.state.release(delivery);
              return;
            }
            const attemptAtMs = input.now();
            const record = await input.registry.get(delivery.installationId);
            if (
              record === null ||
              !record.remoteDeliveryEnabled ||
              !record.projection.pairs.some(
                (pair) => pairKey(pair) === delivery.pairKey
              ) ||
              attemptAtMs >= delivery.expiresAtMs
            ) {
              await input.state.complete(delivery, attemptAtMs, "skipped");
              return;
            }
            const graceMinutes =
              record.projection.delivery?.restartGracePeriodMinutes ?? 0;
            const lastAlertAt = await input.state.lastAlertAt(
              delivery.installationId,
              delivery.pairKey
            );
            if (
              lastAlertAt !== null &&
              attemptAtMs - lastAlertAt < graceMinutes * 60_000
            ) {
              await input.state.complete(delivery, attemptAtMs, "skipped");
              return;
            }
            const tokenHash = record.tokenHash;
            const result = await input.sender.sendDirect({
              nativeToken: record.nativeToken,
              payload: delivery.payload,
              silent: record.projection.delivery?.silent ?? false,
              ttlSeconds: Math.max(
                1,
                Math.floor((delivery.expiresAtMs - attemptAtMs) / 1000)
              )
            });
            const completedAtMs = input.now();
            if (result.kind === "unregistered") {
              await input.registry.retireIfCurrent(
                delivery.installationId,
                tokenHash,
                new Date(completedAtMs).toISOString()
              );
              await input.state.complete(delivery, completedAtMs, "skipped");
            } else if (result.kind === "accepted") {
              await input.state.complete(delivery, completedAtMs, "accepted");
            } else if (result.kind === "rejected") {
              await input.state.complete(delivery, completedAtMs, "skipped");
            } else {
              const exponential = Math.min(
                30_000,
                1_000 * 2 ** delivery.attempts
              );
              const delay =
                result.kind === "retryable"
                  ? Math.max(result.retryAfterMs, exponential)
                  : exponential;
              await input.state.complete(
                delivery,
                completedAtMs,
                "retry",
                delay
              );
            }
          })
        );
      }
      await input.state.cleanup(nowMs);
      const remaining = [...queues.twitch, ...queues.kick, ...unavailablePairs];
      const overduePollAgeMs = remaining.reduce((oldest, entry) => {
        const observedAt =
          lastObserved.get(pairKey(entry.pair))?.observedAtMs ??
          entry.firstReconciledAtMs;
        return Math.max(oldest, nowMs - observedAt - POLL_INTERVAL_MS);
      }, 0);
      const pendingCreatedAt =
        await input.state.oldestDuePendingCreatedAt(nowMs);
      const pendingAgeMs =
        pendingCreatedAt === null ? 0 : Math.max(0, nowMs - pendingCreatedAt);
      if (
        overduePollAgeMs > POLL_INTERVAL_MS ||
        pendingAgeMs > POLL_INTERVAL_MS
      ) {
        console.warn("live_notification_backlog", {
          overduePollAgeMs,
          pendingAgeMs
        });
      }
    }
  };
}

function uniquePairs(records: readonly NativePushRecord[]) {
  const pairs = new Map<
    string,
    {
      pair: LiveNotificationPair;
      firstReconciledAtMs: number;
    }
  >();
  for (const record of records) {
    for (const pair of record.projection.pairs) {
      const key = pairKey(pair);
      const existing = pairs.get(key);
      if (existing === undefined)
        pairs.set(key, {
          pair,
          firstReconciledAtMs: Date.parse(record.rotatedAt)
        });
      else {
        existing.firstReconciledAtMs = Math.min(
          existing.firstReconciledAtMs,
          Date.parse(record.rotatedAt)
        );
        if (
          existing.pair.channelLogin === undefined &&
          pair.channelLogin !== undefined
        )
          existing.pair = pair;
      }
    }
  }
  return [...pairs.values()];
}

function pairKey(pair: LiveNotificationPair): string {
  return `${pair.platform}:${pair.channelId}`;
}

async function eventIdentifier(
  platform: string,
  channelId: string,
  sessionKey: string
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${platform}:${channelId}:${sessionKey}`
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  return `live:${platform}:${hash}`;
}

function livePayload(
  eventId: string,
  pair: LiveNotificationPair,
  displayName: string,
  channelLogin: string,
  nowMs: number
): SafeNotificationPayload {
  const safeName =
    displayName.length > 0 &&
    displayName.length <= 64 &&
    [...displayName].every((character) => character.charCodeAt(0) >= 32) &&
    !/https?:\/\//iu.test(displayName)
      ? displayName
      : (pair.channelLogin ?? "A channel");
  return {
    schemaVersion: 1,
    eventId,
    sourceId: "relay:live-alert:v1",
    channel: "live",
    title: `${safeName} is live`.slice(0, 180),
    body: "Tap to watch now",
    destination: {
      kind: "watch-channel",
      platform: pair.platform,
      channelId: pair.channelId,
      channelLogin,
      streamState: "live"
    },
    occurredAt: new Date(nowMs).toISOString()
  };
}

import {
  toSerializedTimestamp,
  type ActivityItem,
} from "@streamfusion/core/activity";
import type { Stream } from "@streamfusion/core/content";
import {
  findGuestFollow,
  guestFollowKey,
  isFollowEligibleForLiveNotification,
  resolveLiveNotificationDecision,
  type GuestFollow,
  type LiveNotificationPreferences,
} from "@streamfusion/core/follows";

import type { ActivityRepository } from "@mobile/features/storage/capabilities/persistence";

export interface GuestLiveAlertReconciler {
  /** Observe currently live followed streams; records go-live Activity when a channel transitions offline→live. */
  observe(input: {
    readonly membership: readonly GuestFollow[];
    /** Guest-only subset used for live-notification followSource; defaults to membership. */
    readonly guestMembership?: readonly GuestFollow[];
    readonly preferences: LiveNotificationPreferences;
    readonly silent?: boolean;
    readonly streams: readonly Stream[];
  }): Promise<readonly ActivityItem[]>;
  reset(): void;
}

export function createGuestLiveAlertReconciler(options: {
  readonly activity: ActivityRepository;
  readonly now: () => number;
  readonly presentSystemNotification?: (input: {
    readonly item: ActivityItem;
    readonly silent: boolean;
  }) => Promise<void>;
  readonly systemNotificationsSupported?: boolean;
}): GuestLiveAlertReconciler {
  const liveByChannel = new Map<string, boolean>();
  const lastNotifiedAtByChannel = new Map<string, number>();

  return {
    reset() {
      liveByChannel.clear();
      lastNotifiedAtByChannel.clear();
    },
    async observe(input) {
      const silent = input.silent === true;
      const observedKeys = new Set<string>();
      const recorded: ActivityItem[] = [];

      const guestMembership = input.guestMembership ?? input.membership;
      for (const stream of input.streams) {
        if (!stream.isLive) continue;
        const follow = findGuestFollow(input.membership, {
          platform: stream.platform,
          channelId: stream.channelId,
          channelLogin: stream.channelName,
        });
        if (!follow) continue;

        const key = guestFollowKey(follow);
        observedKeys.add(key);
        const wasLive = liveByChannel.get(key) === true;
        liveByChannel.set(key, true);

        const isGuest =
          findGuestFollow(guestMembership, {
            platform: follow.platform,
            channelId: follow.channelId,
            channelLogin: follow.channelLogin,
          }) !== undefined;
        const eligible = isFollowEligibleForLiveNotification({
          channel: {
            platform: follow.platform,
            id: follow.channelId,
            username: follow.channelLogin,
          },
          followSource: isGuest ? "guest" : follow.platform,
          preferences: input.preferences,
        });
        if (silent || wasLive || !eligible) continue;

        const nowMs = options.now();
        const lastNotifiedAt = lastNotifiedAtByChannel.get(key);
        const decision = resolveLiveNotificationDecision({
          eligible: true,
          nowMs,
          preferences: input.preferences,
          silentSync: false,
          systemNotificationsSupported:
            options.systemNotificationsSupported === true,
          wasLive: false,
          ...(lastNotifiedAt === undefined
            ? {}
            : { lastNotifiedAtMs: lastNotifiedAt }),
        });
        if (decision.kind === "ignore") continue;

        const item = liveAlertFromStream(stream, follow, nowMs);
        await options.activity.record(item);
        lastNotifiedAtByChannel.set(key, nowMs);
        recorded.push(item);
        if (
          decision.kind === "deliver" &&
          decision.systemNotification &&
          options.presentSystemNotification
        ) {
          await options.presentSystemNotification({
            item,
            silent: decision.systemNotification.silent,
          });
        }
      }

      for (const [key, isLive] of liveByChannel) {
        if (isLive && !observedKeys.has(key)) liveByChannel.set(key, false);
      }

      return recorded;
    },
  };
}

export function liveAlertFromStream(
  stream: Stream,
  follow: GuestFollow,
  nowMs: number,
): ActivityItem {
  const occurredAt = toSerializedTimestamp(new Date(nowMs).toISOString());
  const sessionStamp = stream.startedAt ?? occurredAt;
  const login = follow.channelLogin;
  return {
    schemaVersion: 1,
    eventId: `local:live-alert:${follow.platform}:${follow.channelId}:${sessionStamp}`,
    kind: "channel",
    event: "live-alert",
    source: "local",
    occurredAt,
    readAt: null,
    title: `${follow.displayName} is live`,
    body: stream.title.length > 0 ? stream.title : "A followed channel went live.",
    channel: {
      platform: follow.platform,
      id: follow.channelId,
      login,
      displayName: follow.displayName,
    },
    destination: {
      kind: "watch-channel",
      platform: follow.platform,
      channelId: follow.channelId,
      channelLogin: login,
    },
  };
}

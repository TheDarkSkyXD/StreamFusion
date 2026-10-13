import {
  findGuestFollow,
  isFollowEligibleForLiveNotification,
  type GuestFollow,
  type LiveNotificationPreferences,
} from "@streamfusion/core/follows";
import type { LiveHydration } from "@mobile/features/follows/capabilities/following-session";

import type {
  ForegroundObservation,
  BackgroundSnapshot,
} from "../capabilities/background-live-alerts";

export function buildBackgroundSnapshot(input: {
  readonly membership: readonly GuestFollow[];
  readonly guestMembership: readonly GuestFollow[];
  readonly preferences: LiveNotificationPreferences;
  readonly observations: readonly ForegroundObservation[];
}): BackgroundSnapshot {
  const verifiedLogins = new Map(
    input.observations.flatMap((observation) =>
      observation.kind === "live"
        ? [
            [
              `${observation.platform}:${observation.channelId}`,
              observation.channelLogin,
            ] as const,
          ]
        : [],
    ),
  );
  const channels = input.membership
    .filter((follow) => {
      const guest =
        findGuestFollow(input.guestMembership, {
          platform: follow.platform,
          channelId: follow.channelId,
          channelLogin: follow.channelLogin,
        }) !== undefined;
      return isFollowEligibleForLiveNotification({
        channel: {
          platform: follow.platform,
          id: follow.channelId,
          username: follow.channelLogin,
        },
        followSource: guest ? "guest" : follow.platform,
        preferences: input.preferences,
      });
    })
    .map((follow) => ({
      platform: follow.platform,
      channelId: follow.channelId,
      channelLogin:
        verifiedLogins.get(`${follow.platform}:${follow.channelId}`) ??
        follow.channelLogin,
      displayName: follow.displayName,
    }));
  const eligibleKeys = new Set(
    channels.map((channel) => `${channel.platform}:${channel.channelId}`),
  );
  return {
    schemaVersion: 1,
    channels,
    policy: {
      historyEnabled: input.preferences.liveAlerts,
      systemAlerts:
        input.preferences.enabled && !input.preferences.doNotDisturb,
      toastAlerts:
        input.preferences.toastAlerts && !input.preferences.doNotDisturb,
      sound: input.preferences.sound,
      restartGraceMinutes: input.preferences.restartGracePeriodMinutes,
    },
    observations: input.observations
      .filter((observation) =>
        eligibleKeys.has(`${observation.platform}:${observation.channelId}`),
      )
      .map((observation) =>
        observation.kind === "offline"
          ? observation
          : {
              platform: observation.platform,
              channelId: observation.channelId,
              observedAtMs: observation.observedAtMs,
              kind: observation.kind,
              streamId: observation.streamId,
              title: observation.title,
            },
      ),
  };
}

export function verifiedLiveObservations(
  input: LiveHydration,
): readonly ForegroundObservation[] {
  const fresh = ([input.outcomes.twitch, input.outcomes.kick] as const).flatMap(
    (outcome) =>
      (outcome.status === "complete" || outcome.status === "partial") &&
      !outcome.stale
        ? outcome.items.map((stream) => ({
            stream,
            observedAtMs: input.observedAtMs[outcome.platform],
          }))
        : [],
  );
  const observed = new Map<string, ForegroundObservation>();
  for (const { stream, observedAtMs } of [
    ...fresh,
    ...input.accountLive.map((stream) => ({
      stream,
      observedAtMs: input.observedAtMs.account,
    })),
  ]) {
    if (
      !stream.isLive ||
      stream.id.trim() === "" ||
      (stream.platform === "kick" && stream.id === stream.channelId)
    )
      continue;
    const follow = findGuestFollow(input.membership, {
      platform: stream.platform,
      channelId: stream.channelId,
      channelLogin: stream.channelName,
    });
    if (follow === undefined) continue;
    observed.set(`${follow.platform}:${follow.channelId}`, {
      platform: follow.platform,
      channelId: follow.channelId,
      channelLogin: stream.channelName,
      observedAtMs,
      kind: "live",
      streamId: stream.id,
      title: stream.title,
    });
  }
  for (const outcome of [input.outcomes.twitch, input.outcomes.kick]) {
    if (outcome.status !== "complete" && outcome.status !== "partial") continue;
    if (outcome.stale) continue;
    for (const channelId of outcome.verifiedOfflineChannelIds ?? []) {
      const follow = input.membership.find(
        (entry) =>
          entry.platform === outcome.platform && entry.channelId === channelId,
      );
      if (follow === undefined) continue;
      const key = `${follow.platform}:${follow.channelId}`;
      if (observed.has(key)) continue;
      observed.set(key, {
        platform: follow.platform,
        channelId: follow.channelId,
        observedAtMs: input.observedAtMs[outcome.platform],
        kind: "offline",
      });
    }
  }
  return [...observed.values()];
}

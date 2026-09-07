import { z } from "zod";
import {
  activeModeratorsPageSchema,
  chattersPageSchema,
  manageableRewardsSchema,
  moderationFeedEventSchema,
  rewardRedemptionsPageSchema,
} from "@shared/moderation-types";
import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";
import type { WorkspacePanelsPort } from "../../capabilities/workspace-panels";

async function read<T>(
  command: TwitchApiCommand,
  schema: z.ZodType<T>
): Promise<TwitchApiResult<T>> {
  const result = await window.electronAPI.twitch.execute(command);
  if (!result.ok) return result;
  const parsed = schema.safeParse(result.data);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, error: { code: "unavailable", message: "Invalid moderation response" } };
}
const moderatedSchema = z.array(
  z.object({
    broadcaster_id: z.string(),
    broadcaster_login: z.string(),
    broadcaster_name: z.string(),
  })
);
export const desktopWorkspacePanels: WorkspacePanelsPort = {
  setSuspiciousStatus: (broadcasterId, moderatorId, userId, status) =>
    window.electronAPI.twitch.execute({
      operation: "set-suspicious-user-status",
      broadcasterId,
      moderatorId,
      userId,
      status,
    }),
  decideRedemption: (broadcasterId, rewardId, redemptionId, status) =>
    window.electronAPI.twitch.execute({
      operation: "update-reward-redemption",
      broadcasterId,
      rewardId,
      redemptionId,
      status,
    }),
  tokenStatus: () => window.electronAPI.auth.tokenStatus("twitch"),
  startFeed: (params) => window.electronAPI.twitch.eventSub.start(params),
  stopFeed: (id) => window.electronAPI.twitch.eventSub.stop(id),
  onEvent: (callback) =>
    window.electronAPI.twitch.eventSub.onEvent(({ feedId, payload }) => {
      const parsed = moderationFeedEventSchema.safeParse(payload);
      if (parsed.success) callback({ feedId, payload: parsed.data });
    }),
  onState: (callback) => window.electronAPI.twitch.eventSub.onState(callback),
  chatters: (broadcasterId, moderatorId, after) =>
    read({ operation: "get-chatters", broadcasterId, moderatorId, after }, chattersPageSchema),
  activeModerators: (broadcasterId, moderatorId, after) =>
    read(
      { operation: "get-active-moderators", broadcasterId, moderatorId, after },
      activeModeratorsPageSchema
    ),
  rewards: (broadcasterId) =>
    read({ operation: "get-manageable-rewards", broadcasterId }, manageableRewardsSchema),
  redemptions: (broadcasterId, rewardId, after) =>
    read(
      { operation: "get-reward-redemptions", broadcasterId, rewardId, after },
      rewardRedemptionsPageSchema
    ),
  moderatedChannels: async (userId) => {
    const result = await read({ operation: "get-moderated-channels", userId }, moderatedSchema);
    if (!result.ok) throw new Error(result.error.message);
    return result.data.map((c) => ({
      id: c.broadcaster_id,
      login: c.broadcaster_login,
      displayName: c.broadcaster_name,
    }));
  },
  followedChannels: async () => {
    const [channels, streams] = await Promise.allSettled([
      window.electronAPI.channels.getFollowed({ platform: "twitch" }),
      window.electronAPI.streams.getFollowed({ platform: "twitch" }),
    ]);
    if (channels.status === "rejected") throw channels.reason;
    const result = channels.value;
    if (!result.success) throw new Error(result.error);
    const snapshot = streams.status === "fulfilled" && streams.value.success ? streams.value : null;
    const current =
      snapshot?.providers.twitch === "complete" || snapshot?.providers.twitch === "partial";
    const liveIds = new Set(
      current
        ? snapshot.data
            .filter((stream) => stream.platform === "twitch" && stream.isLive)
            .map((stream) => stream.channelId)
        : []
    );
    return result.data.map((c) => ({
      id: c.id,
      login: c.username,
      displayName: c.displayName,
      isLive: liveIds.has(c.id)
        ? true
        : snapshot?.providers.twitch === "complete"
          ? false
          : undefined,
    }));
  },
  openTwitch: (channelName) =>
    window.electronAPI.openExternal(
      `https://www.twitch.tv/moderator/${encodeURIComponent(channelName)}`
    ),
};

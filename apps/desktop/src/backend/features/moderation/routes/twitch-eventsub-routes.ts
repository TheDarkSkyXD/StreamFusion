import { MODERATION_FEED_EVENT_TYPES } from "@shared/moderation-types";
import { z } from "zod";

import type { TwitchEventSubFeedService } from "@backend/features/moderation/adapters/twitch/twitch-eventsub-feed-service";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { TwitchApiResult } from "@shared/twitch-api-types";

import type { MainRendererPort } from "../../../ipc/main-renderer-port";
import { isAllowedSender } from "../../../ipc/sender-origin";
import { trustedIpcMain as ipcMain } from "../../../ipc/trusted-ipc-main";

const startSchema = z
  .object({
    feedId: z.string().trim().min(1).max(128),
    userId: z.string().trim().min(1).max(64),
    channelId: z.string().trim().min(1).max(64),
    eventTypes: z
      .array(
        z.enum([
          "channel.moderate",
          "automod.message.hold",
          "automod.message.update",
          ...MODERATION_FEED_EVENT_TYPES,
        ])
      )
      .min(1)
      .max(14)
      .optional(),
  })
  .strict();
const stopSchema = z.object({ feedId: z.string().trim().min(1).max(128) }).strict();

/** Registers moderation-owned EventSub lifecycle channels. */
export function registerTwitchEventSubRoutes({
  eventSub,
  renderer,
}: {
  eventSub: TwitchEventSubFeedService;
  renderer?: MainRendererPort;
}): void {
  const ownedFeeds = new Set<string>();
  renderer?.useWindow("moderation-eventsub-feeds", () => () => {
    for (const feedId of ownedFeeds) eventSub.stop(feedId);
    ownedFeeds.clear();
  });
  ipcMain.handle(IPC_CHANNELS.TWITCH_EVENTSUB_START, async (event, payload: unknown) => {
    if (!isAllowedSender(event)) {
      return {
        ok: false,
        error: { code: "unauthorized", message: "This Twitch request was not authorized." },
      } satisfies TwitchApiResult;
    }
    const parsed = startSchema.safeParse(payload);
    if (!parsed.success || !renderer) {
      return {
        ok: false,
        error: { code: "invalid-input", message: "The EventSub request is invalid." },
      } satisfies TwitchApiResult;
    }
    const { feedId, userId, channelId, eventTypes } = parsed.data;
    const ownerId = event.sender.id;
    const ownedFeedId = `${ownerId}:${feedId}`;
    if (ownedFeeds.size >= 64 && !ownedFeeds.has(ownedFeedId))
      return {
        ok: false,
        error: { code: "unavailable", message: "Too many active feeds." },
      } satisfies TwitchApiResult;
    ownedFeeds.add(ownedFeedId);
    const result = await eventSub.start({
      feedId: ownedFeedId,
      userId,
      channelId,
      eventTypes,
      onEvent: (eventPayload) =>
        renderer.sendToOwner(ownerId, IPC_CHANNELS.TWITCH_EVENTSUB_EVENT, {
          feedId,
          payload: eventPayload,
        }),
      onState: (state) =>
        renderer.sendToOwner(ownerId, IPC_CHANNELS.TWITCH_EVENTSUB_STATE, { feedId, state }),
    });
    if (!result.ok) ownedFeeds.delete(ownedFeedId);
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.TWITCH_EVENTSUB_STOP, async (event, payload: unknown) => {
    if (!isAllowedSender(event)) return false;
    const parsed = stopSchema.safeParse(payload);
    if (!parsed.success) return false;
    const ownedFeedId = `${event.sender.id}:${parsed.data.feedId}`;
    ownedFeeds.delete(ownedFeedId);
    eventSub.stop(ownedFeedId);
    return true;
  });
}

import type { BrowserWindow } from "electron";

import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";
import { z } from "zod";

import {
  type TwitchApiService,
  twitchApiService,
} from "@/backend/api/platforms/twitch/twitch-api-service";
import {
  type TwitchEventSubFeedService,
  twitchEventSubFeedService,
} from "@/backend/services/twitch-eventsub-feed-service";
import { IPC_CHANNELS } from "@/shared/ipc-channels";
import type { TwitchApiCommand, TwitchApiResult } from "@/shared/twitch-api-types";

import { isAllowedSender } from "../sender-origin";

// Twitch pagination cursors are opaque and have no documented size limit.
// Keep a finite IPC boundary without coupling validation to one observed cursor.
const TWITCH_USER_EMOTE_CURSOR_MAX_LENGTH = 8 * 1024;

const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("get-global-emotes") }).strict(),
  z
    .object({
      operation: z.literal("get-channel-emotes"),
      broadcasterId: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({
      operation: z.literal("get-emote-set"),
      emoteSetId: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      operation: z.literal("get-user-emotes"),
      userId: z.string().trim().min(1).max(64),
      after: z.string().max(TWITCH_USER_EMOTE_CURSOR_MAX_LENGTH).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("get-users"),
      userIds: z.array(z.string().trim().min(1).max(64)).min(1).max(100),
    })
    .strict(),
  z
    .object({
      operation: z.literal("resolve-channel"),
      login: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({
      operation: z.literal("get-moderated-channels"),
      userId: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({
      operation: z.literal("get-chat-settings"),
      broadcasterId: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({
      operation: z.literal("get-banned-users"),
      broadcasterId: z.string().trim().min(1).max(64),
      cursor: z.string().max(512).optional(),
      userId: z.string().max(64).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("get-moderators"),
      broadcasterId: z.string().trim().min(1).max(64),
      userId: z.string().max(64).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("get-vips"),
      broadcasterId: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({
      operation: z.literal("get-unban-requests"),
      broadcasterId: z.string().trim().min(1).max(64),
      moderatorId: z.string().trim().min(1).max(64),
      status: z.enum(["pending", "approved", "denied", "acknowledged", "canceled"]),
      userId: z.string().max(64).optional(),
      after: z.string().max(512).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.enum(["get-polls", "get-predictions"]),
      broadcasterId: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({
      operation: z.literal("create-poll"),
      broadcasterId: z.string().trim().min(1).max(64),
      title: z.string().trim().min(1).max(60),
      choices: z.array(z.string().trim().min(1).max(25)).min(2).max(5),
      duration: z.number().int().min(15).max(1800),
    })
    .strict(),
  z
    .object({
      operation: z.literal("end-poll"),
      broadcasterId: z.string().trim().min(1).max(64),
      pollId: z.string().trim().min(1).max(128),
      status: z.enum(["TERMINATED", "ARCHIVED"]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("create-prediction"),
      broadcasterId: z.string().trim().min(1).max(64),
      title: z.string().trim().min(1).max(45),
      outcomes: z.array(z.string().trim().min(1).max(25)).min(2).max(10),
      predictionWindow: z.number().int().min(1).max(1800),
    })
    .strict(),
  z
    .object({
      operation: z.literal("end-prediction"),
      broadcasterId: z.string().trim().min(1).max(64),
      predictionId: z.string().trim().min(1).max(128),
      status: z.enum(["LOCKED", "RESOLVED", "CANCELED"]),
      winningOutcomeId: z.string().trim().min(1).max(128).optional(),
    })
    .strict()
    .refine((value) => value.status !== "RESOLVED" || value.winningOutcomeId !== undefined),
  z
    .object({
      operation: z.literal("ban-user"),
      broadcasterId: z.string().trim().min(1).max(64),
      moderatorId: z.string().trim().min(1).max(64),
      userId: z.string().trim().min(1).max(64),
      reason: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("warn-user"),
      broadcasterId: z.string().trim().min(1).max(64),
      moderatorId: z.string().trim().min(1).max(64),
      userId: z.string().trim().min(1).max(64),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      operation: z.literal("clear-chat"),
      broadcasterId: z.string().trim().min(1).max(64),
      moderatorId: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({
      operation: z.literal("set-shield-mode"),
      broadcasterId: z.string().trim().min(1).max(64),
      moderatorId: z.string().trim().min(1).max(64),
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("start-raid"),
      fromBroadcasterId: z.string().trim().min(1).max(64),
      toBroadcasterId: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({
      operation: z.literal("run-commercial"),
      broadcasterId: z.string().trim().min(1).max(64),
      length: z.union([
        z.literal(30),
        z.literal(60),
        z.literal(90),
        z.literal(120),
        z.literal(150),
        z.literal(180),
      ]),
    })
    .strict(),
  z
    .object({
      operation: z.enum(["pin-message", "update-pin"]),
      broadcasterId: z.string().trim().min(1).max(64),
      moderatorId: z.string().trim().min(1).max(64),
      messageId: z.string().trim().min(1).max(256),
      durationSeconds: z.number().int().min(30).max(1800).nullable(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("unpin-message"),
      broadcasterId: z.string().trim().min(1).max(64),
      moderatorId: z.string().trim().min(1).max(64),
      messageId: z.string().trim().min(1).max(256),
    })
    .strict(),
  z
    .object({
      operation: z.literal("delete-chat-message"),
      broadcasterId: z.string().trim().min(1).max(64),
      moderatorId: z.string().trim().min(1).max(64),
      messageId: z.string().trim().min(1).max(256),
    })
    .strict(),
  z
    .object({
      operation: z.literal("update-chat-settings"),
      broadcasterId: z.string().trim().min(1).max(64),
      moderatorId: z.string().trim().min(1).max(64),
      settings: z
        .object({
          slow_mode: z.boolean().optional(),
          slow_mode_wait_time: z.number().int().nullable().optional(),
          follower_mode: z.boolean().optional(),
          follower_mode_duration: z.number().int().nullable().optional(),
          subscriber_mode: z.boolean().optional(),
          emote_mode: z.boolean().optional(),
          unique_chat_mode: z.boolean().optional(),
          non_moderator_chat_delay: z.boolean().optional(),
          non_moderator_chat_delay_duration: z.number().int().nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("unban-user"),
      broadcasterId: z.string().trim().min(1).max(64),
      moderatorId: z.string().trim().min(1).max(64),
      userId: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({
      operation: z.enum(["add-moderator", "remove-moderator", "add-vip", "remove-vip"]),
      broadcasterId: z.string().trim().min(1).max(64),
      userId: z.string().trim().min(1).max(64),
    })
    .strict(),
  z
    .object({
      operation: z.literal("resolve-unban-request"),
      broadcasterId: z.string().trim().min(1).max(64),
      moderatorId: z.string().trim().min(1).max(64),
      unbanRequestId: z.string().trim().min(1).max(128),
      status: z.enum(["approved", "denied"]),
      resolutionText: z.string().max(500).optional(),
    })
    .strict(),
]);

export function registerTwitchApiHandlers({
  service = twitchApiService,
  eventSub = twitchEventSubFeedService,
  mainWindow,
}: {
  service?: TwitchApiService;
  eventSub?: TwitchEventSubFeedService;
  mainWindow?: BrowserWindow;
} = {}): void {
  ipcMain.handle(
    IPC_CHANNELS.TWITCH_API_EXECUTE,
    async (event, payload: unknown): Promise<TwitchApiResult> => {
      if (!isAllowedSender(event)) {
        return {
          ok: false,
          error: { code: "unauthorized", message: "This Twitch request was not authorized." },
        };
      }
      const parsed = commandSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: { code: "invalid-input", message: "The Twitch request is invalid." },
        };
      }
      return service.execute(parsed.data as TwitchApiCommand);
    }
  );

  const startSchema = z
    .object({
      feedId: z.string().trim().min(1).max(128),
      userId: z.string().trim().min(1).max(64),
      channelId: z.string().trim().min(1).max(64),
    })
    .strict();
  const stopSchema = z.object({ feedId: z.string().trim().min(1).max(128) }).strict();

  ipcMain.handle(IPC_CHANNELS.TWITCH_EVENTSUB_START, async (event, payload: unknown) => {
    if (!isAllowedSender(event)) {
      return {
        ok: false,
        error: { code: "unauthorized", message: "This Twitch request was not authorized." },
      } satisfies TwitchApiResult;
    }
    const parsed = startSchema.safeParse(payload);
    if (!parsed.success || !mainWindow) {
      return {
        ok: false,
        error: { code: "invalid-input", message: "The EventSub request is invalid." },
      } satisfies TwitchApiResult;
    }
    const { feedId, userId, channelId } = parsed.data;
    return eventSub.start({
      feedId,
      userId,
      channelId,
      onEvent: (eventPayload) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.TWITCH_EVENTSUB_EVENT, {
            feedId,
            payload: eventPayload,
          });
        }
      },
      onState: (state) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.TWITCH_EVENTSUB_STATE, { feedId, state });
        }
      },
    });
  });

  ipcMain.handle(IPC_CHANNELS.TWITCH_EVENTSUB_STOP, async (event, payload: unknown) => {
    if (!isAllowedSender(event)) return false;
    const parsed = stopSchema.safeParse(payload);
    if (!parsed.success) return false;
    eventSub.stop(parsed.data.feedId);
    return true;
  });
}

import { app, type IpcMainInvokeEvent } from "electron";

import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";
import { z } from "zod";

import { createKickTimeoutAuthorityAdapter } from "@backend/api/platforms/kick/kick-timeout-authority-adapter";
import { createTwitchTimeoutAuthorityAdapter } from "@backend/api/platforms/twitch/twitch-timeout-authority-adapter";
import { logger } from "@backend/logging/logger";
import { dbService } from "@backend/services/database-service";
import { createTimeoutModerationService } from "@backend/services/moderation/timeout-moderation-service";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { TimeoutSnapshotResult, TimeoutSubmitResult } from "@shared/timeout-moderation-types";

import { isAllowedSender } from "../sender-origin";

const bindingSchema = z
  .object({
    platform: z.enum(["twitch", "kick"]),
    channelId: z.string().trim().min(1).max(128),
    channelSlug: z.string().trim().min(1).max(128),
    targetUserId: z.string().trim().min(1).max(128),
    targetUsername: z.string().trim().min(1).max(128),
    selectedMessageId: z.string().trim().min(1).max(256).optional(),
    action: z.literal("timeout"),
  })
  .strict();

const submitSchema = z
  .object({
    snapshotId: z.string().trim().min(1).max(256),
    duration: z.number().finite(),
    reason: z.string().max(500).optional(),
  })
  .strict();

const defaultService = createTimeoutModerationService({
  adapters: {
    twitch: createTwitchTimeoutAuthorityAdapter(),
    kick: createKickTimeoutAuthorityAdapter(),
  },
  async persistSuccess({ attemptId, binding, actor, duration, reason }) {
    const observedAt = Date.now();
    try {
      dbService.insertModLog({
        platform: binding.platform,
        channelId: binding.channelId,
        channelSlug: binding.channelSlug,
        action: "timeout",
        targetUserId: binding.targetUserId,
        targetUsername: binding.targetUsername,
        moderatorUserId: actor.id,
        moderatorUsername: actor.username ?? actor.id,
        durationSeconds: binding.platform === "kick" ? duration * 60 : duration,
        reason: reason ?? null,
        provenance: "streamfusion-confirmed",
        providerEventId: attemptId,
        occurredAt: observedAt,
        observedAt,
      });
    } catch {
      // The Platform mutation has already succeeded. Never turn a local history
      // write failure into a retryable mutation response, which could replay it.
      logger.warn("IPC:TimeoutModeration", "Timeout succeeded but local history write failed", {
        platform: binding.platform,
        attemptId,
      });
    }
  },
});

interface TimeoutModerationHandlerService {
  createSnapshot(binding: z.infer<typeof bindingSchema>): Promise<TimeoutSnapshotResult>;
  submitTimeout(input: z.infer<typeof submitSchema>): Promise<TimeoutSubmitResult>;
}

async function readWithDevelopmentFixture<T>(
  event: IpcMainInvokeEvent,
  path: readonly string[],
  args: readonly unknown[],
  read: () => Promise<T>
): Promise<T> {
  if (!app.isPackaged) {
    try {
      const search = new URL(event.senderFrame?.url ?? "").search;
      const { getModerationBrowserFixture } =
        await import("@/dev-relay/moderation-browser-fixture-contract");
      const fixture = getModerationBrowserFixture(path, args, search);
      if (fixture.matched) return (await fixture.value) as T;
    } catch {
      // An invalid or absent sender URL cannot opt into a development fixture.
    }
  }
  return read();
}

export function registerTimeoutModerationHandlers(
  service: TimeoutModerationHandlerService = defaultService
): void {
  ipcMain.handle(
    IPC_CHANNELS.MODERATION_TIMEOUT_SNAPSHOT,
    async (event, payload: unknown): Promise<TimeoutSnapshotResult> => {
      if (!isAllowedSender(event)) return { state: "unavailable", reason: "unauthorized" };
      const parsed = bindingSchema.safeParse(payload);
      if (!parsed.success) return { state: "unavailable", reason: "unverifiable" };
      try {
        return await readWithDevelopmentFixture(
          event,
          ["moderation", "createTimeoutSnapshot"],
          [parsed.data],
          () => service.createSnapshot(parsed.data)
        );
      } catch {
        return { state: "unavailable", reason: "unverifiable" };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.MODERATION_TIMEOUT_SUBMIT,
    async (event, payload: unknown): Promise<TimeoutSubmitResult> => {
      if (!isAllowedSender(event)) {
        return {
          state: "failure",
          attemptId: crypto.randomUUID(),
          code: "unauthorized",
          message: "This moderation request was not authorized.",
        };
      }
      const parsed = submitSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          state: "invalid-input",
          field: "duration",
          message: "The timeout request is invalid. Reopen the user dialog and try again.",
        };
      }
      try {
        return await readWithDevelopmentFixture(
          event,
          ["moderation", "submitTimeout"],
          [parsed.data],
          () => service.submitTimeout(parsed.data)
        );
      } catch {
        return {
          state: "failure",
          attemptId: crypto.randomUUID(),
          code: "unknown",
          message: "The timeout could not be completed. Try again.",
        };
      }
    }
  );
}

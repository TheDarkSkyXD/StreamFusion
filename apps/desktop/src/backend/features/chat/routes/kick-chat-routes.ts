/**
 * Kick chat IPC handlers.
 *
 * Bridges renderer-side `kickChatService` calls to the main-only `kick-send-window`
 * module. Keeping these on this side of the boundary prevents the renderer
 * bundle from transitively importing electron / better-sqlite3 via
 * `kick-send-window → channel-endpoints → user-endpoints → kick-auth →
 * storage-service → database-service`.
 *
 * See `mod-log-types.ts` for the same pattern.
 */
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { trustedIpcMain as ipcMain } from "../../../ipc/trusted-ipc-main";
import { logger } from "@backend/logging/logger";
import {
  IPC_CHANNELS,
  type KickSendWindowComposerRetentionChange,
} from "../../../../shared/ipc-channels";
import type {
  KickChatModeRequest,
  KickChatModeUpdate,
  KickModerationResult,
  KickOfficialModerationTarget,
  KickOfficialTimeoutTarget,
} from "../../../../shared/kick-moderation-types";
import { kickAuthService } from "../../authentication/adapters/kick/kick-auth";
import {
  type KickPinMutationResult,
  type KickPinPayload,
  pinKickMessage,
  unpinKickMessage,
} from "../adapters/kick/kick-pin-mutations";
import {
  banKickChatUser,
  deleteKickChatMessage,
  disposeSendWindow,
  ensureSendWindowReady,
  getKickChannelViewerRole,
  releaseSendWindowComposerLeasesForOwner,
  releaseSendWindowForComposer,
  retainSendWindowForComposer,
  sendKickChatMessage,
  type KickChannelViewerRoleResult,
  type KickSendResult,
  type KickWebApiMutationResult,
  timeoutKickChatUser,
  unbanKickChatUser,
} from "../adapters/kick/kick-send-window";
import {
  banKickUserOfficial,
  setKickChatMode,
  timeoutKickUserOfficial,
  unbanKickUserOfficial,
} from "../../moderation/adapters/kick/kick-mod-mutations";
import { isAllowedSender } from "../../../ipc/sender-origin";

const composerLeaseCleanupInstalled = new WeakSet<WebContents>();
const MAX_COMPOSER_LEASE_ID_LENGTH = 128;

function isComposerRetentionChange(value: unknown): value is KickSendWindowComposerRetentionChange {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; leaseId?: unknown };
  return (
    (candidate.kind === "retain" || candidate.kind === "release") &&
    typeof candidate.leaseId === "string" &&
    candidate.leaseId.length > 0 &&
    candidate.leaseId.length <= MAX_COMPOSER_LEASE_ID_LENGTH
  );
}

function installComposerLeaseCleanup(sender: WebContents): void {
  if (composerLeaseCleanupInstalled.has(sender)) return;
  composerLeaseCleanupInstalled.add(sender);
  const releaseOwner = () => releaseSendWindowComposerLeasesForOwner(sender.id);
  sender.on("did-start-loading", releaseOwner);
  sender.on("render-process-gone", releaseOwner);
  sender.on("destroyed", releaseOwner);
}

function rejectedKickWebMutation(message = "Rejected sender origin."): KickWebApiMutationResult {
  return {
    ok: false,
    kind: "unknown",
    status: 0,
    body: "",
    message,
  };
}

function rejectedKickSend(message = "Rejected sender origin."): KickSendResult {
  return { ok: false, kind: "unknown", message };
}

function rejectedKickModeration(message: string, kind: "unauthenticated" | "unknown" = "unknown"): KickModerationResult {
  return { ok: false, kind, message };
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isOptionalShortReason(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= 100);
}

function isOfficialTarget(value: unknown): value is KickOfficialModerationTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  return (
    isPositiveSafeInteger(target.broadcasterUserId) &&
    isPositiveSafeInteger(target.userId) &&
    isOptionalShortReason(target.reason)
  );
}

function isOfficialTimeoutTarget(value: unknown): value is KickOfficialTimeoutTarget {
  const timeoutTarget = value as unknown as { duration?: unknown };
  return (
    isOfficialTarget(value) &&
    typeof timeoutTarget.duration === "number" &&
    Number.isInteger(timeoutTarget.duration) &&
    timeoutTarget.duration >= 1 &&
    timeoutTarget.duration <= 10_080
  );
}

function isModeToggle(value: unknown, amountKey: "seconds" | "minutes"): boolean {
  if (typeof value !== "object" || value === null) return false;
  const toggle = value as Record<string, unknown>;
  const amount = toggle[amountKey];
  return (
    typeof toggle.enabled === "boolean" &&
    (amount === undefined || (typeof amount === "number" && Number.isInteger(amount) && amount >= 0))
  );
}

function isKickChatModeUpdate(value: unknown): value is KickChatModeUpdate {
  if (typeof value !== "object" || value === null) return false;
  const update = value as Record<string, unknown>;
  const entries = [
    ["slowMode", "seconds"],
    ["followersOnly", "minutes"],
  ] as const;
  if (!entries.every(([key, amountKey]) => update[key] === undefined || isModeToggle(update[key], amountKey))) {
    return false;
  }
  for (const key of ["subscribersOnly", "emoteOnly"] as const) {
    const toggle = update[key];
    if (
      toggle !== undefined &&
      (typeof toggle !== "object" || toggle === null || typeof (toggle as { enabled?: unknown }).enabled !== "boolean")
    ) {
      return false;
    }
  }
  return Object.keys(update).every((key) =>
    ["slowMode", "followersOnly", "subscribersOnly", "emoteOnly"].includes(key)
  ) && Object.keys(update).length > 0;
}

function isKickChatModeRequest(value: unknown): value is KickChatModeRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.channelSlug === "string" &&
    request.channelSlug.trim().length > 0 &&
    request.channelSlug.length <= 256 &&
    isKickChatModeUpdate(request.update)
  );
}

async function withMainKickCredential(
  action: string,
  event: IpcMainInvokeEvent,
  valid: () => boolean,
  perform: (accessToken: string) => Promise<KickModerationResult>
): Promise<KickModerationResult> {
  if (!isAllowedSender(event)) {
    logger.warn("IPC:KickChat", "Rejected trusted Kick moderation request from unexpected sender", {
      action,
    });
    return rejectedKickModeration("Rejected sender origin.");
  }
  if (!valid()) {
    logger.warn("IPC:KickChat", "Rejected invalid trusted Kick moderation payload", { action });
    return rejectedKickModeration("Invalid moderation request.");
  }
  if (!(await kickAuthService.ensureValidToken())) {
    return rejectedKickModeration("Kick authentication is required.", "unauthenticated");
  }
  const accessToken = kickAuthService.getAccessToken();
  if (!accessToken) return rejectedKickModeration("Kick authentication is required.", "unauthenticated");

  logger.info("IPC:KickChat", "Trusted Kick moderation requested", { action });
  const result = await perform(accessToken);
  logger[result.ok ? "info" : "warn"](
    "IPC:KickChat",
    result.ok ? "Trusted Kick moderation succeeded" : "Trusted Kick moderation failed",
    { action, kind: result.ok ? "ok" : result.kind }
  );
  return result;
}

export function registerKickChatHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_SET_SEND_WINDOW_COMPOSER_RETENTION,
    (event, change: unknown): void => {
      if (!isAllowedSender(event) || !isComposerRetentionChange(change)) return;
      installComposerLeaseCleanup(event.sender);
      if (change.kind === "retain") {
        retainSendWindowForComposer(event.sender.id, change.leaseId);
      } else {
        releaseSendWindowForComposer(event.sender.id, change.leaseId);
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.KICK_CHAT_ENSURE_SEND_WINDOW_READY, async (): Promise<void> => {
    await ensureSendWindowReady();
  });

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE,
    async (
      event,
      payload: { chatroomId: number; content: string; channelSlug?: string }
    ): Promise<KickSendResult> => {
      if (!isAllowedSender(event)) {
        logger.warn("IPC:KickChat", "Rejected Kick chat send from unexpected sender", {
          chatroomId: payload.chatroomId,
        });
        return rejectedKickSend();
      }
      return sendKickChatMessage(payload.chatroomId, payload.content, payload.channelSlug);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_BAN_USER,
    async (
      event,
      payload: { channelSlug: string; username: string }
    ): Promise<KickWebApiMutationResult> => {
      if (!isAllowedSender(event)) {
        logger.warn("IPC:KickChat", "Rejected Kick chat ban request from unexpected sender", {
          channelSlug: payload.channelSlug,
          username: payload.username,
        });
        return rejectedKickWebMutation();
      }
      logger.info("IPC:KickChat", "Kick chat ban requested", {
        channelSlug: payload.channelSlug,
        username: payload.username,
      });
      const result = await banKickChatUser(payload.channelSlug, payload.username);
      logger[result.ok ? "info" : "warn"](
        "IPC:KickChat",
        result.ok ? "Kick chat ban succeeded" : "Kick chat ban failed",
        {
          channelSlug: payload.channelSlug,
          username: payload.username,
          status: result.status,
          kind: result.ok ? "ok" : result.kind,
        }
      );
      return result;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_TIMEOUT_USER,
    async (
      event,
      payload: { channelSlug: string; username: string; duration: number }
    ): Promise<KickWebApiMutationResult> => {
      if (!isAllowedSender(event)) {
        logger.warn("IPC:KickChat", "Rejected Kick chat timeout request from unexpected sender", {
          channelSlug: payload.channelSlug,
          username: payload.username,
          duration: payload.duration,
        });
        return rejectedKickWebMutation();
      }
      logger.info("IPC:KickChat", "Kick chat timeout requested", {
        channelSlug: payload.channelSlug,
        username: payload.username,
        duration: payload.duration,
      });
      const result = await timeoutKickChatUser(
        payload.channelSlug,
        payload.username,
        payload.duration
      );
      logger[result.ok ? "info" : "warn"](
        "IPC:KickChat",
        result.ok ? "Kick chat timeout succeeded" : "Kick chat timeout failed",
        {
          channelSlug: payload.channelSlug,
          username: payload.username,
          duration: payload.duration,
          status: result.status,
          kind: result.ok ? "ok" : result.kind,
        }
      );
      return result;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_UNBAN_USER,
    async (
      event,
      payload: { channelSlug: string; username: string }
    ): Promise<KickWebApiMutationResult> => {
      if (!isAllowedSender(event)) {
        logger.warn("IPC:KickChat", "Rejected Kick chat unban request from unexpected sender", {
          channelSlug: payload.channelSlug,
          username: payload.username,
        });
        return rejectedKickWebMutation();
      }
      logger.info("IPC:KickChat", "Kick chat unban requested", {
        channelSlug: payload.channelSlug,
        username: payload.username,
      });
      const result = await unbanKickChatUser(payload.channelSlug, payload.username);
      logger[result.ok ? "info" : "warn"](
        "IPC:KickChat",
        result.ok ? "Kick chat unban succeeded" : "Kick chat unban failed",
        {
          channelSlug: payload.channelSlug,
          username: payload.username,
          status: result.status,
          kind: result.ok ? "ok" : result.kind,
        }
      );
      return result;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_DELETE_MESSAGE,
    async (
      event,
      payload: { chatroomId: number; messageId: string }
    ): Promise<KickWebApiMutationResult> => {
      if (!isAllowedSender(event)) {
        logger.warn("IPC:KickChat", "Rejected Kick chat delete request from unexpected sender", {
          chatroomId: payload.chatroomId,
          messageId: payload.messageId,
        });
        return rejectedKickWebMutation();
      }
      logger.info("IPC:KickChat", "Kick chat delete requested", {
        chatroomId: payload.chatroomId,
        messageId: payload.messageId,
      });
      const result = await deleteKickChatMessage(payload.chatroomId, payload.messageId);
      logger[result.ok ? "info" : "warn"](
        "IPC:KickChat",
        result.ok ? "Kick chat delete succeeded" : "Kick chat delete failed",
        {
          chatroomId: payload.chatroomId,
          messageId: payload.messageId,
          status: result.status,
          kind: result.ok ? "ok" : result.kind,
        }
      );
      return result;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_GET_VIEWER_ROLE,
    async (event, payload: { channelSlug: string }): Promise<KickChannelViewerRoleResult> => {
      if (!isAllowedSender(event)) {
        logger.warn("IPC:KickChat", "Rejected Kick viewer role request from unexpected sender", {
          channelSlug: payload.channelSlug,
        });
        return {
          ok: false,
          kind: "unknown",
          status: 0,
          message: "Rejected sender origin.",
        };
      }
      return getKickChannelViewerRole(payload.channelSlug);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_PIN_MESSAGE,
    async (event, payload: KickPinPayload): Promise<KickPinMutationResult> => {
      if (!isAllowedSender(event)) {
        return { ok: false, kind: "forbidden", message: "Rejected sender origin." };
      }
      return pinKickMessage(payload);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_UNPIN_MESSAGE,
    async (event, payload: { channelSlug: string }): Promise<KickPinMutationResult> => {
      if (!isAllowedSender(event)) {
        return { ok: false, kind: "forbidden", message: "Rejected sender origin." };
      }
      return unpinKickMessage(payload.channelSlug);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_MODERATE_BAN,
    (event, payload: unknown): Promise<KickModerationResult> =>
      withMainKickCredential("ban", event, () => isOfficialTarget(payload), (accessToken) =>
        banKickUserOfficial({ ...(payload as KickOfficialModerationTarget), accessToken })
      )
  );

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_MODERATE_TIMEOUT,
    (event, payload: unknown): Promise<KickModerationResult> =>
      withMainKickCredential(
        "timeout",
        event,
        () => isOfficialTimeoutTarget(payload),
        (accessToken) => timeoutKickUserOfficial({ ...(payload as KickOfficialTimeoutTarget), accessToken })
      )
  );

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_MODERATE_UNBAN,
    (event, payload: unknown): Promise<KickModerationResult> =>
      withMainKickCredential("unban", event, () => isOfficialTarget(payload), (accessToken) => {
        const { broadcasterUserId, userId } = payload as KickOfficialModerationTarget;
        return unbanKickUserOfficial({ accessToken, broadcasterUserId, userId });
      })
  );

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_SET_MODE,
    (event, payload: unknown): Promise<KickModerationResult> =>
      withMainKickCredential("set-mode", event, () => isKickChatModeRequest(payload), (accessToken) => {
        const request = payload as KickChatModeRequest;
        return setKickChatMode({ ...request, accessToken });
      })
  );

  ipcMain.handle(IPC_CHANNELS.KICK_CHAT_DISPOSE_SEND_WINDOW, async (): Promise<void> => {
    await disposeSendWindow();
  });
}

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
import type { WebContents } from "electron";
import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";
import { logger } from "@backend/logging/logger";
import {
  IPC_CHANNELS,
  type KickSendWindowComposerRetentionChange,
} from "../../../shared/ipc-channels";
import {
  type KickPinMutationResult,
  type KickPinPayload,
  pinKickMessage,
  unpinKickMessage,
} from "../../api/platforms/kick/kick-pin-mutations";
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
} from "../../api/platforms/kick/kick-send-window";
import { isAllowedSender } from "../sender-origin";

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

  ipcMain.handle(IPC_CHANNELS.KICK_CHAT_DISPOSE_SEND_WINDOW, async (): Promise<void> => {
    await disposeSendWindow();
  });
}

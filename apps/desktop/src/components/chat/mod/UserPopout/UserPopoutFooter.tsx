/**
 * UserPopoutFooter (U17)
 *
 * Action footer for the user popout — Timeout / Ban / Unban / Delete plus
 * broadcaster-only Add/Remove Mod, Add/Remove VIP, and a feature-flagged
 * Whisper button. "Open external" sends the operator to twitch.tv / kick.com
 * for the user. Each action opens a popout-local `ModActionConfirmDialog`;
 * the popout itself STAYS OPEN after success (per plan R20) so the operator
 * can chain actions.
 */

import { useState } from "react";
import {
  LuBan,
  LuClock,
  LuExternalLink,
  LuMessageSquare,
  LuRotateCcw,
  LuShieldCheck,
  LuStar,
  LuTrash2,
} from "react-icons/lu";
import { toast } from "sonner";
import {
  addModerator,
  addVip,
  banUser,
  deleteChatMessage,
  removeModerator,
  removeVip,
  timeoutUser,
  unbanUser,
} from "@/backend/api/platforms/twitch/twitch-helix-moderation-mutations";
import {
  ModActionConfirmDialog,
  type ModActionType,
} from "@/components/chat/mod/ModActionConfirmDialog";
import { showModActionSuccessToast } from "@/components/chat/mod/mod-action-toast";
import { TimeoutDurationPicker } from "@/components/chat/mod/TimeoutDurationPicker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { logger } from "@/renderer/logging/logger";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

export interface UserPopoutFooterProps {
  userId: string;
  username: string;
  platform: "twitch" | "kick";
  channelId: string;
  channelSlug: string;
  /** True iff the signed-in user is the broadcaster of `channelId`. Gates
   *  the mod/VIP role mutations. */
  isBroadcaster: boolean;
  /** Latest message id from this user in current chat, if any. Used by
   *  Delete; if null the button is disabled. */
  latestMessageId: string | null;
  /** Kick chatroom id — required for Kick message delete. Twitch ignores. */
  kickChatroomId?: number;
  /** Called after a successful mutation so the parent can re-query mod-log. */
  onActionSuccess?: () => void;
}

type PendingAction =
  | { kind: "timeout" }
  | { kind: "ban" }
  | { kind: "unban" }
  | { kind: "delete" }
  | { kind: "addMod" }
  | { kind: "removeMod" }
  | { kind: "addVip" }
  | { kind: "removeVip" };

const FOOTER_BTN =
  "inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

async function deleteKickMessageViaKickWebSession(chatroomId: number, messageId: string) {
  const result = await window.electronAPI.kickChat.deleteMessage(chatroomId, messageId);
  return kickWebMutationToPopoutResult(result);
}

async function banKickUserViaKickWebSession(channelSlug: string, username: string) {
  const result = await window.electronAPI.kickChat.banUser(channelSlug, username);
  return kickWebMutationToPopoutResult(result);
}

async function timeoutKickUserViaKickWebSession(
  channelSlug: string,
  username: string,
  duration: number
) {
  const result = await window.electronAPI.kickChat.timeoutUser(channelSlug, username, duration);
  return kickWebMutationToPopoutResult(result);
}

async function unbanKickUserViaKickWebSession(channelSlug: string, username: string) {
  const result = await window.electronAPI.kickChat.unbanUser(channelSlug, username);
  return kickWebMutationToPopoutResult(result);
}

function kickWebMutationToPopoutResult(
  result: Awaited<ReturnType<typeof window.electronAPI.kickChat.deleteMessage>>
) {
  if (result.ok) {
    return { ok: true as const };
  }

  return {
    ok: false as const,
    message: result.status ? `${result.status}` : result.message,
  };
}

export function UserPopoutFooter({
  userId,
  username,
  platform,
  channelId,
  channelSlug,
  isBroadcaster,
  latestMessageId,
  kickChatroomId,
  onActionSuccess,
}: UserPopoutFooterProps) {
  const showWhisper = useDevModOverrideStore((s) => s.showWhisper);
  const twitchUser = useAuthStore((s) => s.twitchUser);
  const setTwitchChannelModState = useModeratedChannelsStore((s) => s.setTwitchChannelModState);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  const externalUrl =
    platform === "twitch" ? `https://twitch.tv/${username}` : `https://kick.com/${username}`;

  const handleConfirm = async (extraData?: unknown) => {
    if (!pending) return;
    setBusy(true);
    try {
      if (platform === "twitch") {
        const token = await window.electronAPI.auth.getToken("twitch");
        const clientId = import.meta.env.VITE_TWITCH_CLIENT_ID;
        if (!token?.accessToken || !clientId) {
          toast.error("Sign in to Twitch to take this action");
          return;
        }
        // Most Twitch endpoints want { broadcasterId, moderatorId } — moderatorId
        // is the operator's own user id; for broadcaster-only actions we use
        // channelId. The footer only fires broadcaster-only mutations when
        // `isBroadcaster=true`, so we can safely use channelId as moderatorId.
        const ctx = {
          accessToken: token.accessToken,
          clientId,
          broadcasterId: channelId,
          moderatorId: channelId,
        };
        switch (pending.kind) {
          case "ban": {
            const r = await banUser({ ...ctx, userId });
            if (r.ok) {
              showModActionSuccessToast(`Banned ${username}`);
              setPending(null);
              onActionSuccess?.();
            } else {
              toast.error("Ban failed", { description: r.message });
            }
            break;
          }
          case "timeout": {
            const seconds =
              (extraData as { durationSeconds?: number } | undefined)?.durationSeconds ?? 600;
            const r = await timeoutUser({ ...ctx, userId, durationSeconds: seconds });
            if (r.ok) {
              showModActionSuccessToast(`Timed out ${username}`);
              setPending(null);
              onActionSuccess?.();
            } else {
              toast.error("Timeout failed", { description: r.message });
            }
            break;
          }
          case "unban": {
            const r = await unbanUser({ ...ctx, userId });
            if (r.ok) {
              toast.success(`Unbanned ${username}`);
              setPending(null);
              onActionSuccess?.();
            } else {
              toast.error("Unban failed", { description: r.message });
            }
            break;
          }
          case "delete": {
            if (!latestMessageId) {
              toast.error("No recent message to delete");
              return;
            }
            const r = await deleteChatMessage({
              ...ctx,
              messageId: latestMessageId,
            });
            if (r.ok) {
              showModActionSuccessToast("Deleted message");
              setPending(null);
              onActionSuccess?.();
            } else {
              toast.error("Delete failed", { description: r.message });
            }
            break;
          }
          case "addMod": {
            const r = await addModerator({
              accessToken: token.accessToken,
              clientId,
              broadcasterId: channelId,
              userId,
            });
            if (r.ok) {
              if (userId === twitchUser?.id) {
                setTwitchChannelModState(channelId, true);
              }
              toast.success(`@${username} is now a moderator`);
              setPending(null);
              onActionSuccess?.();
            } else {
              toast.error("Couldn't add moderator", { description: r.message });
            }
            break;
          }
          case "removeMod": {
            const r = await removeModerator({
              accessToken: token.accessToken,
              clientId,
              broadcasterId: channelId,
              userId,
            });
            if (r.ok) {
              if (userId === twitchUser?.id) {
                setTwitchChannelModState(channelId, false);
              }
              toast.success(`@${username} is no longer a moderator`);
              setPending(null);
              onActionSuccess?.();
            } else {
              toast.error("Couldn't remove moderator", { description: r.message });
            }
            break;
          }
          case "addVip": {
            const r = await addVip({
              accessToken: token.accessToken,
              clientId,
              broadcasterId: channelId,
              userId,
            });
            if (r.ok) {
              toast.success(`@${username} is now a VIP`);
              setPending(null);
              onActionSuccess?.();
            } else {
              toast.error("Couldn't add VIP", { description: r.message });
            }
            break;
          }
          case "removeVip": {
            const r = await removeVip({
              accessToken: token.accessToken,
              clientId,
              broadcasterId: channelId,
              userId,
            });
            if (r.ok) {
              toast.success(`@${username} is no longer a VIP`);
              setPending(null);
              onActionSuccess?.();
            } else {
              toast.error("Couldn't remove VIP", { description: r.message });
            }
            break;
          }
        }
      } else {
        // Kick — ban / timeout / unban / delete are the only supported actions.
        const slug = channelSlug;
        switch (pending.kind) {
          case "ban": {
            const r = await banKickUserViaKickWebSession(slug, username);
            if (r.ok) {
              showModActionSuccessToast(`Banned ${username}`);
              setPending(null);
              onActionSuccess?.();
            } else {
              toast.error("Ban failed", { description: r.message });
            }
            break;
          }
          case "timeout": {
            const seconds =
              (extraData as { durationSeconds?: number } | undefined)?.durationSeconds ?? 600;
            const r = await timeoutKickUserViaKickWebSession(
              slug,
              username,
              // Kick wants minutes per kick-mod-mutations.ts inline doc.
              Math.max(1, Math.ceil(seconds / 60))
            );
            if (r.ok) {
              showModActionSuccessToast(`Timed out ${username}`);
              setPending(null);
              onActionSuccess?.();
            } else {
              toast.error("Timeout failed", { description: r.message });
            }
            break;
          }
          case "unban": {
            const r = await unbanKickUserViaKickWebSession(slug, username);
            if (r.ok) {
              toast.success(`Unbanned ${username}`);
              setPending(null);
              onActionSuccess?.();
            } else {
              toast.error("Unban failed", { description: r.message });
            }
            break;
          }
          case "delete": {
            if (!latestMessageId || !kickChatroomId) {
              toast.error("No recent message to delete");
              return;
            }
            const r = await deleteKickMessageViaKickWebSession(kickChatroomId, latestMessageId);
            if (r.ok) {
              showModActionSuccessToast("Deleted message");
              setPending(null);
              onActionSuccess?.();
            } else {
              toast.error("Delete failed", { description: r.message });
            }
            break;
          }
          // Mod/VIP/whisper not applicable on Kick — buttons are hidden.
          default:
            break;
        }
      }
    } catch (err) {
      toast.error("Action failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleWhisper = () => {
    // Plan defers actual whisper-send — the button just surfaces a toast.
    logger.warn("UI:Chat:Mod:PopoutFooter", "whisper not implemented");
    toast.info("Whisper isn't wired yet");
  };

  const targetPreview = (
    <div className="text-sm">
      <span className="font-medium text-white">@{username}</span>
    </div>
  );

  const pendingActionType: ModActionType | null = pending?.kind ?? null;
  const deleteTooltip = latestMessageId
    ? "Delete this user's latest message"
    : "No recent message in chat to delete";

  return (
    <div data-testid="user-popout-footer">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={FOOTER_BTN}
          onClick={() => setPending({ kind: "timeout" })}
          aria-label="Timeout user"
        >
          <LuClock className="w-3.5 h-3.5" />
          Timeout
        </button>
        <button
          type="button"
          className={FOOTER_BTN}
          onClick={() => setPending({ kind: "ban" })}
          aria-label="Ban user"
        >
          <LuBan className="w-3.5 h-3.5" />
          Ban
        </button>
        <button
          type="button"
          className={FOOTER_BTN}
          onClick={() => setPending({ kind: "unban" })}
          aria-label="Unban user"
        >
          <LuRotateCcw className="w-3.5 h-3.5" />
          Unban
        </button>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <button
                type="button"
                className={FOOTER_BTN}
                disabled={!latestMessageId}
                onClick={() => setPending({ kind: "delete" })}
                aria-label="Delete most recent message"
              >
                <LuTrash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{deleteTooltip}</TooltipContent>
        </Tooltip>
        {isBroadcaster && platform === "twitch" ? (
          <>
            <button
              type="button"
              className={FOOTER_BTN}
              onClick={() => setPending({ kind: "addMod" })}
              aria-label="Add moderator"
            >
              <LuShieldCheck className="w-3.5 h-3.5" />
              Add mod
            </button>
            <button
              type="button"
              className={FOOTER_BTN}
              onClick={() => setPending({ kind: "removeMod" })}
              aria-label="Remove moderator"
            >
              <LuShieldCheck className="w-3.5 h-3.5" />
              Remove mod
            </button>
            <button
              type="button"
              className={FOOTER_BTN}
              onClick={() => setPending({ kind: "addVip" })}
              aria-label="Add VIP"
            >
              <LuStar className="w-3.5 h-3.5" />
              Add VIP
            </button>
            <button
              type="button"
              className={FOOTER_BTN}
              onClick={() => setPending({ kind: "removeVip" })}
              aria-label="Remove VIP"
            >
              <LuStar className="w-3.5 h-3.5" />
              Remove VIP
            </button>
          </>
        ) : null}
        {platform === "twitch" && showWhisper ? (
          <button
            type="button"
            className={FOOTER_BTN}
            onClick={handleWhisper}
            aria-label="Whisper user"
            data-testid="user-popout-footer-whisper"
          >
            <LuMessageSquare className="w-3.5 h-3.5" />
            Whisper
          </button>
        ) : null}
        <button
          type="button"
          className={FOOTER_BTN}
          onClick={() => window.electronAPI?.openExternal(externalUrl)}
          aria-label="Open external profile"
          data-testid="user-popout-footer-external"
        >
          <LuExternalLink className="w-3.5 h-3.5" />
          Open
        </button>
      </div>

      {pendingActionType ? (
        <ModActionConfirmDialog
          open={pending !== null}
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          actionType={pendingActionType}
          targetPreview={targetPreview}
          busy={busy}
          extraSlot={
            pendingActionType === "timeout"
              ? ({ onDataChange, disabled }) => (
                  <TimeoutDurationPicker
                    disabled={disabled}
                    onChange={(s) => onDataChange({ durationSeconds: s })}
                  />
                )
              : undefined
          }
          onConfirm={handleConfirm}
        />
      ) : null}
    </div>
  );
}

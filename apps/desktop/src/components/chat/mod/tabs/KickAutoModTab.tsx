/**
 * U21 — Kick custom AutoMod tab.
 *
 * Wires the renderer-side filter to the chat service:
 *  1. Reads the per-channel `KickAutomodConfig` via `useKickAutoModConfig`.
 *  2. Installs an interceptor on `kickChatService` (opt-in setter) that calls
 *     `evaluate(message, config)` for each incoming message. Held messages
 *     are pushed into `useKickAutoModQueueStore` and never reach chat-store.
 *  3. Renders the held queue with four actions:
 *      - Approve: release the parsed `ChatMessage` into chat-store + drop.
 *      - Deny: drop without releasing.
 *      - Allow + Allow-list: release + add sender userId to allow-list.
 *      - Approve + Timeout: opens timeout dialog → release + timeoutKickUser.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { evaluate } from "@/backend/api/platforms/kick/kick-automod-filter";
import { timeoutKickUser } from "@/backend/api/platforms/kick/kick-mod-mutations";
import { kickChatService } from "@/backend/services/chat/kick-chat";
import { useChatStore } from "@/store/chat-store";
import {
  type KickHeldMessage,
  useKickAutoModQueueStore,
} from "@/store/kick-automod-queue";

import { useAutoModAlerts } from "@/hooks/useAutoModAlerts";
import { useKickAutoModConfig } from "@/hooks/useKickAutoModConfig";

import { ModActionConfirmDialog } from "../ModActionConfirmDialog";
import { TimeoutDurationPicker } from "../TimeoutDurationPicker";
import { useOpenUserPopout } from "../UserPopout/UserPopoutProvider";

export interface KickAutoModTabProps {
  channelId: string;
  channelSlug: string;
  chatroomId: number;
}

export function KickAutoModTab({
  channelId,
  channelSlug,
  chatroomId,
}: KickAutoModTabProps) {
  const { config, addAllowlistUser } = useKickAutoModConfig(channelId);
  const add = useKickAutoModQueueStore((s) => s.add);
  const remove = useKickAutoModQueueStore((s) => s.remove);
  const byKey = useKickAutoModQueueStore((s) => s.byKey);

  const addToChat = useChatStore((s) => s.addMessage);
  const openUserPopout = useOpenUserPopout();

  const [pendingTimeoutFor, setPendingTimeoutFor] =
    useState<KickHeldMessage | null>(null);
  const [timeoutBusy, setTimeoutBusy] = useState(false);

  // Install / refresh the interceptor whenever the active config changes.
  useEffect(() => {
    kickChatService.setAutomodInterceptor((message) => {
      if (message.platform !== "kick" || message.channel !== channelSlug) {
        return false;
      }
      const verdict = evaluate(
        { senderUserId: message.userId, text: message.rawContent ?? "" },
        config,
      );
      if (!verdict.held) return false;
      add({
        messageId: message.id,
        channelSlug,
        chatroomId,
        senderUserId: message.userId,
        senderUsername: message.username,
        rawText: message.rawContent ?? "",
        category: verdict.category,
        matchedKeyword: verdict.matchedKeyword,
        parsedMessage: message,
        heldAt: Date.now(),
      });
      return true;
    });

    return () => {
      kickChatService.setAutomodInterceptor(null);
    };
  }, [channelSlug, chatroomId, config, add]);

  const held = useMemo(() => {
    const out: KickHeldMessage[] = [];
    for (const v of byKey.values()) {
      if (v.channelSlug === channelSlug) out.push(v);
    }
    out.sort((a, b) => a.heldAt - b.heldAt);
    return out;
  }, [byKey, channelSlug]);

  // U23 — alert pipeline. Kick keys the queue by channelSlug, so we pass
  // that as the alert "channelId". Approve releases the parsed message into
  // chat-store; Deny just drops it. Both reuse the same handlers as the
  // inline action buttons below.
  useAutoModAlerts({
    platform: "kick",
    channelId: channelSlug,
    channelName: channelSlug,
    onApprove: (messageId) => {
      const entry = useKickAutoModQueueStore.getState().byKey.get(
        `${channelSlug}:${messageId}`,
      );
      if (entry) handleApprove(entry);
    },
    onDeny: (messageId) => {
      const entry = useKickAutoModQueueStore.getState().byKey.get(
        `${channelSlug}:${messageId}`,
      );
      if (entry) handleDeny(entry);
    },
  });

  function handleApprove(m: KickHeldMessage): void {
    addToChat(m.parsedMessage);
    remove(m.channelSlug, m.messageId);
    toast.success(`Approved message from ${m.senderUsername}`);
  }

  function handleDeny(m: KickHeldMessage): void {
    remove(m.channelSlug, m.messageId);
    toast.success(`Denied message from ${m.senderUsername}`);
  }

  function handleAllowAndAllowlist(m: KickHeldMessage): void {
    addToChat(m.parsedMessage);
    addAllowlistUser(m.senderUserId);
    remove(m.channelSlug, m.messageId);
    toast.success(`${m.senderUsername} approved + allow-listed`);
  }

  async function handleApproveAndTimeoutConfirm(
    m: KickHeldMessage,
    durationSeconds: number,
  ): Promise<void> {
    const token = await window.electronAPI.auth.getToken("kick");
    if (!token?.accessToken) {
      toast.error("Not signed in to Kick");
      return;
    }
    setTimeoutBusy(true);
    try {
      // Kick's API takes minutes. Convert from the picker's seconds (round up).
      const durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
      const result = await timeoutKickUser({
        channelSlug: m.channelSlug,
        username: m.senderUsername,
        duration: durationMinutes,
        accessToken: token.accessToken,
      });
      if (result.ok) {
        addToChat(m.parsedMessage);
        remove(m.channelSlug, m.messageId);
        setPendingTimeoutFor(null);
        toast.success(`Approved + timed out ${m.senderUsername}`);
      } else {
        toast.error("Timeout failed");
      }
    } finally {
      setTimeoutBusy(false);
    }
  }

  if (held.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-400">
        No held messages right now.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-y-auto p-2 gap-2">
      {held.map((m) => (
        <div
          key={`${m.channelSlug}:${m.messageId}`}
          data-testid="kick-automod-row"
          data-message-id={m.messageId}
          className="border border-[var(--color-border)] rounded p-2 bg-white/5"
        >
          <div className="flex items-center gap-2 text-xs mb-1">
            <button
              type="button"
              onClick={() =>
                openUserPopout({
                  userId: m.senderUserId,
                  username: m.senderUsername,
                  platform: "kick",
                  channelId,
                  channelSlug,
                  kickChatroomId: chatroomId,
                })
              }
              className="text-green-300 hover:underline font-medium"
            >
              {m.senderUsername}
            </button>
            <span
              className="rounded bg-red-500/30 text-red-200 px-1.5 py-0.5"
              data-testid="kick-automod-category"
            >
              {m.category} · {m.matchedKeyword}
            </span>
          </div>
          <div className="text-sm text-white break-words mb-2">{m.rawText}</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleApprove(m)}
              data-testid="kick-automod-approve"
              className="text-xs bg-green-600/70 hover:bg-green-600 text-white rounded px-2 py-1"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => handleDeny(m)}
              data-testid="kick-automod-deny"
              className="text-xs bg-red-600/70 hover:bg-red-600 text-white rounded px-2 py-1"
            >
              Deny
            </button>
            <button
              type="button"
              onClick={() => handleAllowAndAllowlist(m)}
              data-testid="kick-automod-allow-allowlist"
              className="text-xs bg-blue-600/70 hover:bg-blue-600 text-white rounded px-2 py-1"
            >
              Allow + Allow-list
            </button>
            <button
              type="button"
              onClick={() => setPendingTimeoutFor(m)}
              data-testid="kick-automod-approve-timeout"
              className="text-xs bg-yellow-600/70 hover:bg-yellow-600 text-white rounded px-2 py-1"
            >
              Approve + Timeout
            </button>
          </div>
        </div>
      ))}

      {pendingTimeoutFor ? (
        <ModActionConfirmDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setPendingTimeoutFor(null);
          }}
          actionType="timeout"
          targetPreview={
            <>
              Approve and timeout{" "}
              <span className="font-medium">
                {pendingTimeoutFor.senderUsername}
              </span>
            </>
          }
          busy={timeoutBusy}
          extraSlot={({ onDataChange, disabled }) => (
            <TimeoutDurationPicker
              disabled={disabled}
              onChange={(seconds) => onDataChange({ durationSeconds: seconds })}
            />
          )}
          onConfirm={(extra) => {
            const data = (extra as { durationSeconds?: number } | undefined) ??
              undefined;
            const dur = data?.durationSeconds ?? 600;
            return handleApproveAndTimeoutConfirm(pendingTimeoutFor, dur);
          }}
        />
      ) : null}
    </div>
  );
}

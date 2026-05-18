/**
 * U20 — Twitch AutoMod tab.
 *
 * Subscribes to `automod.message.hold` via `useTwitchEventSub` (U8) and
 * surfaces the held messages with four moderator actions: Approve, Deny,
 * Approve+Allow-list, and Approve-and-timeout.
 *
 * Held messages live in `useAutoModQueueStore` keyed by `(channelId,
 * messageId)`. Actions hit Twitch Helix (`/moderation/automod/message`,
 * `/moderation/automod/permitted`) directly — the helpers are inline because
 * they're U20-specific and don't belong in the shared mutations file.
 *
 * Backfill of past holds is intentionally out of scope (decision in the
 * dispatch brief): once the tab mounts, only new holds appear.
 */

import { useState } from "react";
import { toast } from "sonner";

import type {
  AutomodMessageHoldEvent,
  NotificationPayload,
} from "@/backend/api/platforms/twitch/twitch-eventsub-types";
import { timeoutUser } from "@/backend/api/platforms/twitch/twitch-helix-moderation-mutations";
import { useAutoModAlerts } from "@/hooks/useAutoModAlerts";
import { useTwitchEventSub } from "@/hooks/useTwitchEventSub";
import { useAuthStore } from "@/store/auth-store";
import {
  type TwitchAutoModHeldMessage,
  useAutoModQueueStore,
} from "@/store/automod-queue-store";

import { ModActionConfirmDialog } from "../ModActionConfirmDialog";
import { TimeoutDurationPicker } from "../TimeoutDurationPicker";
import { useOpenUserPopout } from "../UserPopout/UserPopoutProvider";

// Twitch's documented Client-Id used by the rest of the renderer-side
// Helix calls. Duplicated here to keep U20 self-contained.
const HELIX_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";

export interface TwitchAutoModTabProps {
  channelId: string;
  /** Optional human-readable channel name used in alert copy. Falls back to
   *  the channelId so the toast / OS notif still identify the source. */
  channelName?: string;
}

interface ManageAutoModMessageArgs {
  accessToken: string;
  moderatorId: string;
  messageId: string;
  action: "ALLOW" | "DENY";
}

/** POST /helix/moderation/automod/message. Resolves to true on a 2xx. */
async function manageAutoModMessage(
  args: ManageAutoModMessageArgs,
): Promise<boolean> {
  try {
    const res = await fetch(
      "https://api.twitch.tv/helix/moderation/automod/message",
      {
        method: "POST",
        headers: {
          "Client-Id": HELIX_CLIENT_ID,
          Authorization: `Bearer ${args.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: args.moderatorId,
          msg_id: args.messageId,
          action: args.action,
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

interface AddAutoModPermittedUserArgs {
  accessToken: string;
  broadcasterId: string;
  moderatorId: string;
  userId: string;
}

/** POST /helix/moderation/automod/permitted — adds sender to allow-list. */
async function addAutoModPermittedUser(
  args: AddAutoModPermittedUserArgs,
): Promise<boolean> {
  try {
    const res = await fetch(
      "https://api.twitch.tv/helix/moderation/automod/permitted",
      {
        method: "POST",
        headers: {
          "Client-Id": HELIX_CLIENT_ID,
          Authorization: `Bearer ${args.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          broadcaster_id: args.broadcasterId,
          moderator_id: args.moderatorId,
          user_id: args.userId,
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export function TwitchAutoModTab({
  channelId,
  channelName,
}: TwitchAutoModTabProps) {
  const add = useAutoModQueueStore((s) => s.add);
  const remove = useAutoModQueueStore((s) => s.remove);
  const byKey = useAutoModQueueStore((s) => s.byKey);
  const twitchUser = useAuthStore((s) => s.twitchUser);
  const openUserPopout = useOpenUserPopout();

  const [pendingTimeoutFor, setPendingTimeoutFor] =
    useState<TwitchAutoModHeldMessage | null>(null);
  const [timeoutBusy, setTimeoutBusy] = useState(false);

  // Subscribe to AutoMod holds for this channel.
  useTwitchEventSub<AutomodMessageHoldEvent>(
    "automod.message.hold",
    channelId,
    (payload: NotificationPayload<AutomodMessageHoldEvent>) => {
      const e = payload.event;
      add({
        messageId: e.message_id,
        channelId: e.broadcaster_user_id,
        username: e.user_login,
        userId: e.user_id,
        rawText: e.message.text,
        category: e.category,
        level: e.level,
        fragments: e.message.fragments?.map((f) => ({
          type: f.type,
          text: f.text,
        })),
        heldAt: Date.parse(e.held_at) || Date.now(),
      });
    },
  );

  // Re-derive the per-channel list reactively.
  const held: TwitchAutoModHeldMessage[] = [];
  for (const v of byKey.values()) {
    if (v.channelId === channelId) held.push(v);
  }
  held.sort((a, b) => a.heldAt - b.heldAt);

  // U23 — alert pipeline. Toast (+ Approve/Deny buttons) + opt-in OS notif.
  // The Approve/Deny callbacks resolve the latest entry by id at click-time
  // so the toast keeps working even if the store mutates between fire and
  // click. The actual Helix call reuses the same handlers as the inline UI.
  useAutoModAlerts({
    platform: "twitch",
    channelId,
    channelName: channelName ?? channelId,
    onApprove: (messageId) => {
      const entry = useAutoModQueueStore.getState().byKey.get(
        `${channelId}:${messageId}`,
      );
      if (entry) void handleApprove(entry);
    },
    onDeny: (messageId) => {
      const entry = useAutoModQueueStore.getState().byKey.get(
        `${channelId}:${messageId}`,
      );
      if (entry) void handleDeny(entry);
    },
  });

  async function getModCredentials(): Promise<{
    accessToken: string;
    moderatorId: string;
  } | null> {
    const token = await window.electronAPI.auth.getToken("twitch");
    if (!token?.accessToken || !twitchUser?.id) {
      return null;
    }
    return { accessToken: token.accessToken, moderatorId: twitchUser.id };
  }

  async function handleApprove(m: TwitchAutoModHeldMessage): Promise<void> {
    const creds = await getModCredentials();
    if (!creds) {
      toast.error("Not signed in to Twitch");
      return;
    }
    const ok = await manageAutoModMessage({
      ...creds,
      messageId: m.messageId,
      action: "ALLOW",
    });
    if (ok) {
      remove(m.channelId, m.messageId);
      toast.success(`Approved message from ${m.username}`);
    } else {
      toast.error("Approve failed");
    }
  }

  async function handleDeny(m: TwitchAutoModHeldMessage): Promise<void> {
    const creds = await getModCredentials();
    if (!creds) {
      toast.error("Not signed in to Twitch");
      return;
    }
    const ok = await manageAutoModMessage({
      ...creds,
      messageId: m.messageId,
      action: "DENY",
    });
    if (ok) {
      remove(m.channelId, m.messageId);
      toast.success(`Denied message from ${m.username}`);
    } else {
      toast.error("Deny failed");
    }
  }

  async function handleAllowAndAllowlist(
    m: TwitchAutoModHeldMessage,
  ): Promise<void> {
    const creds = await getModCredentials();
    if (!creds) {
      toast.error("Not signed in to Twitch");
      return;
    }
    const approved = await manageAutoModMessage({
      ...creds,
      messageId: m.messageId,
      action: "ALLOW",
    });
    if (!approved) {
      toast.error("Approve failed");
      return;
    }
    const allowed = await addAutoModPermittedUser({
      accessToken: creds.accessToken,
      broadcasterId: m.channelId,
      moderatorId: creds.moderatorId,
      userId: m.userId,
    });
    if (!allowed) {
      toast.error("Approve succeeded but allow-listing failed");
      remove(m.channelId, m.messageId);
      return;
    }
    remove(m.channelId, m.messageId);
    toast.success(`${m.username} approved + added to allow-list`);
  }

  async function handleApproveAndTimeoutConfirm(
    m: TwitchAutoModHeldMessage,
    durationSeconds: number,
  ): Promise<void> {
    const creds = await getModCredentials();
    if (!creds) {
      toast.error("Not signed in to Twitch");
      return;
    }
    setTimeoutBusy(true);
    try {
      const approved = await manageAutoModMessage({
        ...creds,
        messageId: m.messageId,
        action: "ALLOW",
      });
      if (!approved) {
        toast.error("Approve failed");
        return;
      }
      const result = await timeoutUser({
        accessToken: creds.accessToken,
        broadcasterId: m.channelId,
        moderatorId: creds.moderatorId,
        userId: m.userId,
        durationSeconds,
      });
      if (result.ok) {
        remove(m.channelId, m.messageId);
        setPendingTimeoutFor(null);
        toast.success(`Approved + timed out ${m.username}`);
      } else {
        toast.error("Approve succeeded but timeout failed");
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
          key={`${m.channelId}:${m.messageId}`}
          data-testid="automod-row"
          data-message-id={m.messageId}
          className="border border-[var(--color-border)] rounded p-2 bg-white/5"
        >
          <div className="flex items-center gap-2 text-xs mb-1">
            <button
              type="button"
              onClick={() =>
                openUserPopout({
                  userId: m.userId,
                  username: m.username,
                  platform: "twitch",
                  channelId: m.channelId,
                  channelSlug: m.username,
                })
              }
              className="text-purple-300 hover:underline font-medium"
            >
              {m.username}
            </button>
            <span
              className="rounded bg-red-500/30 text-red-200 px-1.5 py-0.5"
              data-testid="automod-category"
            >
              {m.category} · L{m.level}
            </span>
          </div>
          <div className="text-sm text-white break-words mb-2">{m.rawText}</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleApprove(m)}
              data-testid="automod-approve"
              className="text-xs bg-green-600/70 hover:bg-green-600 text-white rounded px-2 py-1"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => handleDeny(m)}
              data-testid="automod-deny"
              className="text-xs bg-red-600/70 hover:bg-red-600 text-white rounded px-2 py-1"
            >
              Deny
            </button>
            <button
              type="button"
              onClick={() => handleAllowAndAllowlist(m)}
              data-testid="automod-allow-allowlist"
              className="text-xs bg-blue-600/70 hover:bg-blue-600 text-white rounded px-2 py-1"
            >
              Allow + Allow-list
            </button>
            <button
              type="button"
              onClick={() => setPendingTimeoutFor(m)}
              data-testid="automod-approve-timeout"
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
                {pendingTimeoutFor.username}
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

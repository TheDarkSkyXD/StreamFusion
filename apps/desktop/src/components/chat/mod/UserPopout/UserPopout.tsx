/**
 * UserPopout (U16 + U17)
 *
 * Centered modal opened when an operator clicks a username anywhere in chat.
 * Composes:
 *   - `UserProfileHeader` (avatar, name, badges, dates)
 *   - Recent-messages section (last 10 messages from chat-store)
 *   - `UserModHistory` (scoped mod-log entries)
 *   - `UserPopoutFooter` (Timeout / Ban / Unban / Delete + broadcaster controls)
 *
 * Stays open through action confirms — operators commonly chain actions.
 * Click-outside / Esc behavior is Radix Dialog's default (closes).
 */

import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthStore } from "@/store/auth-store";
import { useChatStore } from "@/store/chat-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

import { UserModHistory } from "./UserModHistory";
import { UserPopoutFooter } from "./UserPopoutFooter";
import { UserProfileHeader } from "./UserProfileHeader";
import { useUserProfile } from "./useUserProfile";

export interface UserPopoutProps {
  userId: string;
  /** Fallback display while the profile loads or 404s. */
  username: string;
  platform: "twitch" | "kick";
  channelId: string;
  channelSlug: string;
  /** Kick chatroom id — required for `deleteKickMessage`. Twitch ignores. */
  kickChatroomId?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RECENT_MESSAGE_LIMIT = 10;

export function UserPopout({
  userId,
  username,
  platform,
  channelId,
  channelSlug,
  kickChatroomId,
  open,
  onOpenChange,
}: UserPopoutProps) {
  const { profile, loading, error } = useUserProfile(
    userId,
    platform,
    channelId,
    username,
    channelSlug,
  );

  const messages = useChatStore((s) => s.messages);
  const recentMessages = useMemo(() => {
    return messages
      .filter(
        (m) =>
          m.type === "message" &&
          (m.userId === userId ||
            (!m.userId && m.username.toLowerCase() === username.toLowerCase())),
      )
      .slice(-RECENT_MESSAGE_LIMIT)
      .reverse();
  }, [messages, userId, username]);

  const latestMessageId = recentMessages[0]?.id ?? null;

  const twitchUser = useAuthStore((s) => s.twitchUser);
  const forceBroadcasterIdentity = useDevModOverrideStore(
    (s) => s.forceBroadcasterIdentity,
  );
  const isBroadcaster =
    platform === "twitch" &&
    (forceBroadcasterIdentity ||
      Boolean(twitchUser && twitchUser.id === channelId));

  // U17 — bump to force the mod-history list to re-query after an action.
  const [refreshCounter, setRefreshCounter] = useState(0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[480px] bg-[#0F0F12] border-[var(--color-border)] p-6 shadow-2xl"
        data-testid="user-popout"
      >
        <DialogHeader className="pb-2">
          <DialogTitle className="sr-only">User profile: {username}</DialogTitle>
          <DialogDescription className="sr-only">
            Profile, recent messages, mod history, and moderation actions for @
            {username}.
          </DialogDescription>
        </DialogHeader>

        {loading && !profile ? (
          <div data-testid="user-popout-skeleton" className="space-y-3">
            <div className="flex gap-4 items-start">
              <div className="w-16 h-16 rounded-full bg-white/10 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-32 bg-white/10 rounded animate-pulse" />
                <div className="h-3 w-20 bg-white/10 rounded animate-pulse" />
                <div className="h-3 w-40 bg-white/10 rounded animate-pulse" />
              </div>
            </div>
            <div className="h-12 bg-white/5 rounded animate-pulse" />
            <div className="h-20 bg-white/5 rounded animate-pulse" />
          </div>
        ) : error === "not-found" || (!profile && !loading) ? (
          <div
            className="py-8 text-center text-sm text-[var(--color-foreground-muted)]"
            data-testid="user-popout-not-found"
          >
            User not found
          </div>
        ) : profile ? (
          <div className="space-y-4">
            <UserProfileHeader profile={profile} platform={platform} />

            <section>
              <h3 className="text-xs uppercase tracking-wide text-[var(--color-foreground-muted)] mb-1.5">
                Recent messages
              </h3>
              {recentMessages.length === 0 ? (
                <div
                  className="text-xs text-[var(--color-foreground-muted)]"
                  data-testid="user-popout-no-recent-messages"
                >
                  No recent messages
                </div>
              ) : (
                <ul
                  className="space-y-1 max-h-32 overflow-y-auto no-scrollbar"
                  data-testid="user-popout-recent-messages"
                >
                  {recentMessages.map((m) => (
                    <li
                      key={m.id}
                      className="text-xs px-2 py-1 rounded bg-white/5 border border-white/5 line-clamp-2 break-words"
                    >
                      {m.rawContent || ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-xs uppercase tracking-wide text-[var(--color-foreground-muted)] mb-1.5">
                Mod history
              </h3>
              <UserModHistory
                channelId={channelId}
                targetUserId={userId}
                refreshCounter={refreshCounter}
              />
            </section>

            <section className="pt-3 border-t border-white/10">
              <UserPopoutFooter
                userId={userId}
                username={profile.username || username}
                platform={platform}
                channelId={channelId}
                channelSlug={channelSlug}
                isBroadcaster={isBroadcaster}
                latestMessageId={latestMessageId}
                kickChatroomId={kickChatroomId}
                onActionSuccess={() => setRefreshCounter((n) => n + 1)}
              />
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

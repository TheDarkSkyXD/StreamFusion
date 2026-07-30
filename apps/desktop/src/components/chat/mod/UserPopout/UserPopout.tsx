import { ExternalLink, MessageSquareText, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChatMessage } from "@/shared/chat-types";
import { buildChannelKey, useChatStore } from "@/store/chat-store";

import { UserProfileHeader } from "./UserProfileHeader";
import { useUserProfile } from "./useUserProfile";

export interface UserPopoutProps {
  userId: string;
  username: string;
  platform: "twitch" | "kick";
  channelId: string;
  channelSlug: string;
  kickChatroomId?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RECENT_MESSAGE_LIMIT = 10;
const EMPTY_MESSAGES: ChatMessage[] = [];

function useCompactDialog(): boolean {
  const [compact, setCompact] = useState(
    () => window.innerWidth <= 640 || window.innerHeight <= 600
  );
  useEffect(() => {
    const update = () => setCompact(window.innerWidth <= 640 || window.innerHeight <= 600);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return compact;
}

export function UserPopout({
  userId,
  username,
  platform,
  channelId,
  channelSlug,
  open,
  onOpenChange,
}: UserPopoutProps) {
  const profileState = useUserProfile(userId, platform, channelId, username, channelSlug);
  const compact = useCompactDialog();
  const { identity, accountCreated, follow, channel } = profileState;
  const channelKey = buildChannelKey(platform, channelSlug);
  const messages = useChatStore((state) => state.messagesByChannel[channelKey] ?? EMPTY_MESSAGES);
  const recentMessages = useMemo(
    () =>
      messages
        .filter(
          (message) =>
            message.type === "message" &&
            (message.userId === userId ||
              (!message.userId && message.username.toLowerCase() === username.toLowerCase()))
        )
        .slice(-RECENT_MESSAGE_LIMIT)
        .reverse(),
    [messages, userId, username]
  );
  const resolvedChannel = channel.state === "known" ? channel.value : null;
  const externalUsername = resolvedChannel?.username ?? username;
  const externalDisplayName = resolvedChannel?.displayName ?? username;
  const platformLabel = platform === "kick" ? "Kick" : "Twitch";
  const externalUrl =
    platform === "kick"
      ? `https://kick.com/${externalUsername}`
      : `https://www.twitch.tv/${externalUsername}`;
  const liveAnnouncement = [
    identity.state === "failed"
      ? "Profile identity could not be verified."
      : identity.state === "unavailable"
        ? "Profile identity is unavailable."
        : "",
    accountCreated.state === "failed"
      ? "Account creation date could not be verified."
      : accountCreated.state === "unavailable"
        ? "Account creation date is unavailable."
        : "",
    follow.state === "reconnect-required" ||
    follow.state === "failed" ||
    follow.state === "unavailable"
      ? "Follow relationship is unavailable."
      : "",
    channel.state === "failed" || channel.state === "unavailable" ? "Channel is unavailable." : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className={`flex w-[calc(100vw-2rem)] max-w-[560px] flex-col gap-0 overflow-hidden border-[var(--color-border)] bg-[#0f0f0f] p-0 shadow-2xl ${
          compact ? "max-h-[calc(100vh-1rem)]" : "max-h-[80vh]"
        }`}
        data-testid="user-popout"
        data-compact={compact ? "true" : "false"}
      >
        <DialogHeader className="shrink-0 border-b border-[var(--color-border)] px-5 py-5 pr-14 text-left">
          <DialogTitle className="sr-only">User profile: {username}</DialogTitle>
          <DialogDescription className="sr-only">
            Public {platformLabel} profile and recent messages for @{username}.
          </DialogDescription>
          <UserProfileHeader
            fallbackUsername={username}
            identity={identity}
            accountCreated={accountCreated}
            follow={follow}
            retryIdentity={profileState.retryIdentity}
            retryAccountCreated={profileState.retryAccountCreated}
            retryFollow={profileState.retryFollow}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogClose className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                <X className="h-5 w-5" aria-hidden />
                <span className="sr-only">Close</span>
              </DialogClose>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </DialogHeader>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {liveAnnouncement}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-testid="user-popout-body">
          <section aria-labelledby="recent-chat-messages-heading">
            <h3
              id="recent-chat-messages-heading"
              className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]"
            >
              <MessageSquareText className="h-4 w-4" aria-hidden />
              Recent messages
            </h3>
            {recentMessages.length === 0 ? (
              <p
                className="text-xs text-[var(--color-foreground-muted)]"
                data-testid="user-popout-no-recent-messages"
              >
                No recent messages
              </p>
            ) : (
              <ul className="space-y-1" data-testid="user-popout-recent-messages">
                {recentMessages.map((message) => (
                  <li
                    key={message.id}
                    className="break-words rounded border border-white/5 bg-white/5 px-2 py-1 text-xs"
                  >
                    {message.rawContent || ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter className="shrink-0 flex-row items-center justify-between border-t border-[var(--color-border)] px-5 py-3">
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  aria-label={`Open ${externalDisplayName} on ${platformLabel}`}
                  onClick={() => void window.electronAPI.openExternal(externalUrl)}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent>Open on {platformLabel}</TooltipContent>
            </Tooltip>
            {channel.state === "loading" ? (
              <span className="text-xs text-[var(--color-foreground-muted)]">Channel loading…</span>
            ) : channel.state !== "known" ? (
              <button
                type="button"
                className="rounded text-xs text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={profileState.retryChannel}
              >
                Channel unavailable · Retry
              </button>
            ) : null}
          </div>
          <DialogClose asChild>
            <button
              type="button"
              className="h-9 rounded-md bg-[var(--color-background-tertiary)] px-4 text-sm font-medium text-white hover:bg-[var(--color-background-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Close
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

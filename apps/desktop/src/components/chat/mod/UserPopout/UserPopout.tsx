import { Check, ExternalLink, MessageSquareText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage as ChatMessageRow } from "@/components/chat/ChatMessage";
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
import { useAuthStore } from "@/store/auth-store";
import { buildChannelKey, useChatStore } from "@/store/chat-store";
import {
  reconcileSelectedMessage,
  selectLatestAuthoredMessage,
  selectRecentUserMessages,
} from "@/store/user-popout-chat-context";

import { UserProfileHeader } from "./UserProfileHeader";
import { useUserProfile } from "./useUserProfile";

export interface UserPopoutProps {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  platform: "twitch" | "kick";
  channelId: string;
  channelSlug: string;
  kickChatroomId?: number;
  openingMessage?: ChatMessage;
  badgeCatalog?: {
    state: "loading" | "ready" | "failed";
    sourceLabel: string;
    retry: () => void;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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
  displayName,
  avatarUrl,
  platform,
  channelId,
  channelSlug,
  openingMessage,
  badgeCatalog,
  open,
  onOpenChange,
}: UserPopoutProps) {
  const profileState = useUserProfile(userId, platform, channelId, username, channelSlug);
  const loginTwitch = useAuthStore((state) => state.loginTwitch);
  const loginKick = useAuthStore((state) => state.loginKick);
  const compact = useCompactDialog();
  const { identity, accountCreated, follow, channel } = profileState;
  const renderedIdentity =
    identity.state === "known" && platform === "kick"
      ? {
          ...identity,
          value: {
            ...identity.value,
            avatarUrl: identity.value.avatarUrl || avatarUrl || "",
          },
        }
      : identity.state === "known" || platform !== "kick"
        ? identity
        : {
            state: "known" as const,
            source: "chat-event" as const,
            value: {
              userId,
              username,
              displayName: displayName ?? username,
              avatarUrl: avatarUrl ?? "",
            },
          };
  const channelKey = buildChannelKey(platform, channelSlug);
  const channelMessages = useChatStore((state) => state.messagesByChannel[channelKey]);
  const messages = channelMessages ?? EMPTY_MESSAGES;
  const recentMessages = useMemo(
    () => selectRecentUserMessages({ [channelKey]: messages }, channelKey, { userId, username }),
    [channelKey, messages, userId, username]
  );
  const [selectedSnapshot, setSelectedSnapshot] = useState<ChatMessage | null>(
    () => openingMessage ?? null
  );
  const selectedMessage = useMemo(
    () => reconcileSelectedMessage(selectedSnapshot, messages),
    [messages, selectedSnapshot]
  );
  const latestAuthoredMessage = useMemo(
    () => selectLatestAuthoredMessage({ [channelKey]: messages }, channelKey, { userId, username }),
    [channelKey, messages, userId, username]
  );
  const latestBadgesAreResolved = latestAuthoredMessage?.badges.every((badge) =>
    Boolean(badge.imageUrl)
  );
  const verifiedBadgeData =
    latestBadgesAreResolved || (channelMessages !== undefined && latestAuthoredMessage === null);
  const headerBadges = verifiedBadgeData
    ? {
        state: "known" as const,
        badges: latestAuthoredMessage?.badges ?? [],
        sourceLabel: badgeCatalog?.sourceLabel,
      }
    : badgeCatalog && badgeCatalog.state !== "loading"
      ? {
          state: "failed" as const,
          retry: badgeCatalog.retry,
          sourceLabel: badgeCatalog.sourceLabel,
        }
      : { state: "loading" as const };
  const newestMessageRef = useRef<HTMLLIElement>(null);
  const newestMessageId = recentMessages[recentMessages.length - 1]?.id;
  useEffect(() => {
    if (!newestMessageId) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    newestMessageRef.current?.scrollIntoView?.({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
    });
  }, [newestMessageId]);
  const resolvedChannel = channel.state === "known" ? channel.value : null;
  const externalUsername = resolvedChannel?.username ?? username;
  const externalDisplayName = resolvedChannel?.displayName ?? username;
  const platformLabel = platform === "kick" ? "Kick" : "Twitch";
  const externalUrl =
    platform === "kick"
      ? `https://kick.com/${externalUsername.trim().replace(/^@+/, "").toLowerCase()}`
      : `https://www.twitch.tv/${externalUsername}`;
  const liveAnnouncement = [
    renderedIdentity.state === "failed"
      ? "Profile identity could not be verified."
      : renderedIdentity.state === "unavailable"
        ? "Profile identity is unavailable."
        : "",
    accountCreated.state === "failed"
      ? "Account creation date could not be verified."
      : accountCreated.state === "unavailable"
        ? "Account creation date is unavailable."
        : "",
    follow.state === "reconnect-required"
      ? `Reconnect ${platformLabel} to verify the follow relationship.`
      : follow.state === "failed"
        ? "Follow relationship could not be verified."
        : follow.state === "unavailable"
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
            platform={platform}
            fallbackUsername={username}
            identity={renderedIdentity}
            accountCreated={accountCreated}
            follow={follow}
            badges={headerBadges}
            retryIdentity={profileState.retryIdentity}
            retryAccountCreated={profileState.retryAccountCreated}
            retryFollow={profileState.retryFollow}
            reconnect={() => void (platform === "kick" ? loginKick() : loginTwitch())}
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
              Recent in this chat
            </h3>
            {recentMessages.length === 0 ? (
              <p
                className="text-xs text-[var(--color-foreground-muted)]"
                data-testid="user-popout-no-recent-messages"
              >
                No recent messages in this chat
              </p>
            ) : (
              <ul
                className="space-y-1"
                data-testid="user-popout-recent-messages"
                aria-label="Recent messages in this chat"
              >
                {recentMessages.map((message, index) => (
                  <li
                    key={message.id}
                    ref={index === recentMessages.length - 1 ? newestMessageRef : undefined}
                    className={`flex items-start overflow-hidden rounded border transition-colors ${
                      selectedMessage?.id === message.id
                        ? "border-white/40 bg-white/10"
                        : "border-white/5 bg-white/5 hover:bg-white/[0.08]"
                    }`}
                    aria-current={selectedMessage?.id === message.id ? "true" : undefined}
                  >
                    <button
                      type="button"
                      className="m-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--color-foreground-muted)] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      aria-label={`Select message from ${message.displayName}: ${message.rawContent}`}
                      aria-pressed={selectedMessage?.id === message.id}
                      onClick={() => setSelectedSnapshot(message)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedSnapshot(message);
                        }
                      }}
                    >
                      <Check
                        className={`h-4 w-4 ${
                          selectedMessage?.id === message.id ? "opacity-100" : "opacity-30"
                        }`}
                        aria-hidden
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <ChatMessageRow message={message} badgeLimit={4} embedded />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter
          className="shrink-0 flex-row items-center justify-between border-t border-[var(--color-border)] px-5 py-3"
          data-testid="user-popout-selected-footer"
          data-selected-message-id={selectedMessage?.id}
          data-selected-author-id={selectedMessage?.userId}
          data-selected-platform={selectedMessage?.platform}
          data-selected-channel={selectedMessage?.channel}
        >
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

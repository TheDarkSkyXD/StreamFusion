import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  ExternalLink,
  Languages,
  LayoutDashboard,
  LockKeyhole,
  MessageSquareText,
  Radio,
  RefreshCw,
  Reply,
  Shield,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChatMessage as ChatMessageRow } from "@/features/chat/components/chat/ChatMessage";
import type { ChatSendEligibility } from "@/features/chat/components/chat/chat-send-eligibility";
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
import { MOD_LOG_QUERY_KEYS } from "@/features/moderation/data/mod-log-query-keys";
import { useModerationAuthority } from "@/features/moderation/data/useModerationAuthority";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@shared/auth-types";
import type { ChatMessage } from "@shared/chat-types";
import { useAuthStore } from "@/store/auth-store";
import { buildChannelKey, useChatStore } from "@/store/chat-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";
import {
  reconcileSelectedMessage,
  selectLatestAuthoredMessage,
  selectRecentUserMessages,
} from "@/store/user-popout-chat-context";
import { StateAwareTimeoutAction } from "./StateAwareTimeoutAction";
import { UserModHistory } from "./UserModHistory";
import { UserProfileHeader } from "./UserProfileHeader";
import { useUserProfile } from "./useUserProfile";

export interface UserPopoutPublicActions {
  /** Null means the guest viewer must not be offered Reply. */
  replyEligibility: ChatSendEligibility | null;
  onReply: (message: ChatMessage) => void;
  onCopyToChat?: (message: string) => void;
  onViewChannel: (
    platform: "twitch" | "kick",
    channel: { id: string; username: string; displayName: string }
  ) => void;
}

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
  publicActions?: UserPopoutPublicActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EMPTY_MESSAGES: ChatMessage[] = [];

function serializeVisibleMessageContent(message: ChatMessage): string {
  return message.content
    .map((fragment) => {
      switch (fragment.type) {
        case "text":
          return fragment.content;
        case "emote":
        case "cheermote":
          return fragment.name;
        case "mention":
          return `@${fragment.username.replace(/^@+/, "")}`;
        case "link":
          return fragment.text;
      }
    })
    .join("");
}

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
  publicActions,
  open,
  onOpenChange,
}: UserPopoutProps) {
  const queryClient = useQueryClient();
  const profileState = useUserProfile(userId, platform, channelId, username, channelSlug);
  const moderationAuthority = useModerationAuthority(platform, channelId, channelSlug);
  const reconnectPhase = useReconnectDialogStore((state) => state.phase);
  const reconnectBusy = reconnectPhase === "submitting" || reconnectPhase === "revalidating";
  const loginTwitch = useAuthStore((state) => state.loginTwitch);
  const loginKick = useAuthStore((state) => state.loginKick);
  const chatDisplay =
    useAuthStore((state) => state.preferences?.chatDisplay) ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
  const compact = useCompactDialog();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [timeoutPending, setTimeoutPending] = useState(false);
  const dialogLocked = reconnectBusy || timeoutPending;
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
  const copyableSelectedMessage =
    selectedMessage && (!selectedMessage.isDeleted || chatDisplay.showClearMsg)
      ? selectedMessage
      : null;
  const selectedVisibleContent =
    copyableSelectedMessage?.isDeleted &&
    (chatDisplay.deletedMessageDisplay === "tombstone" ||
      copyableSelectedMessage.content.length === 0)
      ? "Message deleted"
      : copyableSelectedMessage
        ? serializeVisibleMessageContent(copyableSelectedMessage)
        : null;
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
    moderationAuthority.state === "reconnect-required"
      ? `Reconnect ${platformLabel} to verify moderation permissions.`
      : moderationAuthority.state === "unverifiable"
        ? "Moderation access could not be verified."
        : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && dialogLocked) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        hideCloseButton
        className={`flex w-[calc(100vw-2rem)] max-w-[560px] flex-col gap-0 overflow-hidden border-[var(--color-border)] bg-[#0f0f0f] p-0 shadow-2xl ${
          compact ? "max-h-[calc(100vh-1rem)]" : "max-h-[80vh]"
        }`}
        data-testid="user-popout"
        data-compact={compact ? "true" : "false"}
        data-reconnect-locked={reconnectBusy ? "true" : "false"}
        data-timeout-locked={timeoutPending ? "true" : "false"}
        aria-busy={dialogLocked}
        onEscapeKeyDown={(event) => {
          if (dialogLocked) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (dialogLocked) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (dialogLocked) event.preventDefault();
        }}
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
              <DialogClose
                disabled={dialogLocked}
                className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
              >
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
          {moderationAuthority.state === "authorized" ? (
            <section
              className="mt-5 border-t border-white/10 pt-4"
              aria-labelledby="moderation-history-heading"
            >
              <h3
                id="moderation-history-heading"
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]"
              >
                <Shield className="h-4 w-4" aria-hidden />
                Moderation history
              </h3>
              <p className="mb-3 mt-1 text-xs text-[var(--color-foreground-muted)]">
                Platform actions available to StreamFusion
              </p>
              <UserModHistory
                platform={platform}
                channelId={channelId}
                channelSlug={channelSlug}
                targetUserId={userId}
                limit={5}
              />
              <StateAwareTimeoutAction
                binding={{
                  platform,
                  channelId,
                  channelSlug,
                  targetUserId: userId,
                  targetUsername: username,
                  ...(selectedMessage?.id ? { selectedMessageId: selectedMessage.id } : {}),
                  action: "timeout",
                }}
                displayName={displayName ?? username}
                onPendingChange={setTimeoutPending}
                onSuccess={async () => {
                  await queryClient.invalidateQueries({
                    queryKey: MOD_LOG_QUERY_KEYS.channel(platform, channelId),
                  });
                }}
              />
              <button
                type="button"
                className="mt-3 inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={() => {
                  window.location.hash = `/mod/${platform}/${encodeURIComponent(channelSlug)}`;
                  onOpenChange(false);
                }}
              >
                <LayoutDashboard className="h-4 w-4" aria-hidden />
                View all in Mod Dashboard
              </button>
            </section>
          ) : moderationAuthority.state === "reconnect-required" ? (
            <section
              className="mt-5 border-t border-white/10 pt-4"
              aria-labelledby="moderation-reconnect-heading"
              data-testid="moderation-reconnect-required"
            >
              <h3
                id="moderation-reconnect-heading"
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]"
              >
                <Shield className="h-4 w-4" aria-hidden />
                Moderation
              </h3>
              <div className="mt-2 rounded-md border border-amber-300/20 bg-amber-300/5 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-white">
                  <LockKeyhole className="h-4 w-4 text-amber-200" aria-hidden />
                  Reconnect {platformLabel}
                </p>
                <p className="mt-1 text-xs text-[var(--color-foreground-muted)]">
                  Add the missing permissions in one {platformLabel} consent flow to verify
                  moderation access and load available history.
                </p>
                <button
                  type="button"
                  className="mt-3 inline-flex h-8 items-center gap-2 rounded-md bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  onClick={moderationAuthority.reconnect}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Reconnect {platformLabel}
                </button>
              </div>
            </section>
          ) : moderationAuthority.state === "unverifiable" ? (
            <section
              className="mt-5 border-t border-white/10 pt-4"
              aria-labelledby="moderation-unverifiable-heading"
              data-testid="moderation-unverifiable"
            >
              <h3
                id="moderation-unverifiable-heading"
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]"
              >
                <Shield className="h-4 w-4" aria-hidden />
                Moderation
              </h3>
              <button
                type="button"
                className="mt-2 inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={moderationAuthority.retry}
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Couldn’t verify · Retry
              </button>
            </section>
          ) : null}
        </div>

        <DialogFooter
          className="shrink-0 flex-row flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-3"
          data-testid="user-popout-selected-footer"
          data-selected-message-id={selectedMessage?.id}
          data-selected-author-id={selectedMessage?.userId}
          data-selected-platform={selectedMessage?.platform}
          data-selected-channel={selectedMessage?.channel}
        >
          <div className="flex flex-wrap items-center gap-2">
            {selectedMessage && publicActions?.replyEligibility ? (
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={publicActions.replyEligibility.state === "ineligible"}
                title={
                  publicActions.replyEligibility.state === "ineligible"
                    ? publicActions.replyEligibility.reason
                    : undefined
                }
                onClick={() => publicActions.onReply(selectedMessage)}
              >
                <Reply className="h-4 w-4" aria-hidden />
                Reply
              </button>
            ) : null}
            {copyableSelectedMessage && selectedVisibleContent !== null ? (
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(selectedVisibleContent)
                    .then(() => {
                      setCopyStatus("copied");
                      toast.success("Message copied");
                    })
                    .catch(() => {
                      setCopyStatus("failed");
                      toast.error("Couldn’t copy message");
                    });
                }}
              >
                <Copy className="h-4 w-4" aria-hidden />
                Copy message
              </button>
            ) : null}
            <span className="sr-only" aria-live="polite">
              {copyStatus === "copied"
                ? "Message copied"
                : copyStatus === "failed"
                  ? "Couldn’t copy message"
                  : ""}
            </span>
            {selectedVisibleContent !== null &&
            publicActions?.replyEligibility &&
            publicActions.onCopyToChat ? (
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={() => publicActions.onCopyToChat?.(selectedVisibleContent)}
              >
                <MessageSquareText className="h-4 w-4" aria-hidden />
                Copy message to chat
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-white opacity-50"
              disabled
            >
              <Languages className="h-4 w-4" aria-hidden />
              Translate · Coming Soon
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!resolvedChannel || !publicActions}
              onClick={() => {
                if (resolvedChannel && publicActions) {
                  publicActions.onViewChannel(platform, resolvedChannel);
                }
              }}
            >
              <Radio className="h-4 w-4" aria-hidden />
              View Channel
            </button>
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
              <span className="text-xs text-[var(--color-foreground-muted)]">
                Verifying channel…
              </span>
            ) : channel.state !== "known" ? (
              <button
                type="button"
                className="rounded text-xs text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={profileState.retryChannel}
              >
                Couldn’t verify · Retry
              </button>
            ) : null}
          </div>
          <DialogClose asChild>
            <button
              type="button"
              disabled={dialogLocked}
              className="h-9 rounded-md bg-[var(--color-background-tertiary)] px-4 text-sm font-medium text-white hover:bg-[var(--color-background-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Close
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

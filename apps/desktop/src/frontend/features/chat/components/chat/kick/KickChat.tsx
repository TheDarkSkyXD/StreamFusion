import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { BsChevronDown, BsX } from "react-icons/bs";
import { toast } from "sonner";
import { MOD_LOG_QUERY_KEYS } from "@/features/moderation/data/mod-log-query-keys";
import { useInterval } from "@/hooks/useInterval";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { useStickyDismissedPrediction } from "@/features/chat/data/useStickyDismissedPrediction";
import { registerChatMessageRoute } from "@/features/chat/data/chat-message-router";
import { logger } from "@/renderer/logging/logger";
import { router } from "@/routes/router";
import type { UnifiedPrediction } from "@shared/chat-types";
import {
  banKickUserOfficial,
  type KickModResult,
  setKickChatMode,
  timeoutKickUserOfficial,
  unbanKickUserOfficial,
} from "../../../../../../backend/api/platforms/kick/kick-mod-mutations";
import { kickChatService } from "../../../../../../backend/services/chat/kick-chat";
import {
  resolveKickSubscriberBadges,
  type SubscriberBadge,
} from "../../../../../../backend/services/chat/kick-parser";
import { kickPredictionsService } from "../../../../../../backend/services/chat/kick-predictions-service";
import { substituteThirdPartyEmotes } from "../../../../../../backend/services/chat/third-party-emote-enrich";
import { initializeKickEmotes } from "../../../../../../backend/services/emotes";
import { modLogWriter } from "../../../../../../backend/services/mod-log-writer";
import { useChatRoomState } from "../../../data/useChatRoomState";
import { useChatSettingsSync } from "../../../data/useChatSettingsSync";
import { useIsKickMod } from "../../../../moderation/data/useIsKickMod";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../../../../../../shared/auth-types";
import type {
  ChatConnectionStatus,
  ChatMessage,
  ClearChat,
  KickPoll,
  MessageDeletion,
  NormalizedPinnedMessage,
  RetainedDeletedMessage,
  UserNotice,
} from "../../../../../../shared/chat-types";
import { ChatHighlightKind } from "@streamfusion/core/chat";
import { useAuthStore } from "../../../../../store/auth-store";
import { buildChannelKey, useChatStore } from "../../../../../store/chat-store";
import {
  primePersistedChatHistoryIntentAsync,
  savePersistedChatHistory,
} from "../../../../../store/persisted-chat-history";
import { useEmoteStore } from "../../../../../store/emote-store";
import { useModeratedChannelsStore } from "../../../../moderation/data/moderated-channels-store";
import { useRoomStateStore } from "../../../../../store/room-state-store";
import { useRenderCount } from "../../../../../components/dev/use-render-count";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../../components/ui/tooltip";
import { ChatComposerFooter } from "../ChatComposerFooter";
import { ChatInput, type ChatInputHandle } from "../ChatInput";
import type {
  ChatCommandAccess,
  ChatCommandDefinition,
  KickModerationEffect,
} from "../../../utils/chat-command-registry";
import { runKickCommandEffect } from "../../../utils/kick-command-session";
import { ChatMessageList } from "../ChatMessageList";
import {
  resolveAccountAgeRequirement,
  type ChatSendEligibility,
  resolveChatSendEligibility,
} from "@streamfusion/core/chat";
import { type ChatPanelTabId, ChatPanelTabs } from "../mod/ChatPanelTabs";
import { type InlineModAction, InlineModStrip } from "../mod/InlineModStrip";
import { ModActionConfirmDialog, type ModActionType } from "../mod/ModActionConfirmDialog";
import { showModActionSuccessToast } from "../mod/mod-action-toast";
import { TimeoutDurationPicker } from "../mod/TimeoutDurationPicker";
import { ModLogTab } from "../mod/tabs/ModLogTab";
import { StateAwareTimeoutAction } from "../mod/UserPopout/StateAwareTimeoutAction";
import { UserPopoutProvider } from "../mod/UserPopout/UserPopoutProvider";
import { PinnedMessageBanner } from "../PinnedMessageBanner";
import { PredictionBanner } from "../PredictionBanner";
import { RecentChattersButton, RecentChattersPanel } from "../RecentChattersPanel";
import { createChatMessageGate, type ChatMessageGate } from "../chat-startup";
import { seedKickChatHistory } from "./kick-chat-history";

export interface KickChatProps {
  /** Channel name (slug) to join */
  channel: string;
  /** Kick broadcaster identity used by official APIs and live services. */
  channelId?: string;
  /** Legacy Kick channel/db ID used only by the recent-message endpoint. */
  kickChannelId?: string;
  /** Chatroom ID (required for Kick) */
  chatroomId?: number;
  /** Kick broadcaster user_id, used to resolve the channel's 7TV emotes. */
  kickUserId?: string;
  /** Whether this Kick channel is a Partner channel. */
  isPartnerChannel?: boolean;
  /** Subscriber badges for the channel (for badge rendering) */
  subscriberBadges?: SubscriberBadge[];
  badgeCatalogState?: "loading" | "ready" | "failed";
  retryBadgeCatalog?: () => void;
  showComposer?: boolean;
}

/** U13: Kick's inline strip exposes four chat-mode toggles and a local clear.
 *  The first-party raid workflow remains available through the command catalog. */
type PendingKickModAction =
  | {
      kind: "messageScoped";
      message: ChatMessage;
      actionType: Extract<ModActionType, "timeout" | "ban" | "unban" | "delete">;
    }
  | {
      kind: "stripChatMode";
      modeKind: "slow-mode" | "followers-only" | "subscribers-only" | "emote-only";
      currentlyActive: boolean;
    }
  | { kind: "strip"; actionType: "clear" };

function getNoticeHighlightKind(type: UserNotice["type"]): ChatHighlightKind {
  switch (type) {
    case "sub":
      return "subscription";
    case "resub":
      return "resub";
    case "subgift":
    case "submysterygift":
      return "gifted-sub";
    case "raid":
      return "raid";
    case "bitsbadgetier":
      return "bits";
    case "ritual":
      return "ritual";
  }

  const exhaustive: never = type;
  return exhaustive;
}

function readOwnKickModeratorState(
  message: ChatMessage,
  channel: string,
  ownKickUserId: number | string | null | undefined
): boolean | null {
  if (message.platform !== "kick") return null;
  if (ownKickUserId === undefined || ownKickUserId === null) return null;
  if (message.userId !== String(ownKickUserId)) return null;
  if (message.channel.toLowerCase() !== channel.toLowerCase()) return null;
  return message.badges.some(
    (badge) => badge.setId === "moderator" || badge.setId === "broadcaster"
  );
}

async function deleteKickMessageViaKickWebSession(
  chatroomId: number,
  messageId: string,
  t: TFunction
): Promise<KickModResult> {
  const result = await window.electronAPI.kickChat.deleteMessage(chatroomId, messageId);
  return kickWebMutationToKickModResult(result, t);
}

async function banKickUserViaKickWebSession(
  channelSlug: string,
  username: string,
  t: TFunction
): Promise<KickModResult> {
  const result = await window.electronAPI.kickChat.banUser(channelSlug, username);
  return kickWebMutationToKickModResult(result, t);
}

async function unbanKickUserViaKickWebSession(
  channelSlug: string,
  username: string,
  t: TFunction
): Promise<KickModResult> {
  const result = await window.electronAPI.kickChat.unbanUser(channelSlug, username);
  return kickWebMutationToKickModResult(result, t);
}

async function timeoutKickUserViaKickWebSession(
  channelSlug: string,
  username: string,
  duration: number,
  t: TFunction
): Promise<KickModResult> {
  const result = await window.electronAPI.kickChat.timeoutUser(channelSlug, username, duration);
  return kickWebMutationToKickModResult(result, t);
}

function kickWebMutationToKickModResult(
  result: Awaited<ReturnType<typeof window.electronAPI.kickChat.deleteMessage>>,
  t: TFunction
): KickModResult {
  if (result.ok) return { ok: true };

  if (result.kind === "auth-expired") {
    return { ok: false, kind: "unauthenticated", message: result.message };
  }
  if (result.status === 403) {
    return { ok: false, kind: "forbidden", message: "403" };
  }
  if (result.kind === "network") {
    return { ok: false, kind: "network", message: result.message };
  }
  return {
    ok: false,
    kind: "unknown",
    message: result.status ? t("chat.value0", { value0: result.status }) : result.message,
  };
}

const CONNECTING_TEXT = "Connecting to channel...";
const CONNECTED_TEXT = "Connected to the channel";
const VIEWER_ROLE_REFRESH_MS = 30_000;

function createConnectionStatusMessage(
  channel: string,
  state: "connecting" | "connected"
): ChatMessage {
  const rawContent = state === "connecting" ? CONNECTING_TEXT : CONNECTED_TEXT;
  return {
    id: `system:kick:${channel}:connection:${state}`,
    platform: "kick",
    type: "system",
    channel,
    userId: "system",
    username: "System",
    displayName: "System",
    color: "#808080",
    badges: [],
    content: [{ type: "text", content: rawContent }],
    rawContent,
    timestamp: new Date(),
    isDeleted: false,
    isHighlighted: true,
    isAction: false,
  };
}

export const KickChat: React.FC<KickChatProps> = ({
  channel,
  channelId,
  kickChannelId,
  chatroomId,
  kickUserId,
  isPartnerChannel = false,
  subscriberBadges,
  badgeCatalogState = subscriberBadges === undefined ? "loading" : "ready",
  retryBadgeCatalog = () => {},
  showComposer = true,
}) => {
  const { t } = useTranslation();
  useRenderCount("KickChat");
  const queryClient = useQueryClient();
  // Chat store — subscribe only to fields read in render; actions have stable refs.
  // Narrow to a boolean so Pusher heartbeats / disconnect-state churn don't re-render
  // the whole chat subtree on every tick.
  const isKickConnected = useChatStore(
    (state) => state.connectionStatus.kick.state === "connected"
  );
  const addMessage = useChatStore((state) => state.addMessage);
  // Batched path for the high-volume live message stream. System / connect
  // / clear / ban events still go through addMessage so they're applied
  // immediately and preserve total ordering with batched chat.
  const addMessageBatched = useChatStore((state) => state.addMessageBatched);
  const liveMessageGateRef = useRef<ChatMessageGate<ChatMessage> | null>(null);
  const prependMessages = useChatStore((state) => state.prependMessages);
  const updateConnectionStatus = useChatStore((state) => state.updateConnectionStatus);
  const clearMessages = useChatStore((state) => state.clearMessages);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const deleteMessagesByUser = useChatStore((state) => state.deleteMessagesByUser);
  const channelKey = buildChannelKey("kick", channel);
  const recentChattersPanelId = useId();
  const [showRecentChatters, setShowRecentChatters] = useState(false);

  // Emote store — actions only; no render-time data needed here.
  const loadGlobalEmotes = useEmoteStore((state) => state.loadGlobalEmotes);
  const loadChannelEmotes = useEmoteStore((state) => state.loadChannelEmotes);
  const setActiveChannel = useEmoteStore((state) => state.setActiveChannel);
  const unloadChannelEmotes = useEmoteStore((state) => state.unloadChannelEmotes);
  const applyProviderPrefs = useEmoteStore((state) => state.applyProviderPrefs);

  // Reactive auth gate. Subscribing to the store (instead of a local
  // useState that's only set inside the connect effect) lets the chat
  // input flip between "Send a message..." and "Log in to chat" the
  // instant the user signs in or out via the ProfileDropdown — no page
  // refresh required.
  const isAuthenticated = useAuthStore((state) => state.kickConnected);
  const loginKick = useAuthStore((state) => state.loginKick);
  useEffect(() => {
    if (!showComposer || !isAuthenticated) return;
    kickChatService.acquireSendWindowRetention();
    return () => kickChatService.releaseSendWindowRetention();
  }, [isAuthenticated, showComposer]);
  // U5 — gate the in-chat poll + prediction widgets on viewer prefs. Reactive
  // selectors so toggling them live shows/hides the widget without remounting.
  const showPolls = useAuthStore(
    (state) =>
      state.preferences?.chatDisplay?.showPolls ?? DEFAULT_CHAT_DISPLAY_PREFERENCES.showPolls
  );
  const showPredictions = useAuthStore(
    (state) =>
      state.preferences?.chatDisplay?.showPredictions ??
      DEFAULT_CHAT_DISPLAY_PREFERENCES.showPredictions
  );
  const [pinnedMessage, setPinnedMessage] = useState<NormalizedPinnedMessage | null>(null);
  const [showPinned, setShowPinned] = useState(true);
  const [isPinExpanded, setIsPinExpanded] = useState(false);
  // Mod-action state (mirrors TwitchChat). Kick has no scope-reconnect flow
  // — perm checks happen server-side on the v2 pinned-message endpoint —
  // so we just gate the UI on broadcaster-of-self via useIsKickMod.
  // U11/U13 — generic mod-action dialog state. Widened in U13 to cover the
  // strip's chat-mode toggles + local clear.
  const [pendingModAction, setPendingModAction] = useState<PendingKickModAction | null>(null);
  const [modActionBusy, setModActionBusy] = useState(false);
  const [unbanUserIds, setUnbanUserIds] = useState<Set<string>>(() => new Set());
  const isMod = useIsKickMod(channel);
  // Optimistic per-channel chat-room state (U14).
  const kickRoomKey = channelId ?? (chatroomId ? String(chatroomId) : "");
  const currentChannelContext = useMemo(
    () =>
      kickRoomKey
        ? {
            channelId: kickRoomKey,
            channelSlug: channel,
            kickChatroomId: chatroomId,
          }
        : undefined,
    [channel, chatroomId, kickRoomKey]
  );
  const kickUser = useAuthStore((state) => state.kickUser);
  const roomState = useChatRoomState("kick", kickRoomKey || null);
  const viewerAccountCreatedQuery = useQuery({
    queryKey: ["userProfile", "kick", "account-created", kickUser?.id, kickUser?.slug, channel],
    queryFn: () =>
      window.electronAPI.userProfiles.getKickAccountCreated({
        userId: String(kickUser!.id),
        username: kickUser!.slug,
        channelSlug: channel,
      }),
    enabled:
      isAuthenticated &&
      Boolean(kickUser && channel) &&
      roomState.accountAge !== null &&
      roomState.accountAge > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const viewerAccountAgeRequirement = useMemo(() => {
    if (isMod) return "satisfied" as const;
    const result = viewerAccountCreatedQuery.data;
    return resolveAccountAgeRequirement({
      accountCreatedAt: result?.state === "known" ? result.value : undefined,
      requiredMinutes: roomState.accountAge,
      nowMs: Date.now(),
    });
  }, [isMod, roomState.accountAge, viewerAccountCreatedQuery.data]);
  const updateRoomState = useRoomStateStore((s) => s.updateRoomState);
  const setKickChannelModState = useModeratedChannelsStore((s) => s.setKickChannelModState);
  const setKickAuthorityResult = useModeratedChannelsStore((s) => s.setKickAuthorityResult);
  const markUserUnbannable = useCallback((userId: string) => {
    setUnbanUserIds((current) => {
      if (current.has(userId)) return current;
      const next = new Set(current);
      next.add(userId);
      return next;
    });
  }, []);
  const markUserUnbanned = useCallback((userId: string) => {
    setUnbanUserIds((current) => {
      if (!current.has(userId)) return current;
      const next = new Set(current);
      next.delete(userId);
      return next;
    });
  }, []);

  // U6 — merge seam. Initial v2 channel-resolve `chatroomSettings` block +
  // ChatroomUpdatedEvent Pusher events + reconnect re-seed all converge
  // through this hook into useRoomStateStore. The store key uses the same
  // `channelId ?? String(chatroomId)` fallback the mod-strip writes under.
  useChatSettingsSync({
    platform: "kick",
    channel,
    channelId: kickRoomKey || null,
  });
  const signedInUserIsBroadcaster = useMemo(() => {
    if (!channel || !kickUser) return false;
    return (
      (kickUserId !== undefined && String(kickUser.id) === kickUserId) ||
      (typeof kickUser.slug === "string" &&
        kickUser.slug.toLowerCase() === channel.toLowerCase()) ||
      (typeof kickUser.username === "string" &&
        kickUser.username.toLowerCase() === channel.toLowerCase())
    );
  }, [channel, kickUser, kickUserId]);
  const commandAccess: ChatCommandAccess = useMemo(() => {
    if (!isAuthenticated) return { kind: "guest", platform: "kick" };
    if (signedInUserIsBroadcaster) {
      return {
        kind: "authenticated",
        platform: "kick",
        role: "broadcaster",
        isPartnerBroadcaster: isPartnerChannel,
      };
    }
    return { kind: "authenticated", platform: "kick", role: isMod ? "moderator" : "viewer" };
  }, [isAuthenticated, isMod, isPartnerChannel, signedInUserIsBroadcaster]);
  const executeKickCommand = useCallback(
    async ({ command, args }: { command: ChatCommandDefinition; args: string; text: string }) => {
      if (command.platform !== "kick" || commandAccess.kind !== "authenticated") {
        throw new Error(`/${command.name} is not available in this Kick chat`);
      }

      return runKickCommandEffect(command, args, {
        role: commandAccess.role,
        sendAction: (message) =>
          kickChatService.sendMessage(channel, `*${message}*`, kickUser ?? undefined),
        moderate: async (effect: KickModerationEffect) => {
          const token = await window.electronAPI.auth.getToken("kick");
          if (!token?.accessToken) throw new Error("Sign in to Kick to use this command");

          const broadcasterUserId = Number(kickUserId ?? channelId);
          if (!Number.isSafeInteger(broadcasterUserId) || broadcasterUserId < 1) {
            throw new Error("Could not resolve this Kick channel's broadcaster identity");
          }

          const target = await window.electronAPI.userProfiles.resolveKickChannel({
            username: effect.targetLogin,
          });
          if (target.state !== "known") {
            throw new Error(`Could not resolve @${effect.targetLogin} to a Kick user`);
          }
          const userId = Number(target.value.id);
          if (!Number.isSafeInteger(userId) || userId < 1) {
            throw new Error(`Kick returned an invalid identity for @${effect.targetLogin}`);
          }

          let result: KickModResult;
          switch (effect.action) {
            case "ban":
              result = await banKickUserOfficial({
                accessToken: token.accessToken,
                broadcasterUserId,
                userId,
                ...(effect.reason ? { reason: effect.reason } : {}),
              });
              break;
            case "unban":
              result = await unbanKickUserOfficial({
                accessToken: token.accessToken,
                broadcasterUserId,
                userId,
              });
              break;
            case "timeout":
              result = await timeoutKickUserOfficial({
                accessToken: token.accessToken,
                broadcasterUserId,
                userId,
                duration: effect.durationMinutes,
                ...(effect.reason ? { reason: effect.reason } : {}),
              });
              break;
            default: {
              const exhaustive: never = effect;
              return exhaustive;
            }
          }
          if (!result.ok) throw new Error(result.message);
        },
      });
    },
    [channel, channelId, commandAccess, kickUser, kickUserId]
  );

  useEffect(() => {
    if (!signedInUserIsBroadcaster) return;
    setKickChannelModState(channel, true);
    kickChatService.setModeratorState(channel, true);
  }, [channel, signedInUserIsBroadcaster, setKickChannelModState]);

  const refreshKickViewerRole = useCallback(
    async (options: { isCancelled?: () => boolean } = {}) => {
      if (!channel || !kickUser) return;
      try {
        const result = await window.electronAPI.kickChat.getViewerRole(channel);
        if (options.isCancelled?.()) return;
        if (!result.ok) {
          setKickAuthorityResult(channel, {
            state: "failed",
            reason:
              result.kind === "auth-expired"
                ? "authorization"
                : result.kind === "network"
                  ? "network"
                  : "invalid-response",
            checkedAt: Date.now(),
            source: "kick-channel-me",
          });
          return;
        }
        if (result.isModerator === null) {
          setKickAuthorityResult(channel, {
            state: "failed",
            reason: "invalid-response",
            checkedAt: Date.now(),
            source: "kick-channel-me",
          });
          return;
        }
        setKickAuthorityResult(channel, {
          state: "complete",
          isModerator: result.isModerator,
          checkedAt: Date.now(),
          source: "kick-channel-me",
        });
        if (!result.isModerator && signedInUserIsBroadcaster) return;
        setKickChannelModState(channel, result.isModerator);
        kickChatService.setModeratorState(channel, result.isModerator);
      } catch (error) {
        if (!options.isCancelled?.()) {
          setKickAuthorityResult(channel, {
            state: "failed",
            reason: "network",
            checkedAt: Date.now(),
            source: "kick-channel-me",
          });
          logger.debug("UI:Chat:Kick", "failed to load Kick viewer role", {
            channel,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
    [channel, kickUser, signedInUserIsBroadcaster, setKickAuthorityResult, setKickChannelModState]
  );

  useEffect(() => {
    if (!channel || !kickUser) return;

    let cancelled = false;
    void refreshKickViewerRole({ isCancelled: () => cancelled });

    return () => {
      cancelled = true;
    };
  }, [channel, kickUser, refreshKickViewerRole]);

  useInterval(
    () => {
      void refreshKickViewerRole();
    },
    channel && kickUser ? VIEWER_ROLE_REFRESH_MS : null
  );

  const handleDeleteMessage = useCallback(
    async (message: ChatMessage) => {
      if (chatroomId === undefined) {
        toast.error(t("chat.couldnTDeleteMessage"), {
          description: t("chat.chatroomNotLoaded"),
        });
        return;
      }

      try {
        const result = await deleteKickMessageViaKickWebSession(chatroomId, message.id, t);
        if (result.ok) {
          if (channelId && kickUser) {
            void modLogWriter
              .record({
                platform: "kick",
                channelId,
                channelSlug: channel,
                action: "delete",
                targetUserId: message.userId,
                targetUsername: message.username,
                moderatorUserId: String(kickUser.id),
                moderatorUsername: kickUser.username,
                durationSeconds: null,
                reason: message.rawContent || null,
                occurredAt: Date.now(),
                observedAt: Date.now(),
                providerEventId: null,
                source: "local",
              })
              .catch((error) => {
                logger.warn("UI:Chat:Kick", "confirmed delete history persistence failed", {
                  error: error instanceof Error ? error.message : String(error),
                });
              });
          }
          showModActionSuccessToast("Deleted message");
          return;
        }
        if (result.kind === "unauthenticated") {
          toast.error(t("chat.reconnectKickToDeleteMessages"), {
            description: t("chat.kickNeedsTheChatModerationPermission"),
          });
          return;
        }
        if (result.kind === "forbidden") {
          toast.error(t("chat.actionForbidden"), { description: result.message });
          return;
        }
        if (result.kind === "rate-limited") {
          const retry = result.retryAfterSeconds;
          toast.error(
            retry !== null
              ? t("chat.rateLimitedRetryInValue0S", { value0: retry })
              : t("chat.rateLimitedRetryShortly")
          );
          return;
        }
        toast.error(t("chat.couldnTDeleteMessage"), {
          description: result.message ?? result.kind,
        });
      } catch (error) {
        toast.error(t("chat.couldnTDeleteMessage"), {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [channel, channelId, chatroomId, kickUser, t]
  );

  const handlePinMessage = useCallback(
    async (message: ChatMessage) => {
      if (chatroomId === undefined) {
        toast.error(t("chat.couldnTPinMessage"), {
          description: t("chat.chatroomNotLoaded"),
        });
        return;
      }

      const senderId = Number(message.userId);
      if (!Number.isFinite(senderId)) {
        toast.error(t("chat.couldnTPinMessage"), {
          description: t("chat.messageSenderUnavailable"),
        });
        return;
      }

      try {
        const result = await window.electronAPI.kickChat.pinMessage({
          channelSlug: channel,
          messageId: message.id,
          chatroomId,
          content: message.rawContent,
          sender: {
            id: senderId,
            username: message.displayName || message.username,
            slug: message.username,
          },
          durationSeconds: null,
        });
        if (result.ok) {
          toast.success(t("chat.pinnedMessage"));
          return;
        }
        toast.error(t("chat.couldnTPinMessage"), {
          description: result.message || result.kind,
        });
      } catch (error) {
        toast.error(t("chat.couldnTPinMessage"), {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [channel, chatroomId, t]
  );

  const [activePoll, setActivePoll] = useState<KickPoll | null>(null);
  // U6 read-only viewer prediction. Currently fed via dev injection (U9);
  // real Kick prediction API + Pusher event discovery lives in U4.
  const [activePrediction, setActivePrediction] = useState<UnifiedPrediction | null>(null);
  // Sticky-dismiss gate. Suppress updates for any id the user has closed,
  // until a *different* id arrives.
  const predictionDismissGate = useStickyDismissedPrediction();
  const [showPoll, setShowPoll] = useState(true);
  const [isPollExpanded, setIsPollExpanded] = useState(false);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const [sendEligibility, setSendEligibility] = useState<ChatSendEligibility>(() =>
    resolveChatSendEligibility({
      isAuthenticated,
      canSend: isAuthenticated && isKickConnected,
      disabled: false,
    })
  );
  const handleSendEligibilityChange = useCallback((next: ChatSendEligibility) => {
    setSendEligibility((current) =>
      current.state === next.state &&
      (current.state === "eligible" ||
        (next.state === "ineligible" && current.reason === next.reason))
        ? current
        : next
    );
  }, []);
  // Auto-dismiss ended poll after 15 s; cancels on follow-up poll or unmount.
  const pollTimer = useManagedTimeout(useCallback(() => setActivePoll(null), []));
  // Latest subscriber badges, mirrored from the prop so the history-fetch
  // closure can resolve badge images without re-running the connection effect
  // every time the badges prop updates.
  const subscriberBadgesRef = useRef(subscriberBadges);

  // Track current channel for cleanup
  // Initialize with null so we know when it's the first connection.
  const currentChannelRef = useRef<{ channel: string; chatroomId?: number } | null>(null);

  // Initial Connection & Channel Joining
  useEffect(() => {
    // Use mounted flag for cleanup with React Strict Mode
    let isMounted = true;
    let sessionGate: ChatMessageGate<ChatMessage> | null = null;

    const connect = async () => {
      try {
        // Track channel changes for service cleanup. Chat history is now scoped
        // by channel bucket, so switching channels no longer destructively
        // clears the shared store.
        const isChannelChanged =
          !currentChannelRef.current ||
          currentChannelRef.current.channel !== channel ||
          currentChannelRef.current.chatroomId !== chatroomId;

        if (isChannelChanged) currentChannelRef.current = { channel, chatroomId };

        // Acquire a reference to the service (for multiview support)
        kickChatService.acquire(channel);

        const persistedHistoryReady =
          channel && channelId
            ? (() => {
                const recentMessagesLimit =
                  useAuthStore.getState().preferences?.chatDisplay?.recentMessagesLimit ??
                  DEFAULT_CHAT_DISPLAY_PREFERENCES.recentMessagesLimit;
                return primePersistedChatHistoryIntentAsync({
                  platform: "kick",
                  normalizedChannel: channel.toLowerCase(),
                  channelId,
                  limit: recentMessagesLimit,
                });
              })()
            : Promise.resolve(false);

        const kickToken = await window.electronAPI.auth.getToken("kick");

        if (!isMounted) return;

        // Sync 7TV enablement to the viewer's prefs BEFORE the global + channel
        // loads below so a disabled provider is excluded from this channel's
        // fetch (next-load semantics, R10). Read prefs imperatively — adding a
        // reactive dep here would re-run the whole connect effect. No-op when
        // the enabled set already matches.
        applyProviderPrefs(
          useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES
        );

        if (kickToken) {
          // Authenticated
          await kickChatService.connect({
            debug: import.meta.env.DEV,
          });

          if (!isMounted) return;

          // Initialize Kick Emotes
          initializeKickEmotes(kickToken.accessToken);
        } else {
          // Anonymous
          await kickChatService.connect({
            debug: import.meta.env.DEV,
          });

          if (!isMounted) return;
          // Just load 7TV globals (Kick has no global endpoint of its own).
        }

        if (!isMounted) return;

        // Use chatroomId for emote state when available, otherwise the slug.
        const emoteChannelId = chatroomId ? chatroomId.toString() : channel;

        if (isMounted && emoteChannelId) {
          setActiveChannel(emoteChannelId);
          // `kickUserId` (broadcaster user_id) is what 7TV keys Kick channels
          // by — distinct from `emoteChannelId` (the chatroom/slug map key).
        } else if (isMounted) {
          setActiveChannel(null);
        }

        const decorationReady = Promise.all([
          loadGlobalEmotes("kick", kickToken ? { force: true } : undefined),
          emoteChannelId
            ? loadChannelEmotes(emoteChannelId, channel, "kick", kickUserId)
            : Promise.resolve(),
        ]);

        if (!isMounted) return;

        if (channel && chatroomId) {
          // Persisted hydration replaces the bucket, so it must settle before
          // the first live message can arrive. It runs concurrently with the
          // socket connection above.
          await persistedHistoryReady;
          if (!isMounted) return;
          const gate = createChatMessageGate<ChatMessage>((message) =>
            addMessageBatched(message, channelKey)
          );
          sessionGate = gate;
          liveMessageGateRef.current = gate;
          addMessage(createConnectionStatusMessage(channel, "connecting"));
          const parsedBroadcasterId = Number(channelId);
          const broadcasterUserId = Number.isFinite(parsedBroadcasterId)
            ? parsedBroadcasterId
            : undefined;
          await kickChatService.joinChannel(channel, chatroomId, broadcasterUserId);
          if (!isMounted) return;

          // Backfill recent history while live arrivals wait behind the gate.
          if (kickChannelId) {
            await seedKickChatHistory({
              channelId: kickChannelId,
              channel,
              isMounted: () => isMounted,
              prependMessages,
              subscriberBadges: subscriberBadgesRef.current,
              // Route through the same service event the live Pusher path uses,
              // not the local setPinnedMessage/setShowPinned/setIsPinExpanded
              // triplet. Identifiers from the React component closure can become
              // stale on Vite HMR if a fresh module is swapped in while this
              // async work is mid-flight, throwing a ReferenceError when the
              // callback later resolves. The service singleton lives outside
              // the React tree and survives HMR unchanged.
              onPinnedMessage: (pin) => {
                kickChatService.emit("pinnedMessage", pin);
              },
              onParsedMessages: (messages) => {
                const ownKickUserId = useAuthStore.getState().kickUser?.id;
                for (const message of messages) {
                  const isModerator = readOwnKickModeratorState(message, channel, ownKickUserId);
                  if (isModerator === null) continue;
                  setKickChannelModState(channel, isModerator);
                  kickChatService.setModeratorState(channel, isModerator);
                }
              },
            });
            if (!isMounted) return;
          }

          await decorationReady;
          if (!isMounted) return;
          if (liveMessageGateRef.current === gate) gate.open();

          // U1 — wire the predictions service in. Fires a REST seed for any
          // active/recent prediction, subscribes to predictions-channel-{N}
          // on the shared Pusher singleton, and emits predictionUpdate
          // through kickChatService. Service is idempotent on repeat acquire
          // and ref-counted so multiview is safe. Token is optional;
          // anonymous works for guests.
          if (channelId) {
            void kickPredictionsService.acquire({
              channelId,
              channelSlug: channel,
              accessToken: kickToken?.accessToken,
            });
          }

          // 3. Confirm the live session is up.
          addMessage(createConnectionStatusMessage(channel, "connected"));
        }
      } catch (error) {
        if (isMounted) {
          logger.error("UI:Chat:Kick", "failed to connect Kick chat", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    connect();

    return () => {
      isMounted = false;
      if (sessionGate && liveMessageGateRef.current === sessionGate) {
        sessionGate.cancel();
        liveMessageGateRef.current = null;
      }

      // Cleanup: release the service reference
      // In single-view: This will trigger shutdown when activeUsers reaches 0
      // In multi-view: Other components keep the service alive
      if (currentChannelRef.current?.channel) {
        if (channelId) {
          const releasedChannel = currentChannelRef.current.channel;
          void savePersistedChatHistory(
            "kick",
            releasedChannel,
            channelId,
            useChatStore.getState().messagesByChannel[buildChannelKey("kick", releasedChannel)] ??
              []
          );
        }
        // U1 — release the predictions service reference for this channel.
        // Pairs with the acquire() above. Safe to call even if acquire never
        // ran (no-op when the channelId is unknown).
        if (channelId) {
          kickPredictionsService.release({
            channelId,
            skipPusherUnsubscribe: kickChatService.getActiveUserCount() <= 1,
          });
        }

        kickChatService.release(currentChannelRef.current.channel);

        // Memory cleanup: unload channel emotes to free RAM
        const emoteChannelId = currentChannelRef.current.chatroomId
          ? currentChannelRef.current.chatroomId.toString()
          : currentChannelRef.current.channel;
        unloadChannelEmotes(emoteChannelId);
        setActiveChannel(null);
      }
      if (currentChannelRef.current) {
        useChatStore
          .getState()
          .flushBatch(buildChannelKey("kick", currentChannelRef.current.channel));
      }
      currentChannelRef.current = null;
    };
  }, [
    channel,
    channelId,
    kickChannelId,
    chatroomId,
    kickUserId,
    loadGlobalEmotes,
    loadChannelEmotes,
    setActiveChannel,
    unloadChannelEmotes,
    applyProviderPrefs,
    addMessageBatched,
    channelKey,
    addMessage,
    prependMessages,
    setKickChannelModState,
  ]);

  // Separate effect for updating subscriber badges without triggering reconnection
  // This is intentionally separate from the connection effect to prevent badge updates
  // from causing the chat to disconnect and reconnect
  useEffect(() => {
    subscriberBadgesRef.current = subscriberBadges;
    if (channel && subscriberBadges && subscriberBadges.length > 0) {
      kickChatService.setChannelBadges(channel, subscriberBadges);
      useChatStore
        .getState()
        .rehydrateChannelBadges(channelKey, (badges) =>
          resolveKickSubscriberBadges(badges, subscriberBadges)
        );
    }
  }, [channel, channelKey, subscriberBadges]);

  const bannerChannelRef = useRef(channel);
  useEffect(() => {
    if (bannerChannelRef.current === channel) return;
    bannerChannelRef.current = channel;
    setPinnedMessage(null);
    setShowPinned(true);
    setIsPinExpanded(false);
    setActivePrediction(null);
    setActivePoll(null);
    setShowPoll(true);
    setIsPollExpanded(false);
    setUnbanUserIds(new Set());
    pollTimer.clear();
  }, [channel, pollTimer]);

  // Event Listeners
  useEffect(() => {
    const handleMessage = (message: ChatMessage) => {
      if (message.platform === "kick") {
        if (buildChannelKey("kick", message.channel) !== channelKey) return;
        const isModerator = readOwnKickModeratorState(message, channel, kickUser?.id);
        if (isModerator !== null) {
          setKickChannelModState(channel, isModerator);
          kickChatService.setModeratorState(channel, isModerator);
        }
      }
    };

    const handleUserNotice = (notice: UserNotice) => {
      if (notice.platform !== "kick") return;
      // U5 — viewer can hide sub / gifted-sub / host-raid lines. Read prefs
      // imperatively so this handler isn't re-registered (and Pusher isn't
      // resubscribed) on every preference change.
      const cd =
        useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
      if (!cd.showUserNotices) return;
      const systemMessage: ChatMessage = {
        id: notice.id,
        platform: notice.platform,
        type: "system",
        channel: notice.channel,
        userId: notice.userId || notice.username || "system",
        username: notice.username || notice.displayName || "system",
        displayName: notice.displayName || notice.username || "System",
        color: notice.color ?? "",
        badges: [],
        content: [{ type: "text", content: notice.systemMessage }],
        rawContent: notice.systemMessage,
        timestamp: notice.timestamp,
        isDeleted: false,
        isHighlighted: true,
        highlightKind: getNoticeHighlightKind(notice.type),
        isAction: false,
      };
      addMessage(systemMessage);
    };

    const handleConnectionStatus = (status: ChatConnectionStatus) => {
      if (status.platform === "kick") {
        updateConnectionStatus(status);
      }
    };

    const handleClearChat = (clear: ClearChat) => {
      if (clear.platform !== "kick") return;
      if (clear.channel !== channel) return;
      // U5 — `showClearChat` gates the chat-cleared NOTICE line, not the
      // moderation effect: the messages are still removed, only the "Chat was
      // cleared" / ban marker is hidden.
      const cd =
        useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
      const clearChannelKey = buildChannelKey("kick", clear.channel);

      if (clear.isClearAll) {
        clearMessages(clearChannelKey);
        if (!cd.showClearChat) return;
        addMessage({
          id: crypto.randomUUID(),
          platform: clear.platform,
          type: "system",
          channel: clear.channel,
          userId: "system",
          username: "System",
          displayName: "System",
          color: "#808080",
          badges: [],
          content: [{ type: "text", content: "Chat was cleared" }],
          rawContent: "Chat was cleared",
          timestamp: clear.timestamp,
          isDeleted: false,
          isHighlighted: true,
          isAction: false,
        });
      } else if (clear.targetUserId) {
        markUserUnbannable(clear.targetUserId);
        const messages = useChatStore.getState().messagesByChannel[clearChannelKey] ?? [];
        let retainedUserMessage: ChatMessage | undefined;
        let moderatorMessage: ChatMessage | undefined;
        const deletedMessageDetails = messages.reduce<RetainedDeletedMessage[]>((acc, m) => {
          if (m.userId !== clear.targetUserId || m.type !== "message") return acc;
          retainedUserMessage = m;
          if (m.rawContent.trim().length === 0) return acc;
          acc.push({
            id: m.id,
            author: {
              userId: m.userId,
              username: m.username,
              displayName: m.displayName,
              color: m.color,
              badges: m.badges,
            },
            content: m.content,
            rawContent: m.rawContent,
            deletedAt: clear.timestamp,
          });
          return acc;
        }, []);
        const deletedMessageBodies = deletedMessageDetails.map(
          (deletedMessage) => deletedMessage.rawContent
        );
        if (clear.bannedByUsername) {
          const moderatorLogin = clear.bannedByUsername.toLowerCase();
          moderatorMessage = messages.find(
            (m) => m.username.toLowerCase() === moderatorLogin && m.type === "message"
          );
        }
        const moderatorUser = moderatorMessage
          ? {
              userId: moderatorMessage.userId,
              username: moderatorMessage.username,
              displayName: moderatorMessage.displayName,
              color: moderatorMessage.color,
              badges: moderatorMessage.badges,
            }
          : undefined;
        const moderatorUsername = moderatorUser?.username || clear.bannedByUsername?.trim() || "";
        const moderatorUserId = moderatorUser?.userId || moderatorUsername;
        if (isMod && channelId && moderatorUserId && moderatorUsername) {
          const occurredAt = clear.timestamp.getTime();
          void modLogWriter
            .record({
              platform: "kick",
              channelId,
              channelSlug: channel,
              action: clear.duration && clear.duration > 0 ? "timeout" : "ban",
              targetUserId: clear.targetUserId,
              targetUsername: clear.targetUsername || clear.targetUserId,
              moderatorUserId,
              moderatorUsername,
              durationSeconds: clear.duration ?? null,
              reason: null,
              occurredAt,
              observedAt: Date.now(),
              providerEventId: null,
              source: "pusher",
            })
            .catch((error) => {
              logger.warn("UI:Chat:Kick", "observed moderation history persistence failed", {
                error: error instanceof Error ? error.message : String(error),
              });
            });
        }
        const lastDeletedMessage = deletedMessageBodies[deletedMessageBodies.length - 1];
        deleteMessagesByUser(clearChannelKey, clear.targetUserId, {
          deletedAt: clear.timestamp,
          ...(moderatorUser ? { deletedByUser: moderatorUser } : {}),
          deletedByUsername: clear.bannedByUsername,
        });
        addMessage({
          id: crypto.randomUUID(),
          platform: clear.platform,
          type: "ban",
          channel: clear.channel,
          userId: "system",
          username: "System",
          displayName: "System",
          color: "#808080",
          badges: [],
          content: [],
          rawContent: "",
          timestamp: clear.timestamp,
          isDeleted: false,
          isHighlighted: false,
          isAction: false,
          banInfo: {
            bannedUsername: clear.targetUsername ?? clear.targetUserId,
            bannedByUsername: clear.bannedByUsername,
            ...(retainedUserMessage
              ? {
                  bannedUser: {
                    userId: retainedUserMessage.userId,
                    username: retainedUserMessage.username,
                    displayName: retainedUserMessage.displayName,
                    color: retainedUserMessage.color,
                    badges: retainedUserMessage.badges,
                  },
                }
              : {}),
            ...(moderatorUser ? { bannedByUser: moderatorUser } : {}),
            lastMessage: lastDeletedMessage ?? retainedUserMessage?.rawContent,
            deletedMessages: deletedMessageBodies,
            deletedMessageDetails,
            duration: clear.duration,
          },
        });
      }
    };

    const handleMessageDeleted = (deletion: MessageDeletion) => {
      if (deletion.channel !== channel) return;
      deleteMessage(buildChannelKey("kick", deletion.channel), deletion.messageId, {
        deletedAt: deletion.timestamp,
        ...(deletion.deletedByUser ? { deletedByUser: deletion.deletedByUser } : {}),
        ...(deletion.deletedByUsername ? { deletedByUsername: deletion.deletedByUsername } : {}),
      });
    };

    const handleError = (error: Error) => {
      logger.error("UI:Chat:Kick", "kick chat error", {
        error: error instanceof Error ? error.message : String(error),
      });
    };

    const handlePinnedMessage = (msg: NormalizedPinnedMessage) => {
      if (msg.channel && buildChannelKey("kick", msg.channel) !== channelKey) return;
      const map = useEmoteStore
        .getState()
        .getEmoteNameMap(chatroomId ? String(chatroomId) : channel);
      const enrichedContent = substituteThirdPartyEmotes(msg.content, map);
      const enriched = enrichedContent === msg.content ? msg : { ...msg, content: enrichedContent };
      setPinnedMessage(enriched);
      setShowPinned(true);
      setIsPinExpanded(false);
    };

    const handlePinnedMessageCleared = (eventChannel?: string) => {
      if (eventChannel && buildChannelKey("kick", eventChannel) !== channelKey) return;
      setPinnedMessage(null);
    };

    const handlePollUpdate = (poll: KickPoll) => {
      if (poll.channel && buildChannelKey("kick", poll.channel) !== channelKey) return;
      setActivePoll(poll);
      setShowPoll(true);
      if (poll.remaining <= 0) {
        // Auto-dismiss after 15 s. start() cancels any prior pending dismissal
        // so back-to-back polls don't stack timeouts.
        pollTimer.start(15000);
      }
    };

    const handlePredictionUpdate = (prediction: UnifiedPrediction) => {
      // Multiview gate — drop events for channels other than this panel.
      // kickChatService is a singleton; without this filter a prediction
      // emitted for channel A would also pop in channel B. We accept the
      // event when channelId is unknown (anonymous / dev-injection paths
      // that don't carry a real id yet). (Code review P0-1.)
      //
      // U1 dual-ID defense: Kick exposes two numeric IDs per channel
      // (`user_id` vs `channel.id`). kick.com's bundle subscribes its
      // predictions-channel-{N} Pusher subscription using the channel
      // record's `id`, but the value flowing into this filter depends on
      // which id flavor `kickRoomKey` resolved to. Match on EITHER the
      // numeric id OR the slug — the slug is stable across both flavors,
      // so the filter accepts the legit event regardless. See
      // docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md.
      const localId = kickRoomKey || null;
      const matchesId = !localId || !prediction.channelId || prediction.channelId === localId;
      const matchesSlug =
        !!channel && !!prediction.channelSlug && prediction.channelSlug === channel;
      if (!matchesId && !matchesSlug) {
        return;
      }
      if (predictionDismissGate.shouldSuppress(prediction.id)) return;
      setActivePrediction(prediction);
    };

    const unregisterMessageRoute = registerChatMessageRoute({
      platform: "kick",
      channel,
      emoteChannelId: chatroomId ? String(chatroomId) : channel,
    });
    kickChatService.on("message", handleMessage);
    kickChatService.on("userNotice", handleUserNotice);
    kickChatService.on("connectionStateChange", handleConnectionStatus);
    kickChatService.on("clearChat", handleClearChat);
    kickChatService.on("messageDeleted", handleMessageDeleted);
    kickChatService.on("error", handleError);
    kickChatService.on("pinnedMessage", handlePinnedMessage);
    kickChatService.on("pinnedMessageCleared", handlePinnedMessageCleared);
    kickChatService.on("pollUpdate", handlePollUpdate);
    kickChatService.on("predictionUpdate", handlePredictionUpdate);

    return () => {
      unregisterMessageRoute();
      kickChatService.off("message", handleMessage);
      kickChatService.off("userNotice", handleUserNotice);
      kickChatService.off("connectionStateChange", handleConnectionStatus);
      kickChatService.off("clearChat", handleClearChat);
      kickChatService.off("messageDeleted", handleMessageDeleted);
      kickChatService.off("error", handleError);
      kickChatService.off("pinnedMessage", handlePinnedMessage);
      kickChatService.off("pinnedMessageCleared", handlePinnedMessageCleared);
      kickChatService.off("pollUpdate", handlePollUpdate);
      kickChatService.off("predictionUpdate", handlePredictionUpdate);
    };
  }, [
    addMessage,
    addMessageBatched,
    updateConnectionStatus,
    clearMessages,
    deleteMessage,
    deleteMessagesByUser,
    channelKey,
    channel,
    channelId,
    chatroomId,
    isMod,
    kickRoomKey,
    kickUser?.id,
    setKickChannelModState,
    markUserUnbannable,
    predictionDismissGate,
    pollTimer,
  ]);

  const handleReply = useCallback((message: ChatMessage) => {
    chatInputRef.current?.replyTo(message);
  }, []);
  const handleCopyToChat = useCallback((message: string) => {
    chatInputRef.current?.setDraft(message);
  }, []);
  const handleViewUserChannel = useCallback(
    (platform: "twitch" | "kick", resolved: { username: string }) => {
      void router.navigate({
        to: "/stream/$platform/$channel",
        params: { platform, channel: resolved.username },
      });
    },
    []
  );
  const userPopoutPublicActions = useMemo(
    () => ({
      replyEligibility: isAuthenticated ? sendEligibility : null,
      onReply: handleReply,
      onCopyToChat: handleCopyToChat,
      onViewChannel: handleViewUserChannel,
    }),
    [handleCopyToChat, handleReply, handleViewUserChannel, isAuthenticated, sendEligibility]
  );

  // Stable callbacks for PredictionBanner — see TwitchChat for context.
  const handlePredictionAutoDismiss = useCallback(() => {
    setActivePrediction(null);
  }, []);
  const handlePredictionDismiss = useCallback(() => {
    setActivePrediction((current) => {
      if (current) predictionDismissGate.dismiss(current.id);
      return null;
    });
  }, [predictionDismissGate]);

  // U19 — Kick gets 2 tabs at most (no Engagement). Viewer = chat only,
  // mod (including broadcaster, who is the only Kick mod-of-self today)
  // adds modlog.
  const visibleTabs: ChatPanelTabId[] = ["chat"];
  if (isMod) {
    visibleTabs.push("modlog");
  }

  // U19 — Chat-tab body. Keeps existing pinned banner / poll widget / mod
  // strip / message list / input footer wiring intact. The mod-action and
  // pin dialogs stay outside the tab so they overlay regardless of tab.
  const chatBody = (
    <div className="flex flex-col h-full w-full">
      {/* Prediction Banner (U6) — read-only viewer widget. Fed by U4 in
          production (TBD) and by ChatSimTool dev injection today. */}
      {showPredictions && activePrediction && (
        <PredictionBanner
          prediction={activePrediction}
          onAutoDismiss={handlePredictionAutoDismiss}
          onDismiss={handlePredictionDismiss}
        />
      )}

      {/* Poll Widget */}
      {showPolls && activePoll && showPoll && (
        <KickPollWidget
          poll={activePoll}
          isExpanded={isPollExpanded}
          onToggleExpand={() => setIsPollExpanded((v) => !v)}
          onDismiss={() => setShowPoll(false)}
        />
      )}

      {/* U13: Inline controls cover the four chat modes plus a local clear.
       *  Other Kick commands use the composer catalog. */}
      {isMod && kickRoomKey ? (
        <InlineModStrip
          platform="kick"
          isBroadcaster={false}
          channelId={kickRoomKey}
          channelSlug={channel}
          roomState={roomState}
          onActionClick={(action: InlineModAction) => {
            switch (action.kind) {
              case "slow-mode":
              case "followers-only":
              case "subscribers-only":
              case "emote-only":
                setPendingModAction({
                  kind: "stripChatMode",
                  modeKind: action.kind,
                  currentlyActive: action.currentlyActive,
                });
                return;
              case "clear":
                setPendingModAction({ kind: "strip", actionType: "clear" });
                return;
              // Twitch-only actions never reach here — the strip hides them.
              default:
                return;
            }
          }}
        />
      ) : null}

      <div className="flex-1 min-h-0 relative">
        {pinnedMessage && showPinned && (
          <PinnedMessageBanner
            pin={pinnedMessage}
            viewerRole={isMod ? "mod" : "viewer"}
            isExpanded={isPinExpanded}
            onExpandToggle={() => setIsPinExpanded((v) => !v)}
            onDismiss={() => setShowPinned(false)}
            onUnpin={
              isMod
                ? async () => {
                    try {
                      const result = await window.electronAPI.kickChat.unpinMessage(channel);
                      if (result.ok) {
                        // Optimistic clear. The PinnedMessageDeletedEvent
                        // from Pusher will fire shortly after Kick processes
                        // the unpin and confirms the local state.
                        setPinnedMessage(null);
                      }
                    } catch (error) {
                      if (process.env.NODE_ENV !== "production") {
                        logger.error("UI:Chat:Kick", "kick unpin failed", {
                          error: error instanceof Error ? error.message : String(error),
                        });
                      }
                    }
                  }
                : undefined
            }
            currentChannelContext={currentChannelContext}
          />
        )}
        <ChatMessageList
          key={`kick-${channel}-${chatroomId}`}
          channelKey={channelKey}
          onReply={isAuthenticated ? handleReply : undefined}
          onPin={isMod ? handlePinMessage : undefined}
          onTimeout={
            isMod
              ? (message) =>
                  setPendingModAction({ kind: "messageScoped", message, actionType: "timeout" })
              : undefined
          }
          onBan={
            isMod
              ? (message) =>
                  setPendingModAction({ kind: "messageScoped", message, actionType: "ban" })
              : undefined
          }
          onUnban={
            isMod
              ? (message) =>
                  setPendingModAction({ kind: "messageScoped", message, actionType: "unban" })
              : undefined
          }
          unbanUserIds={unbanUserIds}
          onDelete={isMod ? handleDeleteMessage : undefined}
          selfUserId={kickUser ? String(kickUser.id) : undefined}
          currentChannelContext={currentChannelContext}
        />
      </div>

      {showComposer && (
        <ChatComposerFooter>
          {/* Footer composer owns message send actions and quick chat settings. */}
          <ChatInput
            ref={chatInputRef}
            platform="kick"
            channel={channel}
            channelId={kickRoomKey || null}
            chatroomId={chatroomId}
            kickUserId={kickUserId}
            canSend={isAuthenticated && isKickConnected}
            isAuthenticated={isAuthenticated}
            viewerUserId={isAuthenticated && kickUser ? String(kickUser.id) : undefined}
            commandAccess={commandAccess}
            onProviderCommand={executeKickCommand}
            onAuthRequired={() => loginKick()}
            viewerCanBypassRoomModes={isMod}
            viewerAccountAgeRequirement={viewerAccountAgeRequirement}
            checkSubscriberEligibility={(request) =>
              window.electronAPI.chat.checkSubscriberEligibility(request)
            }
            showModViewLink={isAuthenticated && isMod}
            onSendEligibilityChange={handleSendEligibilityChange}
          />
        </ChatComposerFooter>
      )}
    </div>
  );

  return (
    <UserPopoutProvider
      publicActions={userPopoutPublicActions}
      badgeCatalog={{
        state: badgeCatalogState,
        sourceLabel: "Kick · Live chat",
        retry: retryBadgeCatalog,
      }}
    >
      <div className="flex flex-col h-full w-full bg-gradient-to-b from-[#141414] to-[#171717]">
        <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="text-white">{t("chat.chat")}</span>
          </h2>
          <RecentChattersButton
            panelId={recentChattersPanelId}
            open={showRecentChatters}
            onClick={() => setShowRecentChatters((open) => !open)}
          />
        </div>
        <div className="relative min-h-0 flex-1">
          <ChatPanelTabs visibleTabs={visibleTabs}>
            {{
              chat: chatBody,
              modlog: channelId ? (
                <ModLogTab platform="kick" channelId={channelId} channelSlug={channel} />
              ) : (
                <div className="p-4 text-neutral-400">{t("chat.noChannelSelected")}</div>
              ),
            }}
          </ChatPanelTabs>
          {showRecentChatters ? (
            <RecentChattersPanel
              key={channelKey}
              id={recentChattersPanelId}
              channelKey={channelKey}
              onClose={() => setShowRecentChatters(false)}
            />
          ) : null}
        </div>

        {/* U11/U13 — Generic mod-action confirm dialog for Kick. The pin dialog
         *  stays separate (plan decision #12). Kick has no scope-reconnect
         *  flow, so the result branches are simpler than Twitch's. */}
        {pendingModAction
          ? (() => {
              const action = pendingModAction;
              if (action.kind === "messageScoped" && action.actionType === "timeout") {
                return (
                  <StateAwareTimeoutAction
                    presentation="dialog"
                    open
                    onOpenChange={(nextOpen) => {
                      if (!nextOpen) setPendingModAction(null);
                    }}
                    binding={{
                      platform: "kick",
                      channelId: channelId ?? "",
                      channelSlug: channel,
                      targetUserId: action.message.userId,
                      targetUsername: action.message.username,
                      selectedMessageId: action.message.id,
                      action: "timeout",
                    }}
                    displayName={action.message.displayName || action.message.username}
                    targetPreview={
                      <div>
                        <div className="line-clamp-2">{action.message.rawContent || ""}</div>
                        <div className="mt-1 text-xs text-[var(--color-foreground-muted)]">
                          {t("chat.fromValue0", { value0: action.message.username })}
                        </div>
                      </div>
                    }
                    onPendingChange={setModActionBusy}
                    onSuccess={async () => {
                      markUserUnbannable(action.message.userId);
                      await queryClient.invalidateQueries({
                        queryKey: MOD_LOG_QUERY_KEYS.channel("kick", channelId ?? ""),
                      });
                    }}
                  />
                );
              }
              let actionType: ModActionType;
              let targetPreview: React.ReactNode;
              if (action.kind === "messageScoped") {
                actionType = action.actionType;
                targetPreview = (
                  <div>
                    <div className="line-clamp-2">{action.message.rawContent || ""}</div>
                    <div className="text-xs text-[var(--color-foreground-muted)] mt-1">
                      {t("chat.fromValue0", { value0: action.message.username })}
                    </div>
                  </div>
                );
              } else if (action.kind === "stripChatMode") {
                // Re-use a Twitch-purple variant for the look; preview text carries
                // the real wording (Kick has its own copy needs but we share the
                // single dialog body to keep the surface minimal).
                actionType = "uniqueChat";
                const LABEL: Record<typeof action.modeKind, [string, string]> = {
                  "slow-mode": ["Turn ON slow mode", "Turn OFF slow mode"],
                  "followers-only": ["Turn ON followers-only mode", "Turn OFF followers-only mode"],
                  "subscribers-only": [
                    "Turn ON subscribers-only mode",
                    "Turn OFF subscribers-only mode",
                  ],
                  "emote-only": ["Turn ON emote-only mode", "Turn OFF emote-only mode"],
                };
                const [on, off] = LABEL[action.modeKind];
                targetPreview = (
                  <div className="text-sm font-medium">{action.currentlyActive ? off : on}</div>
                );
              } else {
                actionType = "clear";
                targetPreview = (
                  <div className="text-sm">{t("chat.clearChatForEveryoneInThisChannel")}</div>
                );
              }

              const needsSlowSlot =
                action.kind === "stripChatMode" &&
                action.modeKind === "slow-mode" &&
                !action.currentlyActive;
              const needsFollowersSlot =
                action.kind === "stripChatMode" &&
                action.modeKind === "followers-only" &&
                !action.currentlyActive;

              return (
                <ModActionConfirmDialog
                  open={!!pendingModAction}
                  onOpenChange={(open) => {
                    if (!open) setPendingModAction(null);
                  }}
                  actionType={actionType}
                  targetPreview={targetPreview}
                  busy={modActionBusy}
                  extraSlot={
                    needsSlowSlot || needsFollowersSlot
                      ? ({ onDataChange, disabled }) => (
                          <TimeoutDurationPicker
                            disabled={disabled}
                            onChange={(s) => onDataChange({ durationSeconds: s })}
                          />
                        )
                      : undefined
                  }
                  onConfirm={async (extraData) => {
                    if (!pendingModAction) return;
                    setModActionBusy(true);
                    try {
                      // Local-only clear: no API call, no token needed.
                      if (action.kind === "strip" && action.actionType === "clear") {
                        clearMessages(channelKey);
                        setPendingModAction(null);
                        toast.success(t("chat.clearedLocalChat"));
                        return;
                      }
                      let result: KickModResult;
                      if (action.kind === "stripChatMode") {
                        const token = await window.electronAPI.auth.getToken("kick");
                        if (!token?.accessToken) {
                          setPendingModAction(null);
                          toast.error(t("chat.signInToKickToTakeThisAction"));
                          return;
                        }
                        const turnOn = !action.currentlyActive;
                        const seconds =
                          (extraData as { durationSeconds?: number } | undefined)
                            ?.durationSeconds ?? 30;
                        if (action.modeKind === "slow-mode") {
                          result = await setKickChatMode({
                            channelSlug: channel,
                            accessToken: token.accessToken,
                            update: {
                              slowMode: { enabled: turnOn, seconds: turnOn ? seconds : 0 },
                            },
                          });
                        } else if (action.modeKind === "followers-only") {
                          const minutes = Math.max(0, Math.floor(seconds / 60));
                          result = await setKickChatMode({
                            channelSlug: channel,
                            accessToken: token.accessToken,
                            update: {
                              followersOnly: {
                                enabled: turnOn,
                                minutes: turnOn ? minutes : 0,
                              },
                            },
                          });
                        } else if (action.modeKind === "subscribers-only") {
                          result = await setKickChatMode({
                            channelSlug: channel,
                            accessToken: token.accessToken,
                            update: { subscribersOnly: { enabled: turnOn } },
                          });
                        } else {
                          result = await setKickChatMode({
                            channelSlug: channel,
                            accessToken: token.accessToken,
                            update: { emoteOnly: { enabled: turnOn } },
                          });
                        }
                        if (result.ok) {
                          if (kickRoomKey) {
                            if (action.modeKind === "slow-mode") {
                              updateRoomState("kick", kickRoomKey, {
                                slowMode: turnOn ? seconds : null,
                              });
                            } else if (action.modeKind === "followers-only") {
                              const minutes = Math.max(0, Math.floor(seconds / 60));
                              updateRoomState("kick", kickRoomKey, {
                                followersOnly: turnOn ? minutes : null,
                              });
                            } else if (action.modeKind === "subscribers-only") {
                              updateRoomState("kick", kickRoomKey, {
                                subscribersOnly: turnOn,
                              });
                            } else {
                              updateRoomState("kick", kickRoomKey, { emoteOnly: turnOn });
                            }
                          }
                          setPendingModAction(null);
                          toast.success(t("chat.chatModeUpdated"));
                          return;
                        }
                      } else if (action.kind === "messageScoped") {
                        const username = action.message.username;
                        let messageResult: KickModResult;
                        switch (action.actionType) {
                          case "ban":
                            messageResult = await banKickUserViaKickWebSession(
                              channel,
                              username,
                              t
                            );
                            break;
                          case "timeout":
                            throw new Error("Timeout must use the state-aware moderation IPC");
                          case "unban":
                            messageResult = await unbanKickUserViaKickWebSession(
                              channel,
                              username,
                              t
                            );
                            break;
                          case "delete":
                            if (chatroomId === undefined) {
                              setPendingModAction(null);
                              toast.error(t("chat.couldnTDeleteMessage"), {
                                description: t("chat.chatroomNotLoaded"),
                              });
                              return;
                            }
                            messageResult = await deleteKickMessageViaKickWebSession(
                              chatroomId,
                              action.message.id,
                              t
                            );
                            break;
                        }
                        result = messageResult;
                        if (result.ok) {
                          if (channelId && kickUser) {
                            void modLogWriter
                              .record({
                                platform: "kick",
                                channelId,
                                channelSlug: channel,
                                action: action.actionType,
                                targetUserId: action.message.userId,
                                targetUsername: username,
                                moderatorUserId: String(kickUser.id),
                                moderatorUsername: kickUser.username,
                                durationSeconds: null,
                                reason:
                                  action.actionType === "delete"
                                    ? action.message.rawContent || null
                                    : null,
                                occurredAt: Date.now(),
                                observedAt: Date.now(),
                                providerEventId: null,
                                source: "local",
                              })
                              .catch((error) => {
                                logger.warn(
                                  "UI:Chat:Kick",
                                  "confirmed moderation history persistence failed",
                                  {
                                    error: error instanceof Error ? error.message : String(error),
                                  }
                                );
                              });
                          }
                          setPendingModAction(null);
                          if (action.actionType === "ban") {
                            markUserUnbannable(action.message.userId);
                            showModActionSuccessToast(`Banned ${username}`);
                          } else if (action.actionType === "unban") {
                            markUserUnbanned(action.message.userId);
                            toast.success(t("chat.unbannedValue0", { value0: username }));
                          } else if (action.actionType === "delete") {
                            showModActionSuccessToast("Deleted message");
                          }
                          return;
                        }
                      } else {
                        // Unreachable — clear branch returned earlier.
                        return;
                      }

                      if (result.kind === "forbidden") {
                        toast.error(t("chat.actionForbidden"), {
                          description: result.message,
                        });
                        return;
                      }
                      if (result.kind === "rate-limited") {
                        const retry = result.retryAfterSeconds;
                        toast.error(
                          retry !== null
                            ? t("chat.rateLimitedRetryInValue0S", { value0: retry })
                            : t("chat.rateLimitedRetryShortly")
                        );
                        return;
                      }
                      setPendingModAction(null);
                      toast.error(t("chat.couldnTCompleteAction"), {
                        description: result.message ?? result.kind,
                      });
                    } finally {
                      setModActionBusy(false);
                    }
                  }}
                />
              );
            })()
          : null}
      </div>
    </UserPopoutProvider>
  );
};

// ========== Sub-components ==========

interface KickPollWidgetProps {
  poll: KickPoll;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDismiss: () => void;
}

const KickPollWidget: React.FC<KickPollWidgetProps> = ({
  poll,
  isExpanded,
  onToggleExpand,
  onDismiss,
}) => {
  const { t } = useTranslation();
  const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
  const maxVotes = Math.max(...poll.options.map((o) => o.votes), 0);
  const isPollEnded = poll.remaining <= 0;

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-background-tertiary,#1a1a1a)] text-sm">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-neutral-400 text-xs font-medium">{t("chat.poll")}</span>
          <span className="text-white text-xs font-semibold truncate">{poll.title}</span>
          {isPollEnded && (
            <span className="text-xs text-neutral-500 flex-shrink-0">{t("chat.ended")}</span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleExpand}
                aria-label={isExpanded ? t("chat.collapse") : t("chat.expand")}
                className="p-1 text-neutral-400 hover:text-white rounded transition-colors"
              >
                <BsChevronDown
                  size={12}
                  style={{
                    transform: isExpanded ? "rotate(180deg)" : "none",
                    transition: "transform 0.2s",
                  }}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{isExpanded ? t("chat.collapse") : t("chat.expand")}</TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onDismiss}
                aria-label={t("chat.dismiss")}
                className="p-1 text-neutral-400 hover:text-white rounded transition-colors"
              >
                <BsX size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("chat.dismiss")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {isExpanded && (
        <div className="px-3 pb-2 space-y-1.5">
          {poll.options.map((option) => {
            const pct = totalVotes === 0 ? 0 : (option.votes / totalVotes) * 100;
            const isWinner = isPollEnded && option.votes === maxVotes && maxVotes > 0;
            return (
              <div key={option.id}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className={isWinner ? "text-[#53FC18] font-semibold" : "text-white"}>
                    {option.label}
                    {isWinner && " 🏆"}
                  </span>
                  <span className="text-neutral-400">
                    {option.votes} ({pct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-[width,background-color] duration-300 ${isWinner ? "bg-[#53FC18]" : "bg-[var(--color-primary,#53FC18)]"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
          {!isPollEnded && poll.duration > 0 && (
            <div className="h-0.5 rounded-full bg-white/10 overflow-hidden mt-2">
              <div
                className="h-full bg-blue-500 rounded-full transition-[width] duration-1000"
                style={{ width: `${Math.min((poll.remaining / poll.duration) * 100, 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

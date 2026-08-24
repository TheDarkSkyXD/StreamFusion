import { useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { BsChevronDown, BsX } from "react-icons/bs";
import { toast } from "sonner";
import { SevenTvCosmeticsClient } from "@/backend/services/chat/seven-tv-cosmetics-client";
import { TwitchHermesClient } from "@/backend/services/chat/twitch-hermes-client";
import { useStickyDismissedPrediction } from "@/hooks/useStickyDismissedPrediction";
import { logger } from "@/renderer/logging/logger";
import { unwrapIpcReply } from "@/lib/ipc-reply";
import { router } from "@/routes/router";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@/shared/auth-types";
import type { UnifiedPrediction } from "@/shared/chat-types";
import type { TwitchChannelModeratePayload } from "@/shared/twitch-api-types";
import { substituteThirdPartyEmotes } from "../../../backend/services/chat/third-party-emote-enrich";
import { twitchChatService } from "../../../backend/services/chat/twitch-chat";
import {
  startTwitchPinPolling,
  stopTwitchPinPolling,
} from "../../../backend/services/chat/twitch-pin-poller";
import { initializeTwitchEmotes } from "../../../backend/services/emotes";
import { modLogWriter } from "../../../backend/services/mod-log-writer";
import { MOD_LOG_QUERY_KEYS } from "../../../hooks/mod-log-query-keys";
import { useChatRoomState } from "../../../hooks/useChatRoomState";
import { useChatSettingsSync } from "../../../hooks/useChatSettingsSync";
import { useInterval } from "../../../hooks/useInterval";
import { useHasActualTwitchModAuthority, useIsTwitchMod } from "../../../hooks/useIsTwitchMod";
import { useManagedTimeout } from "../../../hooks/useManagedTimeout";
import { useRequireModScopes } from "../../../hooks/useRequireModScopes";
import type {
  ChatConnectionStatus,
  ChatHighlightKind,
  ChatMessage,
  ChatUserPresentation,
  ClearChat,
  KickPoll,
  MessageDeletion,
  ModeratorStateEvent,
  NormalizedPinnedMessage,
  RetainedDeletedMessage,
  UserNotice,
} from "../../../shared/chat-types";
import { useAuthStore } from "../../../store/auth-store";
import { useChatCosmeticsStore } from "../../../store/chat-cosmetics-store";
import { buildChannelKey, useChatStore } from "../../../store/chat-store";
import { useDevModOverrideStore } from "../../../store/dev-mod-override-store";
import { useEmoteStore } from "../../../store/emote-store";
import { useModeratedChannelsStore } from "../../../store/moderated-channels-store";
import { useRoomStateStore } from "../../../store/room-state-store";
import { useRenderCount } from "../../dev/use-render-count";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { ChatComposerFooter } from "../ChatComposerFooter";
import { ChatInput, type ChatInputHandle } from "../ChatInput";
import { ChatMessageList } from "../ChatMessageList";
import { type ChatSendEligibility, resolveChatSendEligibility } from "../chat-send-eligibility";
import { type ChatPanelTabId, ChatPanelTabs } from "../mod/ChatPanelTabs";
import { type InlineModAction, InlineModStrip } from "../mod/InlineModStrip";
import { ModActionConfirmDialog, type ModActionType } from "../mod/ModActionConfirmDialog";
import { showModActionSuccessToast } from "../mod/mod-action-toast";
import { appendRecentRaid, type RaidTarget, RaidTargetPicker } from "../mod/RaidTargetPicker";
import { TimeoutDurationPicker } from "../mod/TimeoutDurationPicker";
import { EngagementTab } from "../mod/tabs/EngagementTab";
import { ModLogTab } from "../mod/tabs/ModLogTab";
import { StateAwareTimeoutAction } from "../mod/UserPopout/StateAwareTimeoutAction";
import { UserPopoutProvider } from "../mod/UserPopout/UserPopoutProvider";
import { PinnedMessageBanner } from "../PinnedMessageBanner";
import { PredictionBanner } from "../PredictionBanner";
import { RecentChattersButton, RecentChattersPanel } from "../RecentChattersPanel";
import { ModerationFixtureLauncher } from "./ModerationFixtureLauncher";
import { TwitchPinMessageDialog } from "./TwitchPinMessageDialog";
import { seedTwitchChatHistory } from "./twitch-chat-history";
import { createChatMessageGate, startChatSession, type ChatMessageGate } from "../chat-startup";

export interface TwitchChatProps {
  /** Channel name to join */
  channel: string;
  /** Channel ID (broadcaster ID) */
  channelId?: string;
}

/** U13/U15 — widened mod-action state. `messageScoped` covers U11's hover
 *  toolbar (Timeout/Ban/Unban/Delete). `stripChatMode` covers the four
 *  chat-mode toggles (slow / followers / subscribers / emote). `strip`
 *  covers the one-shot icons + Shield. */
type PendingTwitchModAction =
  | {
      kind: "messageScoped";
      message: ChatMessage;
      actionType: Extract<ModActionType, "timeout" | "ban" | "warn" | "unban" | "delete">;
    }
  | {
      kind: "stripChatMode";
      modeKind: "slow-mode" | "followers-only" | "subscribers-only" | "emote-only";
      currentlyActive: boolean;
    }
  | {
      kind: "strip";
      actionType: Extract<
        ModActionType,
        "clear" | "raid" | "commercial" | "shield" | "shieldOff" | "uniqueChat"
      >;
      currentlyActive?: boolean;
    };

const DEFAULT_TWITCH_PIN_DURATION_SECONDS = 30 * 60;
const TWITCH_BADGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function normalizeCosmeticUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

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

const CONNECTING_TEXT = "Connecting to channel...";
const CONNECTED_TEXT = "Connected to the channel";
const TWITCH_WARN_SCOPE = "moderator:manage:warnings";
const MAX_TWITCH_WARN_REASON_LENGTH = 500;

function createConnectionStatusMessage(
  channel: string,
  state: "connecting" | "connected"
): ChatMessage {
  const rawContent = state === "connecting" ? CONNECTING_TEXT : CONNECTED_TEXT;
  return {
    id: `system:twitch:${channel}:connection:${state}`,
    platform: "twitch",
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

export const TwitchChat: React.FC<TwitchChatProps> = ({ channel, channelId }) => {
  useRenderCount("TwitchChat");
  const queryClient = useQueryClient();
  // Chat store — subscribe only to fields read in render; actions have stable refs.
  // Narrow to a boolean so IRC PING heartbeats / disconnect-state churn don't
  // re-render the whole chat subtree on every tick.
  const isTwitchConnected = useChatStore(
    (state) => state.connectionStatus.twitch.state === "connected"
  );
  const addMessage = useChatStore((state) => state.addMessage);
  // Batched path for the high-volume IRC PRIVMSG stream. System / clear /
  // ban events still go through addMessage so they're applied immediately
  // and preserve total ordering with batched chat.
  const addMessageBatched = useChatStore((state) => state.addMessageBatched);
  const liveMessageGateRef = useRef<ChatMessageGate<ChatMessage> | null>(null);
  const prependMessages = useChatStore((state) => state.prependMessages);
  const updateConnectionStatus = useChatStore((state) => state.updateConnectionStatus);
  const clearMessages = useChatStore((state) => state.clearMessages);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const deleteMessagesByUser = useChatStore((state) => state.deleteMessagesByUser);
  const channelKey = buildChannelKey("twitch", channel);
  const recentChattersPanelId = useId();
  const [showRecentChatters, setShowRecentChatters] = useState(false);
  const [badgeCatalogStatus, setBadgeCatalogStatus] = useState<"loading" | "ready" | "failed">(
    "loading"
  );
  const [badgeCatalogRevision, setBadgeCatalogRevision] = useState(0);
  const retryBadgeCatalog = useCallback(() => {
    setBadgeCatalogRevision((revision) => revision + 1);
  }, []);

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
  // refresh required. twitchReconnectRequired keeps the gate closed in
  // the degraded post-revocation mode so the input doesn't pretend the
  // user can chat when their refresh token is dead.
  const isAuthenticated = useAuthStore(
    (state) => state.twitchConnected && !state.twitchReconnectRequired
  );
  const loginTwitch = useAuthStore((state) => state.loginTwitch);
  // U5 — gate the in-chat prediction widget on the viewer pref. Reactive
  // selector so toggling it live shows/hides the banner without remounting.
  const showPredictions = useAuthStore(
    (state) =>
      state.preferences?.chatDisplay?.showPredictions ??
      DEFAULT_CHAT_DISPLAY_PREFERENCES.showPredictions
  );
  const showPolls = useAuthStore(
    (state) =>
      state.preferences?.chatDisplay?.showPolls ?? DEFAULT_CHAT_DISPLAY_PREFERENCES.showPolls
  );
  const showTwitchPinDurationDialog = useAuthStore(
    (state) =>
      state.preferences?.chatDisplay?.showTwitchPinDurationDialog ??
      DEFAULT_CHAT_DISPLAY_PREFERENCES.showTwitchPinDurationDialog
  );
  const enable7tvBadges = useAuthStore(
    (state) =>
      state.preferences?.chatDisplay?.enable7tvBadges ??
      DEFAULT_CHAT_DISPLAY_PREFERENCES.enable7tvBadges
  );
  const enable7tvUsernamePaints = useAuthStore(
    (state) =>
      state.preferences?.chatDisplay?.enable7tvUsernamePaints ??
      DEFAULT_CHAT_DISPLAY_PREFERENCES.enable7tvUsernamePaints
  );
  const enableSevenTvCosmetics = enable7tvBadges || enable7tvUsernamePaints;
  const enableBttvBadges = useAuthStore(
    (state) =>
      state.preferences?.chatDisplay?.enableBttvBadges ??
      DEFAULT_CHAT_DISPLAY_PREFERENCES.enableBttvBadges
  );
  const enableFfzBadges = useAuthStore(
    (state) =>
      state.preferences?.chatDisplay?.enableFfzBadges ??
      DEFAULT_CHAT_DISPLAY_PREFERENCES.enableFfzBadges
  );
  const [pinnedMessage, setPinnedMessage] = useState<NormalizedPinnedMessage | null>(null);
  const [showPinned, setShowPinned] = useState(true);
  const [isPinExpanded, setIsPinExpanded] = useState(false);
  // U2 / U6 — viewer-side prediction state. Hermes WebSocket pushes via
  // twitchChatService.emit("predictionUpdate", …); dev injection (U9) fires
  // through the same seam, so production + dev paths converge.
  const [activePrediction, setActivePrediction] = useState<UnifiedPrediction | null>(null);
  const [activePoll, setActivePoll] = useState<KickPoll | null>(null);
  const [showPoll, setShowPoll] = useState(true);
  const [isPollExpanded, setIsPollExpanded] = useState(false);
  const pollTimer = useManagedTimeout(useCallback(() => setActivePoll(null), []));
  // Sticky-dismiss gate. Suppress updates for any id the user has closed,
  // until a *different* id arrives.
  const predictionDismissGate = useStickyDismissedPrediction();
  // Mod-action state (U8): the message currently queued for the Pin dialog.
  const [pinDialogMessage, setPinDialogMessage] = useState<ChatMessage | null>(null);
  const [pinDialogBusy, setPinDialogBusy] = useState(false);
  const [pinMenuBusy, setPinMenuBusy] = useState(false);
  // U11 — generic mod-action confirm dialog state (Timeout/Ban/Unban/Delete).
  // U13/U15 widened the union to include strip-driven actions which carry no
  // chat message. The dialog branches on `kind` to render the correct preview
  // and slot.
  const [pendingModAction, setPendingModAction] = useState<PendingTwitchModAction | null>(null);
  const [modActionBusy, setModActionBusy] = useState(false);
  const [warnReason, setWarnReason] = useState("");
  const [unbanUserIds, setUnbanUserIds] = useState<Set<string>>(() => new Set());
  // Optimistic local copy of the channel's chat-room state (U14). Reads + writes
  // flow through useRoomStateStore; the hook auto-fills DEFAULT_ROOM_STATE.
  const currentChannelContext = useMemo(
    () => (channelId ? { channelId, channelSlug: channel } : undefined),
    [channel, channelId]
  );
  const roomState = useChatRoomState("twitch", channelId ?? null);
  const hydrateModeratedChannels = useModeratedChannelsStore((s) => s.hydrate);
  const isModeratedChannelsStale = useModeratedChannelsStore((s) => s.isStale);
  const setTwitchChannelModState = useModeratedChannelsStore((s) => s.setTwitchChannelModState);
  const updateRoomState = useRoomStateStore((s) => s.updateRoomState);
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

  // U6 — merge seam. Initial Helix /chat/settings fetch + tmi.js roomstate
  // events + reconnect re-seed all converge through this hook into
  // useRoomStateStore. Optimistic mod-strip writes above continue to land
  // on the same key; last write wins.
  useChatSettingsSync({ platform: "twitch", channel, channelId });

  // Mod-role gating for Pin/Unpin actions. Both hooks return safe defaults
  // when the user isn't signed in or doesn't moderate the current channel.
  const isMod = useIsTwitchMod(channelId);
  const hasActualModAuthority = useHasActualTwitchModAuthority(channelId);
  const {
    hasModScopes,
    hasChannelModerateEventSubScopes,
    missingChannelModerateEventSubScopes,
    loading: modScopesLoading,
    promptReconnect,
  } = useRequireModScopes();
  const eventSubScopePromptKeyRef = useRef<string | null>(null);
  // Moderator's own Twitch user id — required for every Helix mod-action call
  // as the `moderator_id` query param. Pulled from the auth store rather than
  // re-fetched per call.
  const twitchUser = useAuthStore((state) => state.twitchUser);

  const currentModeratorPresentation = useCallback((): ChatUserPresentation | undefined => {
    if (!twitchUser?.id || !twitchUser.login) return undefined;
    return {
      userId: twitchUser.id,
      username: twitchUser.login,
      displayName: twitchUser.displayName || twitchUser.login,
      badges: [],
    };
  }, [twitchUser?.displayName, twitchUser?.id, twitchUser?.login]);

  const markMessageDeletedByModerator = useCallback(
    (messageId: string, moderator: ChatUserPresentation | undefined, deletedAt = new Date()) => {
      deleteMessage(channelKey, messageId, {
        deletedAt,
        ...(moderator ? { deletedByUser: moderator, deletedByUsername: moderator.username } : {}),
      });
    },
    [channelKey, deleteMessage]
  );

  useEffect(() => {
    if (!channelId || !twitchUser?.id) return;
    if (twitchUser.id === channelId) return;
    if (!isModeratedChannelsStale()) return;

    let cancelled = false;
    void (async () => {
      try {
        if (cancelled) return;
        await hydrateModeratedChannels(twitchUser.id);
      } catch {
        // AuthProvider also hydrates this cache; direct chat-page refresh is best-effort.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channelId, twitchUser?.id, hydrateModeratedChannels, isModeratedChannelsStale]);

  useEffect(() => {
    if (!channelId || !twitchUser?.id || !hasActualModAuthority || modScopesLoading) return;
    if (!hasChannelModerateEventSubScopes) {
      const promptKey = `${channelId}:${[...missingChannelModerateEventSubScopes].sort().join(",")}`;
      if (eventSubScopePromptKeyRef.current !== promptKey) {
        eventSubScopePromptKeyRef.current = promptKey;
        promptReconnect({ missingScopes: missingChannelModerateEventSubScopes });
      }
      return;
    }
    eventSubScopePromptKeyRef.current = null;

    let cancelled = false;
    const feedId = `chat-moderation:${channelId}:${twitchUser.id}`;
    const unsubscribeEvent = window.electronAPI.twitch.eventSub.onEvent((message) => {
      if (message.feedId !== feedId) return;
      const payload = message.payload as TwitchChannelModeratePayload;
      void modLogWriter
        .ingestEventSubModerate(
          payload as Parameters<typeof modLogWriter.ingestEventSubModerate>[0]
        )
        .catch((error) => {
          logger.warn("UI:Chat:Twitch", "channel.moderate history persistence failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      const event = payload.event;
      if (event.action !== "delete") return;
      if (event.broadcaster_user_id && event.broadcaster_user_id !== channelId) return;

      const deleted = event.delete;
      if (!deleted?.message_id) return;

      const moderatorUsername = event.moderator_user_login?.trim() || event.moderator_user_id;
      const moderator: ChatUserPresentation | undefined = moderatorUsername
        ? {
            userId: event.moderator_user_id || moderatorUsername,
            username: moderatorUsername,
            displayName: event.moderator_user_name?.trim() || moderatorUsername,
            badges: [],
          }
        : undefined;

      markMessageDeletedByModerator(deleted.message_id, moderator);
    });

    void (async () => {
      try {
        const result = await window.electronAPI.twitch.eventSub.start({
          feedId,
          userId: twitchUser.id,
          channelId,
        });
        if (!cancelled && !result.ok) throw new Error(result.error.message);
      } catch (error) {
        logger.warn("UI:Chat:Twitch", "twitch moderation EventSub subscribe failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeEvent();
      void window.electronAPI.twitch.eventSub.stop(feedId);
    };
  }, [
    channelId,
    hasActualModAuthority,
    hasChannelModerateEventSubScopes,
    markMessageDeletedByModerator,
    missingChannelModerateEventSubScopes,
    modScopesLoading,
    promptReconnect,
    twitchUser?.id,
  ]);

  const handleDeleteMessage = useCallback(
    async (message: ChatMessage) => {
      if (!channelId || !twitchUser?.id) {
        toast.error("Couldn't delete message", {
          description: "Channel or moderator identity not loaded",
        });
        return;
      }

      const runDelete = () =>
        window.electronAPI.twitch.execute({
          operation: "delete-chat-message",
          broadcasterId: channelId,
          moderatorId: twitchUser.id,
          messageId: message.id,
        });

      try {
        const result = await runDelete();
        if (result.ok) {
          markMessageDeletedByModerator(message.id, currentModeratorPresentation());
          showModActionSuccessToast("Deleted message");
          return;
        }
        if (result.error.code === "unauthorized") {
          promptReconnect({
            missingScopes: ["moderator:manage:chat_messages"],
            onReconnected: async () => {
              const retry = await runDelete();
              if (retry.ok) {
                markMessageDeletedByModerator(message.id, currentModeratorPresentation());
                showModActionSuccessToast("Deleted message");
              } else {
                toast.error("Couldn't delete message", {
                  description: retry.error.message,
                });
              }
            },
          });
          return;
        }
        toast.error("Couldn't delete message", {
          description: result.error.message,
        });
      } catch (error) {
        toast.error("Couldn't delete message", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      channelId,
      currentModeratorPresentation,
      markMessageDeletedByModerator,
      promptReconnect,
      twitchUser?.id,
    ]
  );

  // Track current channel for cleanup
  // Initialize with null so we know when it's the first connection.
  const currentChannelRef = useRef<string | null>(null);
  // Imperative handle on ChatInput for regular chat reply/mention actions.
  const chatInputRef = useRef<ChatInputHandle>(null);
  const [sendEligibility, setSendEligibility] = useState<ChatSendEligibility>(() =>
    resolveChatSendEligibility({
      isAuthenticated,
      canSend: isAuthenticated && isTwitchConnected,
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
  // Track channelId for emote cleanup
  const currentChannelIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!channelId || !enableSevenTvCosmetics) return;
    useChatCosmeticsStore.getState().acquireSevenTvChannel(channelId);
    const client = new SevenTvCosmeticsClient(channelId, (event) => {
      useChatCosmeticsStore.getState().applySevenTvEvent(channelId, event);
    });
    client.connect();
    return () => {
      client.disconnect();
      useChatCosmeticsStore.getState().releaseSevenTvChannel(channelId);
    };
  }, [channelId, enableSevenTvCosmetics]);

  useEffect(() => {
    if (!enableBttvBadges) return;
    const store = useChatCosmeticsStore.getState();
    if (!store.beginGlobalProviderLoad("bttv")) return;
    const getBttvBadges = window.electronAPI.emotes.bttv.getBadges;
    if (typeof getBttvBadges !== "function") {
      store.failGlobalProviderLoad("bttv");
      return;
    }
    void getBttvBadges()
      .then(unwrapIpcReply)
      .then((catalog) => {
        store.setGlobalProviderBadges(
          "bttv",
          catalog.map((entry) => ({
            userId: entry.providerId,
            badge: {
              id: `bttv:${entry.providerId}`,
              provider: "bttv" as const,
              providerId: entry.providerId,
              title: entry.badge.description || "BetterTTV badge",
              imageUrl: normalizeCosmeticUrl(entry.badge.svg),
            },
          }))
        );
      })
      .catch(() => store.failGlobalProviderLoad("bttv"));
  }, [enableBttvBadges]);

  useEffect(() => {
    if (!enableFfzBadges) return;
    const store = useChatCosmeticsStore.getState();
    if (!store.beginGlobalProviderLoad("ffz")) return;
    const getFfzBadges = window.electronAPI.emotes.ffz.getBadges;
    if (typeof getFfzBadges !== "function") {
      store.failGlobalProviderLoad("ffz");
      return;
    }
    void getFfzBadges()
      .then(unwrapIpcReply)
      .then((catalog) => {
        const definitions = new Map(catalog.badges.map((badge) => [String(badge.id), badge]));
        const assignments = Object.entries(catalog.users).flatMap(([badgeId, userIds]) => {
          const badge = definitions.get(badgeId);
          if (!badge) return [];
          return userIds.map((userId) => ({
            userId: String(userId),
            badge: {
              id: `ffz:${badgeId}`,
              provider: "ffz" as const,
              providerId: badgeId,
              title: badge.title || "FrankerFaceZ badge",
              imageUrl: normalizeCosmeticUrl(badge.urls["4"] ?? badge.urls["2"] ?? badge.urls["1"]),
              slot: badge.slot,
              replaces: badge.replaces,
              color: badge.color,
            },
          }));
        });
        store.setGlobalProviderBadges("ffz", assignments);
      })
      .catch(() => store.failGlobalProviderLoad("ffz"));
  }, [enableFfzBadges]);

  useEffect(() => {
    if (!channelId) return;
    const store = useChatCosmeticsStore.getState();
    if (!enableFfzBadges) {
      store.setFfzRoleBadges(channelId, {});
      return;
    }
    let active = true;
    const getFfzRoom = window.electronAPI.emotes.ffz.getRoom;
    if (typeof getFfzRoom === "function") {
      void getFfzRoom({ kind: "name", name: channel })
        .then(unwrapIpcReply)
        .then((room) => {
          if (!active) return;
          const roleBadge = (
            role: "moderator" | "vip",
            urls?: { "1": string; "2"?: string; "4"?: string } | null
          ) =>
            urls
              ? {
                  id: `ffz:room-${role}`,
                  provider: "ffz" as const,
                  providerId: `room-${role}`,
                  title: `FrankerFaceZ ${role === "vip" ? "VIP" : "Moderator"}`,
                  imageUrl: normalizeCosmeticUrl(urls["4"] ?? urls["2"] ?? urls["1"]),
                }
              : undefined;
          store.setFfzRoleBadges(channelId, {
            moderator: roleBadge("moderator", room?.room.mod_urls),
            vip: roleBadge("vip", room?.room.vip_badge),
          });
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [channel, channelId, enableFfzBadges]);

  // Initial Connection & Channel Joining
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadGlobalEmotes, setActiveChannel, and applyProviderPrefs are intentionally excluded — they would re-trigger the connect effect; applyProviderPrefs is called with an imperative getState() read inside the body to avoid making it reactive.
  useEffect(() => {
    // Use AbortController pattern for cleanup with React Strict Mode
    let isMounted = true;
    let sessionGate: ChatMessageGate<ChatMessage> | null = null;

    const connect = async () => {
      try {
        // Track channel changes for service cleanup. Chat history is now scoped
        // by channel bucket, so switching channels no longer destructively
        // clears the shared store.
        if (currentChannelRef.current !== channel) {
          currentChannelRef.current = channel;
        }

        // Acquire a reference to the service (for multiview support)
        twitchChatService.acquire(channel);

        if (channel) {
          addMessage(createConnectionStatusMessage(channel, "connecting"));
        }

        const joinAndPrepare = async (target: string, broadcasterId?: string): Promise<void> => {
          const gate = createChatMessageGate<ChatMessage>((message) =>
            addMessageBatched(message, buildChannelKey("twitch", target))
          );
          sessionGate = gate;
          liveMessageGateRef.current = gate;
          const session = await startChatSession({
            joinLive: async () => {
              await twitchChatService.joinChannel(target, broadcasterId);
              if (isMounted) addMessage(createConnectionStatusMessage(target, "connected"));
            },
            loadHistory: () =>
              seedTwitchChatHistory({
                channel: target,
                broadcasterId,
                isMounted: () => isMounted,
                prependMessages,
              }),
            loadDecorations: async () => {
              await initializeTwitchEmotes();
              if (!isMounted) return;
              if (accessToken) await loadGlobalEmotes("twitch", { force: true });
              else await loadGlobalEmotes("twitch");
            },
          });
          const openGate = () => {
            if (isMounted && liveMessageGateRef.current === gate) gate.open();
          };
          void session.preparation.then(openGate, openGate);
        };

        // Get a guaranteed-fresh access token (refreshes if expired or within
        // 5 minutes of expiry). Bypasses the stale-token-from-storage gap
        // where idle sessions try to connect IRC with an expired token and
        // get "Login unsuccessful".
        const accessToken = await window.electronAPI.auth.getValidTwitchToken();
        const twitchUser = await window.electronAPI.auth.getTwitchUser();

        // Check if component is still mounted after async calls
        if (!isMounted) return;

        if (accessToken && twitchUser) {
          // Authenticated
          await twitchChatService.connect({
            accessToken,
            user: twitchUser,
            // Re-fetch a fresh token before every reconnect so Twitch IRC's
            // OAuth-expiry-triggered disconnects don't trap us in a loop of
            // "Login unsuccessful" with the original stale token.
            tokenFetcher: () => window.electronAPI.auth.getValidTwitchToken(),
          });

          // Check if connection was successful (might be aborted by Strict Mode cleanup)
          if (!isMounted) return;
          const status = twitchChatService.getConnectionStatus();
          if (status.state !== "connected") {
            // Connection was aborted, don't continue
            return;
          }

          applyProviderPrefs(
            useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES
          );

          // Join channel
          // If channel provided, join it. Else join own channel.
          const target = channel || twitchUser.login;
          const targetBroadcasterId = channel ? channelId : twitchUser.id;
          await joinAndPrepare(target, targetBroadcasterId);
        } else {
          // Anonymous
          if (channel) {
            await twitchChatService.connect({
              anonymous: true,
              debug: import.meta.env.DEV,
            });

            // Check if connection was successful (might be aborted by Strict Mode cleanup)
            if (!isMounted) return;
            const anonStatus = twitchChatService.getConnectionStatus();
            if (anonStatus.state !== "connected") {
              // Connection was aborted, don't continue
              return;
            }

            applyProviderPrefs(
              useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES
            );
            await joinAndPrepare(channel, channelId);
          }
        }
      } catch (error) {
        if (isMounted) {
          logger.error("UI:Chat:Twitch", "failed to connect Twitch chat", {
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
      if (currentChannelRef.current) {
        twitchChatService.release(currentChannelRef.current);

        // Memory cleanup: unload channel emotes to free RAM
        if (currentChannelIdRef.current) {
          unloadChannelEmotes(currentChannelIdRef.current);
        }
        setActiveChannel(null);
      }
      // Drop any queued message batches + their timers. Today batching is off
      // by default so this is a no-op, but it plugs the leak if it's enabled later.
      useChatStore.getState().cleanupBatching();
      currentChannelRef.current = null;
    };
  }, [
    channel,
    channelId,
    clearMessages,
    addMessage,
    addMessageBatched,
    applyProviderPrefs,
    prependMessages,
    unloadChannelEmotes,
    loadGlobalEmotes,
    setActiveChannel,
  ]);

  const refreshBadgeCatalog = useCallback(async (): Promise<boolean> => {
    if (!channel || !channelId) return false;
    try {
      const loaded = await twitchChatService.loadChannelBadges(channel, channelId, {
        forceRefresh: true,
      });
      if (loaded) {
        useChatStore
          .getState()
          .rehydrateChannelBadges(channelKey, (badges) =>
            twitchChatService.resolveChannelBadges(channel, badges)
          );
      }
      return loaded;
    } catch {
      return false;
    }
  }, [channel, channelId, channelKey]);

  // Channel IDs can arrive after chat has already mounted. Loading badges here
  // avoids a reconnect while still fixing retained and future badge resolution.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the explicit user Retry signal.
  useEffect(() => {
    if (!channel || !channelId) {
      setBadgeCatalogStatus("loading");
      return;
    }
    if (!isTwitchConnected) {
      setBadgeCatalogStatus("loading");
      void refreshBadgeCatalog();
      return;
    }
    let active = true;
    setBadgeCatalogStatus("loading");
    void refreshBadgeCatalog().then((loaded) => {
      if (active) setBadgeCatalogStatus(loaded ? "ready" : "failed");
    });
    return () => {
      active = false;
    };
  }, [badgeCatalogRevision, channel, channelId, isTwitchConnected, refreshBadgeCatalog]);

  const refreshBadgeCatalogOnInterval = useCallback(() => {
    void refreshBadgeCatalog();
  }, [refreshBadgeCatalog]);

  useInterval(
    refreshBadgeCatalogOnInterval,
    channel && channelId ? TWITCH_BADGE_REFRESH_INTERVAL_MS : null
  );

  // Separate effect for loading channel emotes without triggering reconnection
  // This is intentionally separate from the connection effect to prevent channelId changes
  // (e.g., during React Query refetches) from causing the chat to disconnect and reconnect
  useEffect(() => {
    if (!channel || !channelId) {
      setActiveChannel(null);
      return;
    }

    let cancelled = false;
    currentChannelIdRef.current = channelId; // Track for cleanup
    // Re-sync provider enablement to prefs before the channel load so a
    // toggle flipped on the Settings/gear surface takes effect on this load
    // (R10). applyProviderPrefs is a no-op when the set already matches.
    applyProviderPrefs(
      useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES
    );
    setActiveChannel(channelId);

    void (async () => {
      await initializeTwitchEmotes();
      if (cancelled) return;
      if (!cancelled) {
        loadChannelEmotes(channelId, channel, "twitch");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channel, channelId, setActiveChannel, loadChannelEmotes, applyProviderPrefs]);

  // Mid-session auth-identity swap. The primary connect effect above runs
  // once on mount with the auth state at that moment and doesn't react to
  // sign-in / sign-out via the ProfileDropdown. Without this effect, a
  // fresh sign-in keeps using the anonymous IRC socket and sendMessage
  // throws "Cannot send messages in anonymous mode"; the reverse leaves an
  // authenticated socket alive after logout. We track the last seen value
  // in a ref so the very first render — which is always handled by the
  // primary effect — is a no-op here.
  const lastAuthRef = useRef(isAuthenticated);
  useEffect(() => {
    if (lastAuthRef.current === isAuthenticated) return;
    lastAuthRef.current = isAuthenticated;
    if (!channel) return;

    let cancelled = false;
    void (async () => {
      try {
        // Hard reset: sets `this.client = null` inside the service so the
        // subsequent connect() creates a fresh client with the new identity
        // rather than returning early on its "already connected" check.
        // activeUsers is untouched, so the refcount stays intact across
        // the swap.
        await twitchChatService.disconnect();
        if (cancelled) return;

        if (isAuthenticated) {
          const accessToken = await window.electronAPI.auth.getValidTwitchToken();
          const twitchUser = await window.electronAPI.auth.getTwitchUser();
          if (cancelled || !accessToken || !twitchUser) return;
          await twitchChatService.connect({
            accessToken,
            user: twitchUser,
            tokenFetcher: () => window.electronAPI.auth.getValidTwitchToken(),
          });
          if (cancelled) return;
          await twitchChatService.joinChannel(channel, twitchUser.id);
        } else {
          await twitchChatService.connect({
            anonymous: true,
            debug: import.meta.env.DEV,
          });
          if (cancelled) return;
          await twitchChatService.joinChannel(channel);
        }
      } catch (err) {
        if (!cancelled) {
          logger.error("UI:Chat:Twitch", "failed to swap Twitch chat identity", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, channel]);

  // Pin polling — independent of IRC/auth so the banner can populate within
  // a network round-trip of mount (~50ms) instead of waiting on joinChannel.
  // The cleanup clears stale pin state so switching from a channel-with-pin
  // to a channel-without-pin doesn't leave the previous banner stuck on screen.
  useEffect(() => {
    if (!channel) return;
    setPinnedMessage(null);
    setShowPinned(true);
    setIsPinExpanded(false);
    setActivePoll(null);
    setShowPoll(true);
    setIsPollExpanded(false);
    setUnbanUserIds(new Set());
    pollTimer.clear();
    startTwitchPinPolling(channel);
    return () => {
      stopTwitchPinPolling(channel);
    };
  }, [channel, pollTimer]);

  // Event Listeners
  useEffect(() => {
    const handleMessage = (message: ChatMessage) => {
      if (message.platform === "twitch") {
        if (message.channel.toLowerCase() !== channel.toLowerCase()) return;

        // Substitute emote NAMES inside text fragments with emote fragments.
        // `includeNative: true` because tmi.js's synthetic self-echo arrives
        // without IRC emote tags (we run with `skipUpdatingEmotesets: true`)
        // — even native Twitch emotes like `Kappa` need to be resolved by
        // name in that case. For inbound messages from other users IRC has
        // already stamped the native emotes into proper fragments, so the
        // emote text isn't present in any text fragment for the helper to
        // double-render. Third-party 7TV / BTTV / FFZ always ride along as
        // plain text either way and are resolved here too.
        const map = useEmoteStore.getState().getEmoteNameMap();
        const enrichedContent = substituteThirdPartyEmotes(message.content, map, {
          includeNative: true,
        });
        const enriched =
          enrichedContent === message.content ? message : { ...message, content: enrichedContent };
        const gate = liveMessageGateRef.current;
        if (gate) gate.accept(enriched);
        else addMessageBatched(enriched, channelKey);
      }
    };

    const handleUserNotice = (notice: UserNotice) => {
      if (notice.platform !== "twitch") return;
      // U5 — viewer can hide sub / resub / raid / user-notice lines. Read
      // prefs imperatively so this handler isn't re-registered (and the IRC
      // socket isn't reconnected) on every preference change.
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
      if (status.platform === "twitch") {
        updateConnectionStatus(status);
      }
    };

    const handleClearChat = (clear: ClearChat) => {
      if (clear.platform !== "twitch") return;
      if (clear.channel !== channel) return;
      // U5 — `showClearChat` gates the chat-cleared NOTICE line, not the
      // moderation effect itself: the messages are still removed (a mod
      // cleared chat), only the "Chat was cleared" / ban marker is hidden.
      const cd =
        useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
      const clearChannelKey = buildChannelKey("twitch", clear.channel);

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
      markMessageDeletedByModerator(deletion.messageId, undefined, deletion.timestamp);
    };

    const handleError = (error: Error) => {
      logger.error("UI:Chat:Twitch", "twitch chat error", {
        error: error instanceof Error ? error.message : String(error),
      });
    };

    const handlePinnedMessage = (pin: NormalizedPinnedMessage) => {
      if (pin.platform !== "twitch") return;
      const map = useEmoteStore.getState().getEmoteNameMap();
      const enrichedContent = substituteThirdPartyEmotes(pin.content, map, {
        includeNative: true,
      });
      const enriched = enrichedContent === pin.content ? pin : { ...pin, content: enrichedContent };
      setPinnedMessage(enriched);
      setShowPinned(true);
      setIsPinExpanded(false);
    };

    const handlePinnedMessageCleared = () => {
      setPinnedMessage(null);
    };

    const handlePollUpdate = (poll: KickPoll) => {
      setActivePoll(poll);
      setShowPoll(true);
      if (poll.remaining <= 0) {
        pollTimer.start(15000);
      }
    };

    const handlePredictionUpdate = (prediction: UnifiedPrediction) => {
      // Multiview gate: twitchChatService is a singleton, so a prediction
      // emitted for channel A also fires this handler in the chat panel for
      // channel B. Drop everything that doesn't match the channel rendered
      // here. An empty `prediction.channelId` ("") is the dev-injection
      // path (ChatSimTool has no current-channel context) — accept those
      // so the dev tool stays useful. (Code review P0-1.)
      if (channelId && prediction.channelId && prediction.channelId !== channelId) {
        return;
      }
      if (predictionDismissGate.shouldSuppress(prediction.id)) return;
      setActivePrediction(prediction);
    };

    const handleModeratorState = (event: ModeratorStateEvent) => {
      if (event.platform !== "twitch") return;
      if (channelId && event.channelId !== channelId) return;
      setTwitchChannelModState(event.channelId, event.isModerator);
    };

    twitchChatService.on("message", handleMessage);
    twitchChatService.on("userNotice", handleUserNotice);
    twitchChatService.on("connectionStateChange", handleConnectionStatus);
    twitchChatService.on("clearChat", handleClearChat);
    twitchChatService.on("messageDeleted", handleMessageDeleted);
    twitchChatService.on("error", handleError);
    twitchChatService.on("pinnedMessage", handlePinnedMessage);
    twitchChatService.on("pinnedMessageCleared", handlePinnedMessageCleared);
    twitchChatService.on("pollUpdate", handlePollUpdate);
    twitchChatService.on("predictionUpdate", handlePredictionUpdate);
    twitchChatService.on("moderatorState", handleModeratorState);

    return () => {
      twitchChatService.off("message", handleMessage);
      twitchChatService.off("userNotice", handleUserNotice);
      twitchChatService.off("connectionStateChange", handleConnectionStatus);
      twitchChatService.off("clearChat", handleClearChat);
      twitchChatService.off("messageDeleted", handleMessageDeleted);
      twitchChatService.off("error", handleError);
      twitchChatService.off("pinnedMessage", handlePinnedMessage);
      twitchChatService.off("pinnedMessageCleared", handlePinnedMessageCleared);
      twitchChatService.off("pollUpdate", handlePollUpdate);
      twitchChatService.off("predictionUpdate", handlePredictionUpdate);
      twitchChatService.off("moderatorState", handleModeratorState);
    };
  }, [
    addMessage,
    addMessageBatched,
    updateConnectionStatus,
    clearMessages,
    deleteMessagesByUser,
    channelKey,
    channel,
    channelId,
    markMessageDeletedByModerator,
    markUserUnbannable,
    predictionDismissGate,
    pollTimer,
    setTwitchChannelModState,
  ]);

  // U2 — Hermes WebSocket subscription per channelId. Forwards predictions
  // through twitchChatService.emit so dev injection (U9) and production both
  // route through the predictionUpdate listener above.
  useEffect(() => {
    if (!channelId) return;
    const client = new TwitchHermesClient(channelId);
    const forward = (prediction: UnifiedPrediction) => {
      twitchChatService.emit("predictionUpdate", prediction);
    };
    client.on("prediction", forward);
    client.start();
    return () => {
      client.off("prediction", forward);
      client.stop();
      setActivePrediction(null);
    };
  }, [channelId]);

  // U19 — visible tabs based on role. Viewer = chat only (the component
  // suppresses the strip), mod = chat + modlog, broadcaster adds engagement.
  // The broadcaster check is approximate per the plan: Twitch's broadcaster
  // id IS the user id, so user.id === channelId is sufficient. The dev
  // override (forceBroadcasterIdentity) flips the gate on for visual testing.
  const forceBroadcasterIdentity = useDevModOverrideStore((s) => s.forceBroadcasterIdentity);
  const isCurrentUserBroadcaster =
    forceBroadcasterIdentity || (!!twitchUser && twitchUser.id === channelId);
  const visibleTabs: ChatPanelTabId[] = ["chat"];
  if (isMod) {
    visibleTabs.push("modlog");
  }
  if (isCurrentUserBroadcaster) {
    visibleTabs.push("engagement");
  }

  // Stable callbacks for PredictionBanner. Inline arrows here would change
  // identity every render and bounce the banner's 60s auto-dismiss timer
  // forever, since the banner's effect depends on `onAutoDismiss`.
  const handlePredictionAutoDismiss = useCallback(() => {
    setActivePrediction(null);
  }, []);
  const handlePredictionDismiss = useCallback(() => {
    setActivePrediction((current) => {
      if (current) predictionDismissGate.dismiss(current.id);
      return null;
    });
  }, [predictionDismissGate]);
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
  const handlePinMessage = useCallback(
    async (message: ChatMessage, durationSeconds: number | null) => {
      const messageId = message.id;
      const runPin = async () => {
        if (!channelId || !twitchUser?.id) return null;
        return window.electronAPI.twitch.execute({
          operation: "pin-message",
          broadcasterId: channelId,
          moderatorId: twitchUser.id,
          messageId,
          durationSeconds,
        });
      };

      const result = await runPin();
      if (!result) return;
      if (result.ok) {
        setPinDialogMessage(null);
        toast.success("Pinned message");
      } else if (result.error.code === "unauthorized") {
        setPinDialogMessage(null);
        promptReconnect({
          missingScopes: ["moderator:manage:chat_messages"],
          onReconnected: async () => {
            const retry = await runPin();
            if (retry?.ok) toast.success("Pinned message");
            else if (retry)
              toast.error("Couldn't pin message", {
                description: retry.error.message,
              });
          },
        });
      } else {
        toast.error("Couldn't pin message", {
          description: result.error.message,
        });
        setPinDialogMessage(null);
      }
    },
    [channelId, promptReconnect, twitchUser?.id]
  );

  // U19 — Chat-tab body. Keeps the existing pinned banner / mod strip /
  // message list / input footer wiring intact. The mod-action and pin
  // dialogs stay outside the tab so they overlay regardless of tab.
  const chatBody = (
    <div className="flex flex-col h-full w-full">
      {showPredictions && activePrediction && (
        <PredictionBanner
          prediction={activePrediction}
          onAutoDismiss={handlePredictionAutoDismiss}
          onDismiss={handlePredictionDismiss}
        />
      )}
      {showPolls && activePoll && showPoll && (
        <TwitchPollWidget
          poll={activePoll}
          isExpanded={isPollExpanded}
          onToggleExpand={() => setIsPollExpanded((v) => !v)}
          onDismiss={() => setShowPoll(false)}
        />
      )}

      {/* U13 - Inline mod strip. Twitch-broadcaster sees raid +
       *  commercial too. The pinned banner floats over the message list below. */}
      {isMod && hasModScopes && channelId && twitchUser ? (
        <InlineModStrip
          platform="twitch"
          isBroadcaster={twitchUser.id === channelId}
          channelId={channelId}
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
              case "raid":
                setPendingModAction({ kind: "strip", actionType: "raid" });
                return;
              case "unique-chat":
                setPendingModAction({
                  kind: "strip",
                  actionType: "uniqueChat",
                  currentlyActive: action.currentlyActive,
                });
                return;
              case "commercial":
                setPendingModAction({ kind: "strip", actionType: "commercial" });
                return;
              case "shield":
                setPendingModAction({
                  kind: "strip",
                  actionType: action.currentlyActive ? "shieldOff" : "shield",
                  currentlyActive: action.currentlyActive,
                });
                return;
            }
          }}
        />
      ) : null}

      <div className="flex-1 min-h-0 relative">
        {pinnedMessage && showPinned && (
          <PinnedMessageBanner
            pin={pinnedMessage}
            // Mods see the Unpin button in place of the viewer's hide-eye.
            viewerRole={isMod ? "mod" : "viewer"}
            isExpanded={isPinExpanded}
            onExpandToggle={() => setIsPinExpanded((v) => !v)}
            // Viewer-only local hide (only rendered when role === "viewer").
            onDismiss={() => setShowPinned(false)}
            // Mod-only server-side unpin. Gated by the same scope-check as Pin.
            onUnpin={
              isMod && pinnedMessage.messageId && twitchUser?.id && channelId
                ? async () => {
                    setPinMenuBusy(true);
                    const runUnpin = async () => {
                      if (!twitchUser?.id || !channelId) return null;
                      return window.electronAPI.twitch.execute({
                        operation: "unpin-message",
                        broadcasterId: channelId,
                        moderatorId: twitchUser.id,
                        messageId: pinnedMessage.messageId,
                      });
                    };
                    if (!modScopesLoading && !hasModScopes) {
                      promptReconnect({
                        missingScopes: ["moderator:manage:chat_messages"],
                        onReconnected: async () => {
                          const retry = await runUnpin();
                          if (retry?.ok) setPinnedMessage(null);
                        },
                      });
                      return;
                    }
                    try {
                      const result = await runUnpin();
                      if (!result) return;
                      if (result.ok) {
                        // Optimistic local clear, poller will reconcile on
                        // the next tick when Twitch confirms.
                        setPinnedMessage(null);
                      } else if (result.error.code === "unauthorized") {
                        promptReconnect({
                          missingScopes: ["moderator:manage:chat_messages"],
                        });
                      }
                    } catch (error) {
                      if (process.env.NODE_ENV !== "production") {
                        logger.error("UI:Chat:Twitch", "unpin failed", {
                          error: error instanceof Error ? error.message : String(error),
                        });
                      }
                    } finally {
                      setPinMenuBusy(false);
                    }
                  }
                : undefined
            }
            onUpdateDuration={
              isMod && pinnedMessage.messageId && twitchUser?.id && channelId
                ? async (durationSeconds) => {
                    setPinMenuBusy(true);
                    const runUpdatePin = async () => {
                      if (!twitchUser?.id || !channelId) return null;
                      return window.electronAPI.twitch.execute({
                        operation: "update-pin",
                        broadcasterId: channelId,
                        moderatorId: twitchUser.id,
                        messageId: pinnedMessage.messageId,
                        durationSeconds,
                      });
                    };
                    const applyOptimisticDuration = () => {
                      const pinnedAt = new Date().toISOString();
                      const expiresAt =
                        durationSeconds === null
                          ? null
                          : new Date(Date.now() + durationSeconds * 1000).toISOString();
                      setPinnedMessage((current) =>
                        current?.messageId === pinnedMessage.messageId
                          ? { ...current, pinnedAt, expiresAt }
                          : current
                      );
                    };

                    try {
                      if (!modScopesLoading && !hasModScopes) {
                        promptReconnect({
                          missingScopes: ["moderator:manage:chat_messages"],
                          onReconnected: async () => {
                            const retry = await runUpdatePin();
                            if (retry?.ok) {
                              applyOptimisticDuration();
                              toast.success("Pinned message updated");
                            } else if (retry) {
                              toast.error("Couldn't update pinned message", {
                                description: retry.error.message,
                              });
                            }
                          },
                        });
                        return;
                      }

                      const result = await runUpdatePin();
                      if (!result) return;
                      if (result.ok) {
                        applyOptimisticDuration();
                        toast.success("Pinned message updated");
                      } else if (result.error.code === "unauthorized") {
                        promptReconnect({
                          missingScopes: ["moderator:manage:chat_messages"],
                        });
                      } else {
                        toast.error("Couldn't update pinned message", {
                          description: result.error.message,
                        });
                      }
                    } catch (error) {
                      toast.error("Couldn't update pinned message", {
                        description: error instanceof Error ? error.message : String(error),
                      });
                    } finally {
                      setPinMenuBusy(false);
                    }
                  }
                : undefined
            }
            pinActionBusy={pinMenuBusy}
            currentChannelContext={currentChannelContext}
          />
        )}
        <ModerationFixtureLauncher />
        <ChatMessageList
          key={`twitch-${channel}`}
          channelKey={channelKey}
          onReply={isAuthenticated ? handleReply : undefined}
          onPin={
            isMod
              ? (message) => {
                  const pinMessage = () => {
                    if (showTwitchPinDurationDialog) {
                      setPinDialogMessage(message);
                    } else {
                      void handlePinMessage(message, DEFAULT_TWITCH_PIN_DURATION_SECONDS);
                    }
                  };

                  // Lazy scope-check: once the token has been inspected, surface
                  // the reconnect dialog instead of opening the pin dialog.
                  if (!modScopesLoading && !hasModScopes) {
                    promptReconnect({
                      missingScopes: ["moderator:manage:chat_messages"],
                      onReconnected: pinMessage,
                    });
                    return;
                  }
                  pinMessage();
                }
              : undefined
          }
          // U11 — Timeout / Ban / Unban / Delete just open the generic confirm
          // dialog. The scope-gate fires inside onConfirm (not at click-time)
          // so the dialog opens immediately for the moderator regardless of
          // whether a token refresh is pending.
          onTimeout={
            isMod
              ? (message) =>
                  setPendingModAction({ kind: "messageScoped", message, actionType: "timeout" })
              : undefined
          }
          onWarn={
            isMod
              ? (message) => {
                  setWarnReason("");
                  setPendingModAction({ kind: "messageScoped", message, actionType: "warn" });
                }
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
          selfUserId={twitchUser?.id}
          currentChannelContext={currentChannelContext}
        />
      </div>

      <ChatComposerFooter>
        {/* Footer composer owns message send actions and quick chat settings. */}
        <ChatInput
          ref={chatInputRef}
          platform="twitch"
          channel={channel}
          channelId={channelId ?? null}
          canSend={isAuthenticated && isTwitchConnected}
          isAuthenticated={isAuthenticated}
          viewerUserId={isAuthenticated ? twitchUser?.id : undefined}
          onAuthRequired={() => loginTwitch()}
          viewerCanBypassRoomModes={isMod}
          checkSubscriberEligibility={(request) =>
            window.electronAPI.chat.checkSubscriberEligibility(request)
          }
          showModViewLink={isAuthenticated && isMod}
          onSendEligibilityChange={handleSendEligibilityChange}
        />
      </ChatComposerFooter>
    </div>
  );

  return (
    <UserPopoutProvider
      publicActions={userPopoutPublicActions}
      badgeCatalog={{
        state: badgeCatalogStatus,
        sourceLabel: "Twitch · Live chat",
        retry: retryBadgeCatalog,
      }}
    >
      <div className="flex flex-col h-full w-full bg-gradient-to-b from-[#141414] to-[#171717]">
        <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="text-white">Chat</span>
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
                <ModLogTab platform="twitch" channelId={channelId} channelSlug={channel} />
              ) : (
                <div className="p-4 text-neutral-400">No channel selected.</div>
              ),
              engagement: channelId ? (
                <EngagementTab channelId={channelId} />
              ) : (
                <div className="p-4 text-neutral-400">No channel selected.</div>
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

        {/* U11/U13/U15 — Generic mod-action confirm dialog. Branches on the
         *  pendingModAction `kind` so message-scoped actions (Timeout/Ban/...) and
         *  strip-scoped actions (clear/raid/shield/chat-modes) all flow through
         *  the same surface. The pin dialog stays separate (plan decision #12). */}
        {pendingModAction && channelId && twitchUser
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
                      platform: "twitch",
                      channelId,
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
                          from @{action.message.username}
                        </div>
                      </div>
                    }
                    onPendingChange={setModActionBusy}
                    onSuccess={async () => {
                      markUserUnbannable(action.message.userId);
                      await queryClient.invalidateQueries({
                        queryKey: MOD_LOG_QUERY_KEYS.channel("twitch", channelId),
                      });
                    }}
                  />
                );
              }
              // Choose actionType for the dialog copy lookup. Chat-mode toggles
              // reuse a single actionType per kind regardless of on/off — only
              // shield has an explicit shieldOff variant for CTA clarity.
              let actionType: ModActionType;
              let targetPreview: React.ReactNode;
              if (action.kind === "messageScoped") {
                actionType = action.actionType;
                targetPreview = (
                  <div>
                    <div className="line-clamp-2">{action.message.rawContent || ""}</div>
                    <div className="text-xs text-[var(--color-foreground-muted)] mt-1">
                      from @{action.message.username}
                    </div>
                  </div>
                );
              } else if (action.kind === "stripChatMode") {
                // The four chat-mode toggles reuse the dialog with a clarifying
                // preview rather than separate `*Off` action types. Per-mode copy
                // routes through a small lookup table.
                const COPY: Record<
                  typeof action.modeKind,
                  { type: ModActionType; on: string; off: string }
                > = {
                  "slow-mode": {
                    type: "timeout",
                    on: "Turn ON slow mode",
                    off: "Turn OFF slow mode",
                  },
                  "followers-only": {
                    type: "uniqueChat", // reuse a Twitch-purple variant for the lookup; preview text carries the real wording
                    on: "Turn ON followers-only mode",
                    off: "Turn OFF followers-only mode",
                  },
                  "subscribers-only": {
                    type: "uniqueChat",
                    on: "Turn ON subscribers-only mode",
                    off: "Turn OFF subscribers-only mode",
                  },
                  "emote-only": {
                    type: "uniqueChat",
                    on: "Turn ON emote-only mode",
                    off: "Turn OFF emote-only mode",
                  },
                };
                const entry = COPY[action.modeKind];
                actionType = entry.type;
                targetPreview = (
                  <div className="text-sm font-medium">
                    {action.currentlyActive ? entry.off : entry.on}
                  </div>
                );
              } else if (action.actionType === "raid") {
                actionType = "raid";
                targetPreview = (
                  <div className="text-sm text-[var(--color-foreground-muted)]">
                    Pick a channel to send your viewers to.
                  </div>
                );
              } else {
                actionType = action.actionType;
                targetPreview = (
                  <div className="text-sm">
                    {action.actionType === "clear"
                      ? "Clear chat for everyone in this channel"
                      : action.actionType === "commercial"
                        ? "Run a commercial on this channel"
                        : action.actionType === "shield"
                          ? "Enable Shield Mode on this channel"
                          : action.actionType === "shieldOff"
                            ? "Disable Shield Mode on this channel"
                            : action.actionType === "uniqueChat"
                              ? action.currentlyActive
                                ? "Turn OFF unique-chat mode"
                                : "Turn ON unique-chat mode"
                              : ""}
                  </div>
                );
              }

              const needsWarnSlot = action.kind === "messageScoped" && action.actionType === "warn";
              const needsSlowModeSlot =
                action.kind === "stripChatMode" &&
                action.modeKind === "slow-mode" &&
                !action.currentlyActive;
              const needsFollowersSlot =
                action.kind === "stripChatMode" &&
                action.modeKind === "followers-only" &&
                !action.currentlyActive;
              const needsRaidSlot = action.kind === "strip" && action.actionType === "raid";

              return (
                <ModActionConfirmDialog
                  open={!!pendingModAction}
                  onOpenChange={(open) => {
                    if (!open) {
                      setPendingModAction(null);
                      setWarnReason("");
                    }
                  }}
                  actionType={actionType}
                  targetPreview={targetPreview}
                  busy={modActionBusy}
                  confirmDisabled={
                    needsWarnSlot &&
                    (warnReason.trim().length === 0 ||
                      warnReason.trim().length > MAX_TWITCH_WARN_REASON_LENGTH)
                  }
                  extraSlot={
                    needsWarnSlot
                      ? ({ onDataChange, disabled }) => (
                          <div className="space-y-2">
                            <label
                              htmlFor="twitch-warn-reason"
                              className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]"
                            >
                              Warning reason
                            </label>
                            <textarea
                              id="twitch-warn-reason"
                              value={warnReason}
                              maxLength={MAX_TWITCH_WARN_REASON_LENGTH}
                              disabled={disabled}
                              onChange={(event) => {
                                const next = event.currentTarget.value;
                                setWarnReason(next);
                                onDataChange({ reason: next });
                              }}
                              className="min-h-24 w-full resize-none rounded-md border border-[var(--color-border)] bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-[var(--color-foreground-muted)] focus:border-[#9146FF] focus:ring-1 focus:ring-[#9146FF]"
                              placeholder="Reason shown to the user"
                            />
                            <div className="text-right text-xs text-[var(--color-foreground-muted)]">
                              {warnReason.trim().length}/{MAX_TWITCH_WARN_REASON_LENGTH}
                            </div>
                          </div>
                        )
                      : needsSlowModeSlot
                        ? ({ onDataChange, disabled }) => (
                            <TimeoutDurationPicker
                              disabled={disabled}
                              onChange={(s) => onDataChange({ durationSeconds: s })}
                            />
                          )
                        : needsFollowersSlot
                          ? ({ onDataChange, disabled }) => (
                              <TimeoutDurationPicker
                                disabled={disabled}
                                onChange={(s) => onDataChange({ durationSeconds: s })}
                              />
                            )
                          : needsRaidSlot
                            ? ({ onDataChange, disabled }) => (
                                <RaidTargetPicker
                                  selfBroadcasterId={twitchUser.id}
                                  disabled={disabled}
                                  onChange={(target) => onDataChange(target)}
                                />
                              )
                            : undefined
                  }
                  onConfirm={async (extraData) => {
                    if (!pendingModAction) return;
                    const runMessageAction = async () => {
                      if (action.kind !== "messageScoped") {
                        throw new Error("unreachable");
                      }
                      const ctx = {
                        broadcasterId: channelId,
                        moderatorId: twitchUser.id,
                      };
                      switch (action.actionType) {
                        case "ban":
                          return window.electronAPI.twitch.execute({
                            operation: "ban-user",
                            ...ctx,
                            userId: action.message.userId,
                          });
                        case "timeout":
                          throw new Error("Timeout must use the state-aware moderation IPC");
                        case "warn": {
                          const reason =
                            (extraData as { reason?: string } | undefined)?.reason ?? warnReason;
                          return window.electronAPI.twitch.execute({
                            operation: "warn-user",
                            ...ctx,
                            userId: action.message.userId,
                            reason,
                          });
                        }
                        case "unban":
                          return window.electronAPI.twitch.execute({
                            operation: "unban-user",
                            ...ctx,
                            userId: action.message.userId,
                          });
                        case "delete":
                          return window.electronAPI.twitch.execute({
                            operation: "delete-chat-message",
                            ...ctx,
                            messageId: action.message.id,
                          });
                      }
                    };

                    const runStripAction = async () => {
                      const ctx = {
                        broadcasterId: channelId,
                        moderatorId: twitchUser.id,
                      };
                      if (action.kind === "strip") {
                        switch (action.actionType) {
                          case "clear":
                            return window.electronAPI.twitch.execute({
                              operation: "clear-chat",
                              ...ctx,
                            });
                          case "raid": {
                            const target = extraData as RaidTarget | null | undefined;
                            if (!target) {
                              return {
                                ok: false as const,
                                error: {
                                  code: "invalid-input" as const,
                                  message: "Pick a target channel first",
                                },
                              };
                            }
                            return window.electronAPI.twitch.execute({
                              operation: "start-raid",
                              fromBroadcasterId: channelId,
                              toBroadcasterId: target.broadcasterId,
                            });
                          }
                          case "commercial":
                            return window.electronAPI.twitch.execute({
                              operation: "run-commercial",
                              broadcasterId: channelId,
                              length: 60,
                            });
                          case "shield":
                            return window.electronAPI.twitch.execute({
                              operation: "set-shield-mode",
                              ...ctx,
                              active: true,
                            });
                          case "shieldOff":
                            return window.electronAPI.twitch.execute({
                              operation: "set-shield-mode",
                              ...ctx,
                              active: false,
                            });
                          case "uniqueChat":
                            return window.electronAPI.twitch.execute({
                              operation: "update-chat-settings",
                              ...ctx,
                              settings: {
                                unique_chat_mode: !action.currentlyActive,
                              },
                            });
                        }
                      }
                      if (action.kind === "stripChatMode") {
                        const turnOn = !action.currentlyActive;
                        switch (action.modeKind) {
                          case "slow-mode": {
                            const seconds = turnOn
                              ? ((extraData as { durationSeconds?: number } | undefined)
                                  ?.durationSeconds ?? 30)
                              : undefined;
                            return window.electronAPI.twitch.execute({
                              operation: "update-chat-settings",
                              ...ctx,
                              settings: {
                                slow_mode: turnOn,
                                slow_mode_wait_time: turnOn ? (seconds ?? 30) : null,
                              },
                            });
                          }
                          case "followers-only": {
                            const seconds = turnOn
                              ? ((extraData as { durationSeconds?: number } | undefined)
                                  ?.durationSeconds ?? 600)
                              : undefined;
                            // Twitch wants follower_mode_duration in MINUTES.
                            const minutes = turnOn
                              ? Math.max(0, Math.floor((seconds ?? 600) / 60))
                              : undefined;
                            return window.electronAPI.twitch.execute({
                              operation: "update-chat-settings",
                              ...ctx,
                              settings: {
                                follower_mode: turnOn,
                                follower_mode_duration: turnOn ? (minutes ?? 10) : null,
                              },
                            });
                          }
                          case "subscribers-only":
                            return window.electronAPI.twitch.execute({
                              operation: "update-chat-settings",
                              ...ctx,
                              settings: { subscriber_mode: turnOn },
                            });
                          case "emote-only":
                            return window.electronAPI.twitch.execute({
                              operation: "update-chat-settings",
                              ...ctx,
                              settings: { emote_mode: turnOn },
                            });
                        }
                      }
                      throw new Error("unreachable");
                    };

                    const runAction =
                      action.kind === "messageScoped" ? runMessageAction : runStripAction;

                    setModActionBusy(true);
                    try {
                      const result = await runAction();
                      if (result.ok) {
                        // Optimistic room-state writeback so the strip flips its
                        // toggles immediately. The Helix call has already
                        // succeeded — TODO(U14.1) will replace this with the
                        // ROOMSTATE event from twitch-chat.
                        if (action.kind === "stripChatMode") {
                          const turnOn = !action.currentlyActive;
                          const seconds = turnOn
                            ? ((extraData as { durationSeconds?: number } | undefined)
                                ?.durationSeconds ?? 30)
                            : null;
                          if (action.modeKind === "slow-mode") {
                            updateRoomState("twitch", channelId, {
                              slowMode: turnOn ? (seconds ?? 30) : null,
                            });
                          } else if (action.modeKind === "followers-only") {
                            const minutes = turnOn
                              ? Math.max(0, Math.floor((seconds ?? 600) / 60))
                              : null;
                            updateRoomState("twitch", channelId, {
                              followersOnly: turnOn ? (minutes ?? 10) : null,
                            });
                          } else if (action.modeKind === "subscribers-only") {
                            updateRoomState("twitch", channelId, {
                              subscribersOnly: turnOn,
                            });
                          } else if (action.modeKind === "emote-only") {
                            updateRoomState("twitch", channelId, { emoteOnly: turnOn });
                          }
                        } else if (action.kind === "strip") {
                          if (action.actionType === "shield") {
                            updateRoomState("twitch", channelId, { shieldMode: true });
                          } else if (action.actionType === "shieldOff") {
                            updateRoomState("twitch", channelId, { shieldMode: false });
                          } else if (action.actionType === "uniqueChat") {
                            updateRoomState("twitch", channelId, {
                              uniqueChat: !action.currentlyActive,
                            });
                          } else if (action.actionType === "raid") {
                            const target = extraData as RaidTarget | null | undefined;
                            if (target) {
                              void appendRecentRaid(twitchUser.id, target);
                            }
                          }
                        }

                        setPendingModAction(null);
                        if (action.kind === "messageScoped") {
                          const username = action.message.username;
                          if (action.actionType === "ban") {
                            markUserUnbannable(action.message.userId);
                            showModActionSuccessToast(`Banned ${username}`);
                          } else if (action.actionType === "warn") {
                            setWarnReason("");
                            toast.success(`Warned ${username}`);
                          } else if (action.actionType === "unban") {
                            markUserUnbanned(action.message.userId);
                            toast.success(`Unbanned ${username}`);
                          } else if (action.actionType === "delete") {
                            markMessageDeletedByModerator(
                              action.message.id,
                              currentModeratorPresentation()
                            );
                            showModActionSuccessToast("Deleted message");
                          }
                        } else if (action.kind === "strip") {
                          toast.success("Done");
                        } else {
                          toast.success("Chat mode updated");
                        }
                        return;
                      }

                      if (result.error.code === "unauthorized") {
                        setPendingModAction(null);
                        setWarnReason("");
                        promptReconnect({
                          missingScopes:
                            action.kind === "messageScoped" && action.actionType === "warn"
                              ? [TWITCH_WARN_SCOPE]
                              : action.kind === "messageScoped" &&
                                  (action.actionType === "ban" || action.actionType === "unban")
                                ? ["moderator:manage:banned_users"]
                                : ["moderator:manage:chat_messages"],
                          onReconnected: async () => {
                            const retry = await runAction();
                            if (retry.ok) {
                              if (
                                action.kind === "messageScoped" &&
                                (action.actionType === "ban" ||
                                  action.actionType === "timeout" ||
                                  action.actionType === "delete")
                              ) {
                                showModActionSuccessToast("Action completed");
                              } else {
                                toast.success("Action completed");
                              }
                            } else
                              toast.error("Action still failed after reconnect", {
                                description: retry.error.message,
                              });
                          },
                        });
                        return;
                      }
                      setPendingModAction(null);
                      toast.error("Couldn't complete action", {
                        description: result.error.message,
                      });
                    } finally {
                      setModActionBusy(false);
                    }
                  }}
                />
              );
            })()
          : null}

        {/* Pin duration picker — opens when a mod clicks the hover Pin button
         *  on a chat message. On confirm, fires the GQL pinChatMessage mutation
         *  and lets the poller reconcile the banner on its next tick. */}
        {pinDialogMessage && channelId ? (
          <TwitchPinMessageDialog
            open={!!pinDialogMessage}
            onOpenChange={(open) => {
              if (!open) setPinDialogMessage(null);
            }}
            message={pinDialogMessage}
            busy={pinDialogBusy}
            onConfirm={async (durationSeconds) => {
              if (!pinDialogMessage) return;
              setPinDialogBusy(true);
              try {
                await handlePinMessage(pinDialogMessage, durationSeconds);
              } finally {
                setPinDialogBusy(false);
              }
            }}
          />
        ) : null}
      </div>
    </UserPopoutProvider>
  );
};

// ========== Sub-components ==========

interface TwitchPollWidgetProps {
  poll: KickPoll;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDismiss: () => void;
}

const TwitchPollWidget: React.FC<TwitchPollWidgetProps> = ({
  poll,
  isExpanded,
  onToggleExpand,
  onDismiss,
}) => {
  const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
  const maxVotes = Math.max(...poll.options.map((o) => o.votes), 0);
  const isPollEnded = poll.remaining <= 0;

  // KickPoll carries `remaining` (seconds left) + `duration` (total). Anchor a
  // local locks-at timestamp when the prop arrives, then tick `now` so the
  // bar drains visibly between server updates. Mirrors PredictionBanner.
  const anchor = useMemo(
    () => ({
      locksAtMs: Date.now() + poll.remaining * 1000,
      windowMs: poll.duration * 1000,
    }),
    [poll]
  );
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), !isPollEnded && anchor.windowMs > 0 ? 500 : null);
  const remainingMs = Math.max(0, anchor.locksAtMs - now);
  const barPct = anchor.windowMs > 0 ? Math.min(100, (remainingMs / anchor.windowMs) * 100) : 0;

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-background-tertiary,#1a1a1a)] text-sm">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-neutral-400 text-xs font-medium">Poll:</span>
          <span className="text-white text-xs font-semibold truncate">{poll.title}</span>
          {isPollEnded && <span className="text-xs text-neutral-500 flex-shrink-0">Ended</span>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleExpand}
                aria-label={isExpanded ? "Collapse" : "Expand"}
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
            <TooltipContent>{isExpanded ? "Collapse" : "Expand"}</TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss"
                className="p-1 text-neutral-400 hover:text-white rounded transition-colors"
              >
                <BsX size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Dismiss</TooltipContent>
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
                  <span className={isWinner ? "text-[#9146FF] font-semibold" : "text-white"}>
                    {option.label}
                    {isWinner && " 🏆"}
                  </span>
                  <span className="text-neutral-400">
                    {option.votes} ({pct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${isWinner ? "bg-[#9146FF]" : "bg-[var(--color-primary,#9146FF)]"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
          {!isPollEnded && anchor.windowMs > 0 && (
            <div className="h-0.5 rounded-full bg-white/10 overflow-hidden mt-2">
              <div
                className="h-full bg-blue-500 rounded-full transition-[width] duration-500 ease-linear"
                style={{ width: `${barPct}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

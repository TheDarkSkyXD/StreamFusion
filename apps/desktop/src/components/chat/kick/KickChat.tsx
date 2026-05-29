import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { BsChevronDown, BsGear, BsX } from "react-icons/bs";
import { toast } from "sonner";
import {
  banKickUser,
  deleteKickMessage,
  setKickChatMode,
  timeoutKickUser,
  unbanKickUser,
  type KickModResult,
} from "../../../backend/api/platforms/kick/kick-mod-mutations";
import {
  pinKickMessage,
  unpinKickMessage,
} from "../../../backend/api/platforms/kick/kick-pin-mutations";
import { kickChatService } from "../../../backend/services/chat/kick-chat";
import { kickPredictionsService } from "../../../backend/services/chat/kick-predictions-service";
import { initializeKickEmotes } from "../../../backend/services/emotes";
import { useIsKickMod } from "../../../hooks/useIsKickMod";
import type {
  ChatConnectionStatus,
  ChatMessage,
  ClearChat,
  KickPoll,
  MessageDeletion,
  NormalizedPinnedMessage,
  UserNotice,
} from "../../../shared/chat-types";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../../../shared/auth-types";
import { useAuthStore } from "../../../store/auth-store";
import { useChatStore } from "../../../store/chat-store";
import { useEmoteStore } from "../../../store/emote-store";
import { useRenderCount } from "../../dev/use-render-count";
import { type ChatInputHandle, ChatInput } from "../ChatInput";
import { ChatMessageList } from "../ChatMessageList";
import { ChatQuickSettingsPopover } from "../ChatQuickSettingsPopover";
import { InlineModStrip, type InlineModAction } from "../mod/InlineModStrip";
import { ModActionConfirmDialog, type ModActionType } from "../mod/ModActionConfirmDialog";
import { TimeoutDurationPicker } from "../mod/TimeoutDurationPicker";
import { useChatRoomState } from "../../../hooks/useChatRoomState";
import { useChatSettingsSync } from "../../../hooks/useChatSettingsSync";
import { useRoomStateStore } from "../../../store/room-state-store";
import { PinnedMessageBanner } from "../PinnedMessageBanner";
import { PredictionBanner } from "../PredictionBanner";
import { useStickyDismissedPrediction } from "@/hooks/useStickyDismissedPrediction";
import type { UnifiedPrediction } from "@/shared/chat-types";
import { seedKickChatHistory } from "./kick-chat-history";
import { KickPinMessageDialog } from "./KickPinMessageDialog";
import { ChatPanelTabs, type ChatPanelTabId } from "../mod/ChatPanelTabs";
import { ModLogTab } from "../mod/tabs/ModLogTab";
import { UserPopoutProvider } from "../mod/UserPopout/UserPopoutProvider";

export interface KickChatProps {
  /** Channel name (slug) to join */
  channel: string;
  /** Kick channel's internal db id — required for the v2 /messages history fetch. */
  channelId?: string;
  /** Chatroom ID (required for Kick) */
  chatroomId?: number;
  /** Kick broadcaster user_id — used to resolve the channel's 7TV emotes. */
  kickUserId?: string;
  /** Subscriber badges for the channel (for badge rendering) */
  subscriberBadges?: any[];
}

/** U13 — Kick has no raid/commercial/shield/unique-chat. The strip only fires
 *  four chat-mode toggles and a local clear. */
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

/** Human-readable timeout duration (toast label). Inlined to keep U11's
 *  surface-area minimal (see TwitchChat.tsx for the same helper). */
function formatTimeoutLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export const KickChat: React.FC<KickChatProps> = ({
  channel,
  channelId,
  chatroomId,
  kickUserId,
  subscriberBadges,
}) => {
  useRenderCount("KickChat");
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
  const prependMessages = useChatStore((state) => state.prependMessages);
  const updateConnectionStatus = useChatStore((state) => state.updateConnectionStatus);
  const clearMessages = useChatStore((state) => state.clearMessages);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const deleteMessagesByUser = useChatStore((state) => state.deleteMessagesByUser);

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
  // U5 — gate the in-chat poll + prediction widgets on viewer prefs. Reactive
  // selectors so toggling them live shows/hides the widget without remounting.
  const showPolls = useAuthStore(
    (state) =>
      state.preferences?.chatDisplay?.showPolls ??
      DEFAULT_CHAT_DISPLAY_PREFERENCES.showPolls,
  );
  const showPredictions = useAuthStore(
    (state) =>
      state.preferences?.chatDisplay?.showPredictions ??
      DEFAULT_CHAT_DISPLAY_PREFERENCES.showPredictions,
  );
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [pinnedMessage, setPinnedMessage] = useState<NormalizedPinnedMessage | null>(null);
  const [showPinned, setShowPinned] = useState(true);
  const [isPinExpanded, setIsPinExpanded] = useState(false);
  // Mod-action state (mirrors TwitchChat). Kick has no scope-reconnect flow
  // — perm checks happen server-side on the v2 pinned-message endpoint —
  // so we just gate the UI on broadcaster-of-self via useIsKickMod.
  const [pinDialogMessage, setPinDialogMessage] = useState<ChatMessage | null>(null);
  const [pinDialogBusy, setPinDialogBusy] = useState(false);
  // U11/U13 — generic mod-action dialog state. Widened in U13 to cover the
  // strip's chat-mode toggles + local clear.
  const [pendingModAction, setPendingModAction] = useState<PendingKickModAction | null>(
    null,
  );
  const [modActionBusy, setModActionBusy] = useState(false);
  const isMod = useIsKickMod(channel);
  // Optimistic per-channel chat-room state (U14).
  const kickRoomKey = channelId ?? (chatroomId ? String(chatroomId) : "");
  const roomState = useChatRoomState("kick", kickRoomKey || null);
  const updateRoomState = useRoomStateStore((s) => s.updateRoomState);

  // U6 — merge seam. Initial v2 channel-resolve `chatroomSettings` block +
  // ChatroomUpdatedEvent Pusher events + reconnect re-seed all converge
  // through this hook into useRoomStateStore. The store key uses the same
  // `channelId ?? String(chatroomId)` fallback the mod-strip writes under.
  useChatSettingsSync({
    platform: "kick",
    channel,
    channelId: kickRoomKey || null,
  });
  const kickUser = useAuthStore((state) => state.kickUser);
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
  // Auto-dismiss ended poll after 15 s; cancels on follow-up poll or unmount.
  const pollTimer = useManagedTimeout(useCallback(() => setActivePoll(null), []));
  // Latest subscriber badges, mirrored from the prop so the history-fetch
  // closure can resolve badge images without re-running the connection effect
  // every time the badges prop updates.
  const subscriberBadgesRef = useRef(subscriberBadges);

  // Track current channel for cleanup
  // Initialize with null so we know when it's the first connection (and clear previous messages)
  const currentChannelRef = useRef<{ channel: string; chatroomId?: number } | null>(null);

  // Initial Connection & Channel Joining
  useEffect(() => {
    // Use mounted flag for cleanup with React Strict Mode
    let isMounted = true;

    const connect = async () => {
      try {
        // Check if channel changed to clear previous messages
        // This will also be true on first mount since ref starts as null
        const isChannelChanged =
          !currentChannelRef.current ||
          currentChannelRef.current.channel !== channel ||
          currentChannelRef.current.chatroomId !== chatroomId;

        if (isChannelChanged) {
          clearMessages();
          currentChannelRef.current = { channel, chatroomId };
        }

        // Acquire a reference to the service (for multiview support)
        kickChatService.acquire();

        // The "Connecting to channel..." / "Connected to the channel" lines
        // mark the start of the LIVE session — they're injected below, after
        // the historical-message seed completes, so the final order in the
        // chat reads chronologically: [history] [Connecting] [Connected]
        // [live...].

        const kickToken = await window.electronAPI.auth.getToken("kick");

        if (!isMounted) return;

        // Sync 7TV enablement to the viewer's prefs BEFORE the global + channel
        // loads below so a disabled provider is excluded from this channel's
        // fetch (next-load semantics, R10). Read prefs imperatively — adding a
        // reactive dep here would re-run the whole connect effect. No-op when
        // the enabled set already matches.
        applyProviderPrefs(
          useAuthStore.getState().preferences?.chatDisplay ??
            DEFAULT_CHAT_DISPLAY_PREFERENCES,
        );

        if (kickToken) {
          // Authenticated
          await kickChatService.connect({
            accessToken: kickToken.accessToken,
            debug: import.meta.env.DEV,
          });

          if (!isMounted) return;

          // Initialize Kick Emotes
          initializeKickEmotes(kickToken.accessToken);
          if (isMounted) await loadGlobalEmotes("kick");
        } else {
          // Anonymous
          await kickChatService.connect({
            debug: import.meta.env.DEV,
          });

          if (!isMounted) return;
          // Just load 7TV globals (Kick has no global endpoint of its own).
          if (isMounted) await loadGlobalEmotes("kick");
        }

        if (!isMounted) return;

        // Identify channel ID for emotes (separate from the broadcaster
        // channelId prop, which is used by the v2 history endpoint).
        // Use chatroomId if available, otherwise channel slug.
        const emoteChannelId = chatroomId ? chatroomId.toString() : channel;

        if (isMounted && emoteChannelId) {
          setActiveChannel(emoteChannelId);
          // `kickUserId` (broadcaster user_id) is what 7TV keys Kick channels
          // by — distinct from `emoteChannelId` (the chatroom/slug map key).
          await loadChannelEmotes(emoteChannelId, channel, "kick", kickUserId);
        } else if (isMounted) {
          setActiveChannel(null);
        }

        if (!isMounted) return;

        if (channel && chatroomId) {
          // 1. Pull recent chat history into the store FIRST so it sits above
          //    the live-session markers. The v2 fetch happens before Pusher
          //    is subscribed (joinChannel below), so there's no race with
          //    live messages.
          if (channelId) {
            await seedKickChatHistory({
              channelId,
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
            });
            if (!isMounted) return;
          }

          // 2. Mark the start of the live session.
          addMessage({
            id: crypto.randomUUID(),
            platform: "kick",
            type: "system",
            channel: channel,
            userId: "system",
            username: "System",
            displayName: "System",
            color: "#808080",
            badges: [],
            content: [{ type: "text", content: "Connecting to channel..." }],
            rawContent: "Connecting to channel...",
            timestamp: new Date(),
            isDeleted: false,
            isHighlighted: true,
            isAction: false,
          });

          // 3. Subscribe to Pusher; live messages start flowing after this.
          //    `channelId` here is the broadcaster's user_id (v2 channel
          //    `data.id`) — required by `kickChatService.sendMessage` so the
          //    official `POST /public/v1/chat` endpoint addresses the right
          //    channel. Distinct from chatroomId; if it hasn't resolved yet
          //    we still join (Pusher receive only) and sendMessage throws
          //    with a clear message until the next mount supplies it.
          const parsedBroadcasterId = Number(channelId);
          const broadcasterUserId = Number.isFinite(parsedBroadcasterId)
            ? parsedBroadcasterId
            : undefined;
          await kickChatService.joinChannel(channel, chatroomId, broadcasterUserId);

          if (!isMounted) return;

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

          // 4. Confirm the live session is up.
          addMessage({
            id: crypto.randomUUID(),
            platform: "kick",
            type: "system",
            channel: channel,
            userId: "system",
            username: "System",
            displayName: "System",
            color: "#808080",
            badges: [],
            content: [{ type: "text", content: "Connected to the channel" }],
            rawContent: "Connected to the channel",
            timestamp: new Date(),
            isDeleted: false,
            isHighlighted: true,
            isAction: false,
          });
        }
      } catch (error) {
        if (isMounted) {
          console.error("Failed to connect Kick chat:", error);
        }
      }
    };

    connect();

    return () => {
      isMounted = false;

      // Cleanup: release the service reference
      // In single-view: This will trigger shutdown when activeUsers reaches 0
      // In multi-view: Other components keep the service alive
      if (currentChannelRef.current?.channel) {
        kickChatService.release(currentChannelRef.current.channel);

        // U1 — release the predictions service reference for this channel.
        // Pairs with the acquire() above. Safe to call even if acquire never
        // ran (no-op when the channelId is unknown).
        if (channelId) {
          kickPredictionsService.release({ channelId });
        }

        // Memory cleanup: unload channel emotes to free RAM
        const emoteChannelId = currentChannelRef.current.chatroomId
          ? currentChannelRef.current.chatroomId.toString()
          : currentChannelRef.current.channel;
        unloadChannelEmotes(emoteChannelId);
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
    chatroomId,
    kickUserId,
    clearMessages,
    loadGlobalEmotes,
    loadChannelEmotes,
    setActiveChannel,
    unloadChannelEmotes,
    applyProviderPrefs,
    addMessage,
    prependMessages,
  ]);

  // Separate effect for updating subscriber badges without triggering reconnection
  // This is intentionally separate from the connection effect to prevent badge updates
  // from causing the chat to disconnect and reconnect
  useEffect(() => {
    subscriberBadgesRef.current = subscriberBadges;
    if (channel && subscriberBadges && subscriberBadges.length > 0) {
      kickChatService.setChannelBadges(channel, subscriberBadges);
    }
  }, [channel, subscriberBadges]);

  // Mid-session auth-identity swap. The primary connect effect above runs
  // once on mount with the auth state at that moment and doesn't react to
  // sign-in / sign-out via the ProfileDropdown. Without this effect, a
  // fresh sign-in keeps using the anonymous Pusher subscription, so the
  // POST /public/v1/chat send path can't address the right user; the
  // reverse leaves an authenticated socket alive after logout. We track
  // the last seen value in a ref so the very first render — which is
  // always handled by the primary effect — is a no-op here.
  const lastAuthRef = useRef(isAuthenticated);
  useEffect(() => {
    if (lastAuthRef.current === isAuthenticated) return;
    lastAuthRef.current = isAuthenticated;
    if (!channel || !chatroomId) return;

    let cancelled = false;
    void (async () => {
      try {
        // Hard reset: sets `this.pusher = null` inside the service so the
        // subsequent connect() creates a fresh Pusher client with the new
        // identity rather than returning early on its "already connected"
        // check. activeUsers is untouched, so the refcount stays intact.
        await kickChatService.disconnect();
        if (cancelled) return;

        const kickToken = isAuthenticated
          ? await window.electronAPI.auth.getToken("kick")
          : null;
        if (cancelled) return;

        await kickChatService.connect({
          accessToken: kickToken?.accessToken,
          debug: import.meta.env.DEV,
        });
        if (cancelled) return;

        const parsedBroadcasterId = Number(channelId);
        const broadcasterUserId = Number.isFinite(parsedBroadcasterId)
          ? parsedBroadcasterId
          : undefined;
        await kickChatService.joinChannel(channel, chatroomId, broadcasterUserId);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to swap Kick chat identity:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, channel, chatroomId, channelId]);

  // Reset pin + prediction + poll banner state on channel change. Without
  // this, switching from a channel-with-{pin,prediction,poll} to one without
  // leaves the previous banner stuck on screen — no "nothing here" signal
  // fires for the new channel to overwrite the stale React state. Local
  // state is keyed only to the React tree, not the channel.
  useEffect(() => {
    setPinnedMessage(null);
    setShowPinned(true);
    setIsPinExpanded(false);
    setActivePrediction(null);
    setActivePoll(null);
    setShowPoll(true);
    setIsPollExpanded(false);
    pollTimer.clear();
  }, [channel, pollTimer]);

  // Event Listeners
  useEffect(() => {
    const handleMessage = (message: ChatMessage) => {
      if (message.platform === "kick") {
        addMessageBatched(message, "kick");
      }
    };

    const handleUserNotice = (notice: UserNotice) => {
      if (notice.platform !== "kick") return;
      // U5 — viewer can hide sub / gifted-sub / host-raid lines. Read prefs
      // imperatively so this handler isn't re-registered (and Pusher isn't
      // resubscribed) on every preference change.
      const cd =
        useAuthStore.getState().preferences?.chatDisplay ??
        DEFAULT_CHAT_DISPLAY_PREFERENCES;
      if (!cd.showUserNotices) return;
      const systemMessage: ChatMessage = {
        id: notice.id,
        platform: notice.platform,
        type: "system",
        channel: notice.channel,
        userId: notice.userId,
        username: "System",
        displayName: "System",
        color: "#808080",
        badges: [],
        content: [{ type: "text", content: notice.systemMessage }],
        rawContent: notice.systemMessage,
        timestamp: notice.timestamp,
        isDeleted: false,
        isHighlighted: true,
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
      // U5 — `showClearChat` gates the chat-cleared NOTICE line, not the
      // moderation effect: the messages are still removed, only the "Chat was
      // cleared" / ban marker is hidden.
      const cd =
        useAuthStore.getState().preferences?.chatDisplay ??
        DEFAULT_CHAT_DISPLAY_PREFERENCES;

      if (clear.isClearAll) {
        clearMessages(clear.platform);
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
        const { messages } = useChatStore.getState();
        const lastMsg = [...messages]
          .reverse()
          .find((m) => m.userId === clear.targetUserId && m.type === "message");
        deleteMessagesByUser(clear.targetUserId);
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
            lastMessage: lastMsg?.rawContent,
            duration: clear.duration,
          },
        });
      }
    };

    const handleMessageDeleted = (deletion: MessageDeletion) => {
      deleteMessage(deletion.messageId);
    };

    const handleError = (error: Error) => {
      console.error("Kick Chat Error:", error);
    };

    const handlePinnedMessage = (msg: NormalizedPinnedMessage) => {
      setPinnedMessage(msg);
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
      const matchesId =
        !localId || !prediction.channelId || prediction.channelId === localId;
      const matchesSlug =
        !!channel && !!prediction.channelSlug && prediction.channelSlug === channel;
      if (!matchesId && !matchesSlug) {
        return;
      }
      if (predictionDismissGate.shouldSuppress(prediction.id)) return;
      setActivePrediction(prediction);
    };

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
    kickRoomKey,
    channel,
    predictionDismissGate,
    pollTimer,
  ]);

  const handleReply = useCallback((message: ChatMessage) => {
    chatInputRef.current?.replyTo(message);
  }, []);

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
      {/* Pinned Message Banner */}
      {pinnedMessage && showPinned && (
        <PinnedMessageBanner
          pin={pinnedMessage}
          role={isMod ? "mod" : "viewer"}
          isExpanded={isPinExpanded}
          onExpandToggle={() => setIsPinExpanded((v) => !v)}
          onDismiss={() => setShowPinned(false)}
          onUnpin={
            isMod
              ? async () => {
                  try {
                    const token = await window.electronAPI.auth.getToken("kick");
                    if (!token?.accessToken) return;
                    const result = await unpinKickMessage(channel, token.accessToken);
                    if (result.ok) {
                      // Optimistic clear. The PinnedMessageDeletedEvent
                      // from Pusher will fire shortly after Kick processes
                      // the unpin and confirms the local state.
                      setPinnedMessage(null);
                    }
                  } catch (error) {
                    if (process.env.NODE_ENV !== "production") {
                      console.error("Kick unpin failed:", error);
                    }
                  }
                }
              : undefined
          }
          // Hide Reply for guests — same logic as TwitchChat: the action
          // drafts an @mention into the chat input, which guests can't send.
          onReply={
            isAuthenticated
              ? () => chatInputRef.current?.mentionUser(pinnedMessage.author.username)
              : undefined
          }
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

      {/* U13 — Inline mod strip. Kick exposes only the 4 chat-mode toggles
       *  plus a local clear. Broadcaster check is unused since Kick has no
       *  raid/commercial. */}
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
        <ChatMessageList
          key={`kick-${channel}-${chatroomId}`}
          onReply={handleReply}
          onPin={isMod ? (message) => setPinDialogMessage(message) : undefined}
          onTimeout={isMod ? (message) => setPendingModAction({ kind: "messageScoped", message, actionType: "timeout" }) : undefined}
          onBan={isMod ? (message) => setPendingModAction({ kind: "messageScoped", message, actionType: "ban" }) : undefined}
          onUnban={isMod ? (message) => setPendingModAction({ kind: "messageScoped", message, actionType: "unban" }) : undefined}
          onDelete={isMod ? (message) => setPendingModAction({ kind: "messageScoped", message, actionType: "delete" }) : undefined}
          selfUserId={kickUser ? String(kickUser.id) : undefined}
          currentChannelContext={
            kickRoomKey
              ? {
                  channelId: kickRoomKey,
                  channelSlug: channel,
                  kickChatroomId: chatroomId,
                }
              : undefined
          }
        />
      </div>

      <div className="border-t border-[var(--color-border)]">
        {/* U7 — the gear + its "Clear local chat" action moved to the panel
         *  header popover (outside ChatPanelTabs). The footer is now just the
         *  message composer. */}
        <div className="p-3">
          <ChatInput
            ref={chatInputRef}
            platform="kick"
            channel={channel}
            channelId={kickRoomKey || null}
            chatroomId={chatroomId}
            canSend={isAuthenticated && isKickConnected}
          />
        </div>
      </div>
    </div>
  );

  return (
    <UserPopoutProvider>
    <div className="flex flex-col h-full w-full bg-[var(--color-background-secondary)]">
      <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
        <h2 className="font-semibold flex items-center gap-2">
          <span className="text-white">Chat</span>
        </h2>
        {/* U7 — gear lives in the header chrome OUTSIDE ChatPanelTabs so the
         *  single-tab viewer path doesn't strip it (chat-header-banner learning).
         *  `relative` anchors the popover; the gear gets an accent state while open. */}
        <div className="relative flex space-x-2">
          <button
            type="button"
            onClick={() => setShowChatSettings((v) => !v)}
            aria-label="Chat settings"
            aria-expanded={showChatSettings}
            title="Chat settings"
            className={
              showChatSettings
                ? "text-[#dc143c] flex-shrink-0"
                : "text-gray-400 hover:text-white flex-shrink-0"
            }
          >
            <BsGear size={16} />
          </button>
          {showChatSettings && (
            <ChatQuickSettingsPopover
              onClose={() => setShowChatSettings(false)}
              onClearChat={() => clearMessages()}
            />
          )}
        </div>
      </div>
      <ChatPanelTabs visibleTabs={visibleTabs}>
        {{
          chat: chatBody,
          modlog: channelId ? (
            <ModLogTab channelId={channelId} />
          ) : (
            <div className="p-4 text-gray-400">No channel selected.</div>
          ),
        }}
      </ChatPanelTabs>

      {/* U11/U13 — Generic mod-action confirm dialog for Kick. The pin dialog
       *  stays separate (plan decision #12). Kick has no scope-reconnect
       *  flow, so the result branches are simpler than Twitch's. */}
      {pendingModAction ? (
        (() => {
          const action = pendingModAction;
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
            // Re-use a Twitch-purple variant for the look; preview text carries
            // the real wording (Kick has its own copy needs but we share the
            // single dialog body to keep the surface minimal).
            actionType = "uniqueChat";
            const LABEL: Record<typeof action.modeKind, [string, string]> = {
              "slow-mode": ["Turn ON slow mode", "Turn OFF slow mode"],
              "followers-only": [
                "Turn ON followers-only mode",
                "Turn OFF followers-only mode",
              ],
              "subscribers-only": [
                "Turn ON subscribers-only mode",
                "Turn OFF subscribers-only mode",
              ],
              "emote-only": ["Turn ON emote-only mode", "Turn OFF emote-only mode"],
            };
            const [on, off] = LABEL[action.modeKind];
            targetPreview = (
              <div className="text-sm font-medium">
                {action.currentlyActive ? off : on}
              </div>
            );
          } else {
            actionType = "clear";
            targetPreview = (
              <div className="text-sm">Clear chat for everyone in this channel</div>
            );
          }

          const needsTimeoutSlot =
            action.kind === "messageScoped" && action.actionType === "timeout";
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
                needsTimeoutSlot || needsSlowSlot || needsFollowersSlot
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
                    clearMessages();
                    setPendingModAction(null);
                    toast.success("Cleared local chat");
                    return;
                  }
                  const token = await window.electronAPI.auth.getToken("kick");
                  if (!token?.accessToken) {
                    setPendingModAction(null);
                    toast.error("Sign in to Kick to take this action");
                    return;
                  }
                  let result: KickModResult;
                  if (action.kind === "stripChatMode") {
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
                      toast.success("Chat mode updated");
                      return;
                    }
                  } else if (action.kind === "messageScoped") {
                    const username = action.message.username;
                    let messageResult: KickModResult;
                    switch (action.actionType) {
                      case "ban":
                        messageResult = await banKickUser({
                          channelSlug: channel,
                          username,
                          accessToken: token.accessToken,
                        });
                        break;
                      case "timeout": {
                        const seconds =
                          (extraData as { durationSeconds?: number } | undefined)
                            ?.durationSeconds ?? 600;
                        // Kick's API takes `duration` in MINUTES; our picker
                        // emits seconds. The "10s" preset would round down to
                        // 0 minutes via integer division; Kick rejects that,
                        // so we clamp the floor to 1 minute.
                        const minutes = Math.max(1, Math.floor(seconds / 60));
                        messageResult = await timeoutKickUser({
                          channelSlug: channel,
                          username,
                          duration: minutes,
                          accessToken: token.accessToken,
                        });
                        break;
                      }
                      case "unban":
                        messageResult = await unbanKickUser({
                          channelSlug: channel,
                          username,
                          accessToken: token.accessToken,
                        });
                        break;
                      case "delete":
                        if (chatroomId === undefined) {
                          setPendingModAction(null);
                          toast.error("Couldn't delete message", {
                            description: "Chatroom not loaded",
                          });
                          return;
                        }
                        messageResult = await deleteKickMessage({
                          chatroomId,
                          messageId: action.message.id,
                          accessToken: token.accessToken,
                        });
                        break;
                    }
                    result = messageResult;
                    if (result.ok) {
                      setPendingModAction(null);
                      if (action.actionType === "ban")
                        toast.success(`Banned ${username}`);
                      else if (action.actionType === "unban")
                        toast.success(`Unbanned ${username}`);
                      else if (action.actionType === "delete")
                        toast.success("Deleted message");
                      else {
                        const seconds =
                          (extraData as { durationSeconds?: number } | undefined)
                            ?.durationSeconds ?? 600;
                        toast.success(
                          `Timed out ${username} for ${formatTimeoutLabel(seconds)}`,
                        );
                      }
                      return;
                    }
                  } else {
                    // Unreachable — clear branch returned earlier.
                    return;
                  }

                  if (result.kind === "forbidden") {
                    toast.error("Action forbidden", { description: result.message });
                    return;
                  }
                  if (result.kind === "rate-limited") {
                    const retry = result.retryAfterSeconds;
                    toast.error(
                      retry !== null
                        ? `Rate-limited, retry in ${retry}s`
                        : "Rate-limited, retry shortly",
                    );
                    return;
                  }
                  setPendingModAction(null);
                  toast.error("Couldn't complete action", {
                    description: result.message ?? result.kind,
                  });
                } finally {
                  setModActionBusy(false);
                }
              }}
            />
          );
        })()
      ) : null}

      {/* Kick pin duration picker. Channel slug + chatroomId are required by
       *  the v2 pinned-message endpoint; we only render the dialog when both
       *  are known, which is true any time a KickChat is mounted. */}
      {pinDialogMessage && chatroomId ? (
        <KickPinMessageDialog
          open={!!pinDialogMessage}
          onOpenChange={(open) => {
            if (!open) setPinDialogMessage(null);
          }}
          messagePreview={pinDialogMessage.rawContent || ""}
          busy={pinDialogBusy}
          onConfirm={async (durationSeconds) => {
            setPinDialogBusy(true);
            try {
              const token = await window.electronAPI.auth.getToken("kick");
              if (!token?.accessToken || !kickUser) return;
              const result = await pinKickMessage({
                channelSlug: channel,
                messageId: pinDialogMessage.id,
                chatroomId,
                content: pinDialogMessage.rawContent,
                sender: {
                  id: kickUser.id,
                  username: kickUser.username,
                  slug: kickUser.slug,
                },
                durationSeconds,
                accessToken: token.accessToken,
              });
              if (result.ok) {
                setPinDialogMessage(null);
              }
              // Failures leave the dialog open so the user can retry; a
              // toast/error surface is a future follow-up.
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
  const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
  const maxVotes = Math.max(...poll.options.map((o) => o.votes), 0);
  const isPollEnded = poll.remaining <= 0;

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-background-tertiary,#1a1a1a)] text-sm">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-gray-400 text-xs font-medium">Poll:</span>
          <span className="text-white text-xs font-semibold truncate">{poll.title}</span>
          {isPollEnded && (
            <span className="text-xs text-gray-500 flex-shrink-0">Ended</span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={onToggleExpand}
            className="p-1 text-gray-400 hover:text-white rounded transition-colors"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            <BsChevronDown
              size={12}
              style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
            />
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 text-gray-400 hover:text-white rounded transition-colors"
            title="Dismiss"
          >
            <BsX size={14} />
          </button>
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
                  <span className="text-gray-400">
                    {option.votes} ({pct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${isWinner ? "bg-[#53FC18]" : "bg-[var(--color-primary,#53FC18)]"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
          {!isPollEnded && poll.duration > 0 && (
            <div className="h-0.5 rounded-full bg-white/10 overflow-hidden mt-2">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                style={{ width: `${Math.min((poll.remaining / poll.duration) * 100, 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

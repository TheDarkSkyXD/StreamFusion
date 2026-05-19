import type React from "react";
import { useEffect, useRef, useState } from "react";
import { BsGear, BsX } from "react-icons/bs";
import { toast } from "sonner";
import {
  pinChatMessage,
  unpinChatMessage,
} from "../../../backend/api/platforms/twitch/twitch-gql-pin-mutations";
import {
  banUser,
  clearChat as clearChatHelix,
  deleteChatMessage,
  type HelixModResult,
  runCommercial,
  setShieldMode,
  startRaid,
  timeoutUser,
  unbanUser,
  updateChatSettings,
} from "../../../backend/api/platforms/twitch/twitch-helix-moderation-mutations";
import { twitchChatService } from "../../../backend/services/chat/twitch-chat";
import {
  startTwitchPinPolling,
  stopTwitchPinPolling,
} from "../../../backend/services/chat/twitch-pin-poller";
import { initializeTwitchEmotes } from "../../../backend/services/emotes";
import { useIsTwitchMod } from "../../../hooks/useIsTwitchMod";
import { useRequireModScopes } from "../../../hooks/useRequireModScopes";
import { InlineModStrip, type InlineModAction } from "../mod/InlineModStrip";
import { ModActionConfirmDialog, type ModActionType } from "../mod/ModActionConfirmDialog";
import {
  appendRecentRaid,
  RaidTargetPicker,
  type RaidTarget,
} from "../mod/RaidTargetPicker";
import { TimeoutDurationPicker } from "../mod/TimeoutDurationPicker";
import { useChatRoomState } from "../../../hooks/useChatRoomState";
import { useRoomStateStore } from "../../../store/room-state-store";
import { useAuthStore } from "../../../store/auth-store";
import { useDevModOverrideStore } from "../../../store/dev-mod-override-store";
import type {
  ChatConnectionStatus,
  ChatMessage,
  ClearChat,
  MessageDeletion,
  NormalizedPinnedMessage,
  UserNotice,
} from "../../../shared/chat-types";
import { useChatStore } from "../../../store/chat-store";
import { useEmoteStore } from "../../../store/emote-store";
import { useRenderCount } from "../../dev/use-render-count";
import { type ChatInputHandle, ChatInput } from "../ChatInput";
import { ChatMessageList } from "../ChatMessageList";
import { PinnedMessageBanner } from "../PinnedMessageBanner";
import { seedTwitchChatHistory } from "./twitch-chat-history";
import { TwitchPinMessageDialog } from "./TwitchPinMessageDialog";
import { ChatPanelTabs, type ChatPanelTabId } from "../mod/ChatPanelTabs";
import { EngagementTab } from "../mod/tabs/EngagementTab";
import { ModLogTab } from "../mod/tabs/ModLogTab";
import { UserPopoutProvider } from "../mod/UserPopout/UserPopoutProvider";

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
      actionType: Extract<ModActionType, "timeout" | "ban" | "unban" | "delete">;
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

/** Human-readable timeout duration (toast label). Mirrors the small helper
 *  in ChatMessage.tsx; inlined here rather than exported to keep U11's
 *  surface-area minimal per the plan's "Do NOT modify ChatMessage.tsx" rule. */
function formatTimeoutLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export const TwitchChat: React.FC<TwitchChatProps> = ({ channel, channelId }) => {
  useRenderCount("TwitchChat");
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

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [pinnedMessage, setPinnedMessage] = useState<NormalizedPinnedMessage | null>(null);
  const [showPinned, setShowPinned] = useState(true);
  const [isPinExpanded, setIsPinExpanded] = useState(false);
  // Mod-action state (U8): the message currently queued for the Pin dialog.
  const [pinDialogMessage, setPinDialogMessage] = useState<ChatMessage | null>(null);
  const [pinDialogBusy, setPinDialogBusy] = useState(false);
  // U11 — generic mod-action confirm dialog state (Timeout/Ban/Unban/Delete).
  // U13/U15 widened the union to include strip-driven actions which carry no
  // chat message. The dialog branches on `kind` to render the correct preview
  // and slot.
  const [pendingModAction, setPendingModAction] = useState<PendingTwitchModAction | null>(
    null,
  );
  const [modActionBusy, setModActionBusy] = useState(false);
  // Optimistic local copy of the channel's chat-room state (U14). Reads + writes
  // flow through useRoomStateStore; the hook auto-fills DEFAULT_ROOM_STATE.
  const roomState = useChatRoomState("twitch", channelId ?? null);
  const updateRoomState = useRoomStateStore((s) => s.updateRoomState);

  // Mod-role gating for Pin/Unpin actions. Both hooks return safe defaults
  // when the user isn't signed in or doesn't moderate the current channel.
  const isMod = useIsTwitchMod(channelId);
  const { hasModScopes, promptReconnect } = useRequireModScopes();
  // Moderator's own Twitch user id — required for every Helix mod-action call
  // as the `moderator_id` query param. Pulled from the auth store rather than
  // re-fetched per call.
  const twitchUser = useAuthStore((state) => state.twitchUser);

  // Track current channel for cleanup
  // Initialize with null so we know when it's the first connection (and clear previous messages)
  const currentChannelRef = useRef<string | null>(null);
  // Imperative handle on ChatInput for the pinned-message Reply action.
  const chatInputRef = useRef<ChatInputHandle>(null);
  // Track channelId for emote cleanup
  const currentChannelIdRef = useRef<string | null>(null);

  // Initial Connection & Channel Joining
  useEffect(() => {
    // Use AbortController pattern for cleanup with React Strict Mode
    let isMounted = true;

    const connect = async () => {
      try {
        // Clear previous messages only when channel changes
        // This will also be true on first mount since ref starts as null
        if (currentChannelRef.current !== channel) {
          clearMessages();
          currentChannelRef.current = channel;
        }

        // Acquire a reference to the service (for multiview support)
        twitchChatService.acquire();

        // The "Connecting to channel..." / "Connected to the channel" lines
        // mark the start of the LIVE session — they're injected inside
        // joinAndSeed below, after the historical-message seed completes,
        // so the final order reads chronologically:
        // [history] [Connecting] [Connected] [live...].
        const joinAndSeed = async (target: string, userId?: string): Promise<void> => {
          await seedTwitchChatHistory({
            channel: target,
            isMounted: () => isMounted,
            prependMessages,
          });
          if (!isMounted) return;

          addMessage({
            id: crypto.randomUUID(),
            platform: "twitch",
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

          await twitchChatService.joinChannel(target, userId);
          if (!isMounted) return;

          addMessage({
            id: crypto.randomUUID(),
            platform: "twitch",
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
        };

        const twitchToken = await window.electronAPI.auth.getToken("twitch");
        const twitchUser = await window.electronAPI.auth.getTwitchUser();
        const twitchClientId = import.meta.env.VITE_TWITCH_CLIENT_ID;

        // Check if component is still mounted after async calls
        if (!isMounted) return;

        if (twitchToken && twitchUser) {
          // Authenticated
          await twitchChatService.connect({
            accessToken: twitchToken.accessToken,
            user: twitchUser,
            clientId: twitchClientId,
          });

          // Check if connection was successful (might be aborted by Strict Mode cleanup)
          if (!isMounted) return;
          const status = twitchChatService.getConnectionStatus();
          if (status.state !== "connected") {
            // Connection was aborted, don't continue
            return;
          }

          setIsAuthenticated(true);

          // Initialize Twitch Emotes
          if (twitchClientId) {
            await initializeTwitchEmotes(twitchClientId, twitchToken.accessToken);
            // Reload global emotes now that we have credentials
            if (isMounted) await loadGlobalEmotes();
          }

          if (!isMounted) return;

          // Join channel
          // If channel provided, join it. Else join own channel.
          const target = channel || twitchUser.login;
          await joinAndSeed(target, twitchUser.id);
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

            setIsAuthenticated(false);
            await joinAndSeed(channel);
          }
        }
      } catch (error) {
        if (isMounted) {
          console.error("Failed to connect Twitch chat:", error);
        }
      }
    };

    connect();

    return () => {
      isMounted = false;
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
    // loadGlobalEmotes and setActiveChannel are intentionally excluded from deps
    // to prevent chat reconnection when these store functions change. Global emotes are loaded once during initial connection,
    // and channel emotes are handled in a separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    channel,
    clearMessages,
    addMessage,
    prependMessages,
    unloadChannelEmotes,
    loadGlobalEmotes,
    setActiveChannel,
  ]);

  // Separate effect for loading channel emotes without triggering reconnection
  // This is intentionally separate from the connection effect to prevent channelId changes
  // (e.g., during React Query refetches) from causing the chat to disconnect and reconnect
  useEffect(() => {
    if (channel && channelId) {
      currentChannelIdRef.current = channelId; // Track for cleanup
      setActiveChannel(channelId);
      loadChannelEmotes(channelId, channel, "twitch");
    } else {
      setActiveChannel(null);
    }
  }, [channel, channelId, setActiveChannel, loadChannelEmotes]);

  // Pin polling — independent of IRC/auth so the banner can populate within
  // a network round-trip of mount (~50ms) instead of waiting on joinChannel.
  // The cleanup clears stale pin state so switching from a channel-with-pin
  // to a channel-without-pin doesn't leave the previous banner stuck on screen.
  useEffect(() => {
    if (!channel) return;
    setPinnedMessage(null);
    setShowPinned(true);
    setIsPinExpanded(false);
    startTwitchPinPolling(channel);
    return () => {
      stopTwitchPinPolling(channel);
    };
  }, [channel]);

  // Event Listeners
  useEffect(() => {
    const handleMessage = (message: ChatMessage) => {
      if (message.platform === "twitch") {
        addMessageBatched(message, "twitch");
      }
    };

    const handleUserNotice = (notice: UserNotice) => {
      if (notice.platform !== "twitch") return;
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
      if (status.platform === "twitch") {
        updateConnectionStatus(status);
      }
    };

    const handleClearChat = (clear: ClearChat) => {
      if (clear.platform !== "twitch") return;

      if (clear.isClearAll) {
        clearMessages(clear.platform);
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
      console.error("Twitch Chat Error:", error);
    };

    const handlePinnedMessage = (pin: NormalizedPinnedMessage) => {
      if (pin.platform !== "twitch") return;
      setPinnedMessage(pin);
      setShowPinned(true);
      setIsPinExpanded(false);
    };

    const handlePinnedMessageCleared = () => {
      setPinnedMessage(null);
    };

    twitchChatService.on("message", handleMessage);
    twitchChatService.on("userNotice", handleUserNotice);
    twitchChatService.on("connectionStateChange", handleConnectionStatus);
    twitchChatService.on("clearChat", handleClearChat);
    twitchChatService.on("messageDeleted", handleMessageDeleted);
    twitchChatService.on("error", handleError);
    twitchChatService.on("pinnedMessage", handlePinnedMessage);
    twitchChatService.on("pinnedMessageCleared", handlePinnedMessageCleared);

    return () => {
      twitchChatService.off("message", handleMessage);
      twitchChatService.off("userNotice", handleUserNotice);
      twitchChatService.off("connectionStateChange", handleConnectionStatus);
      twitchChatService.off("clearChat", handleClearChat);
      twitchChatService.off("messageDeleted", handleMessageDeleted);
      twitchChatService.off("error", handleError);
      twitchChatService.off("pinnedMessage", handlePinnedMessage);
      twitchChatService.off("pinnedMessageCleared", handlePinnedMessageCleared);
    };
  }, [
    addMessage,
    addMessageBatched,
    updateConnectionStatus,
    clearMessages,
    deleteMessage,
    deleteMessagesByUser,
  ]);

  // U19 — visible tabs based on role. Viewer = chat only (the component
  // suppresses the strip), mod = chat + modlog, broadcaster adds engagement.
  // The broadcaster check is approximate per the plan: Twitch's broadcaster
  // id IS the user id, so user.id === channelId is sufficient. The dev
  // override (forceBroadcasterIdentity) flips the gate on for visual testing.
  const forceBroadcasterIdentity = useDevModOverrideStore(
    (s) => s.forceBroadcasterIdentity,
  );
  const isCurrentUserBroadcaster =
    forceBroadcasterIdentity ||
    (!!twitchUser && twitchUser.id === channelId);
  const visibleTabs: ChatPanelTabId[] = ["chat"];
  if (isMod) {
    visibleTabs.push("modlog");
  }
  if (isCurrentUserBroadcaster) {
    visibleTabs.push("engagement");
  }

  // U19 — Chat-tab body. Keeps the existing pinned banner / mod strip /
  // message list / input footer wiring intact. The mod-action and pin
  // dialogs stay outside the tab so they overlay regardless of tab.
  const chatBody = (
    <div className="flex flex-col h-full w-full">
      {pinnedMessage && showPinned && (
        <PinnedMessageBanner
          pin={pinnedMessage}
          // Mods see the Unpin button in place of the viewer's hide-eye.
          role={isMod ? "mod" : "viewer"}
          isExpanded={isPinExpanded}
          onExpandToggle={() => setIsPinExpanded((v) => !v)}
          // Viewer-only local hide (only rendered when role === "viewer").
          onDismiss={() => setShowPinned(false)}
          // Mod-only server-side unpin. Gated by the same scope-check as Pin.
          onUnpin={
            isMod && pinnedMessage.pinRecordId
              ? async () => {
                  if (!hasModScopes) {
                    promptReconnect();
                    return;
                  }
                  try {
                    const token = await window.electronAPI.auth.getToken("twitch");
                    if (!token?.accessToken) return;
                    const result = await unpinChatMessage(
                      pinnedMessage.pinRecordId as string,
                      token.accessToken,
                    );
                    if (result.ok) {
                      // Optimistic local clear — poller will reconcile on
                      // the next tick when Twitch confirms.
                      setPinnedMessage(null);
                    } else if (result.kind === "unauthenticated") {
                      promptReconnect();
                    }
                  } catch (error) {
                    if (process.env.NODE_ENV !== "production") {
                      console.error("Unpin failed:", error);
                    }
                  }
                }
              : undefined
          }
          // Hide Reply for guests — the action drafts an @mention into the
          // chat input, but guests can't send messages anyway.
          onReply={
            isAuthenticated
              ? () => chatInputRef.current?.mentionUser(pinnedMessage.author.username)
              : undefined
          }
        />
      )}

      {/* U13 — Inline mod strip. Rendered between the pinned banner and the
       *  message list. Twitch-broadcaster sees raid + commercial too. */}
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
        <ChatMessageList
          key={`twitch-${channel}`}
          onPin={
            isMod
              ? (message) => {
                  // Lazy scope-check: if the token lacks the new scopes, surface
                  // the reconnect dialog instead of opening the pin dialog.
                  if (!hasModScopes) {
                    promptReconnect();
                    return;
                  }
                  setPinDialogMessage(message);
                }
              : undefined
          }
          // U11 — Timeout / Ban / Unban / Delete just open the generic confirm
          // dialog. The scope-gate fires inside onConfirm (not at click-time)
          // so the dialog opens immediately for the moderator regardless of
          // whether a token refresh is pending.
          onTimeout={isMod ? (message) => setPendingModAction({ kind: "messageScoped", message, actionType: "timeout" }) : undefined}
          onBan={isMod ? (message) => setPendingModAction({ kind: "messageScoped", message, actionType: "ban" }) : undefined}
          onUnban={isMod ? (message) => setPendingModAction({ kind: "messageScoped", message, actionType: "unban" }) : undefined}
          onDelete={isMod ? (message) => setPendingModAction({ kind: "messageScoped", message, actionType: "delete" }) : undefined}
          selfUserId={twitchUser?.id}
          currentChannelContext={
            channelId ? { channelId, channelSlug: channel } : undefined
          }
        />
      </div>

      <div className="border-t border-[var(--color-border)]">
        {showChatSettings && (
          <div className="p-2 border-b border-[var(--color-border)] bg-[var(--color-background-tertiary,#1a1a1a)] flex items-center justify-between">
            <button
              type="button"
              onClick={() => clearMessages()}
              className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
            >
              Clear local chat
            </button>
            <button
              type="button"
              onClick={() => setShowChatSettings(false)}
              className="text-gray-400 hover:text-white"
            >
              <BsX size={16} />
            </button>
          </div>
        )}
        <div className="p-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowChatSettings((v) => !v)}
            className="text-gray-400 hover:text-white flex-shrink-0"
            title="Chat settings"
          >
            <BsGear size={16} />
          </button>
          <div className="flex-1">
            <ChatInput
              ref={chatInputRef}
              platform="twitch"
              channel={channel}
              canSend={isAuthenticated && isTwitchConnected}
            />
          </div>
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
        <div className="flex space-x-2">{/* Status indicators can go here */}</div>
      </div>
      <ChatPanelTabs visibleTabs={visibleTabs}>
        {{
          chat: chatBody,
          modlog: channelId ? (
            <ModLogTab channelId={channelId} />
          ) : (
            <div className="p-4 text-gray-400">No channel selected.</div>
          ),
          engagement: channelId ? (
            <EngagementTab channelId={channelId} />
          ) : (
            <div className="p-4 text-gray-400">No channel selected.</div>
          ),
        }}
      </ChatPanelTabs>

      {/* U11/U13/U15 — Generic mod-action confirm dialog. Branches on the
       *  pendingModAction `kind` so message-scoped actions (Timeout/Ban/...) and
       *  strip-scoped actions (clear/raid/shield/chat-modes) all flow through
       *  the same surface. The pin dialog stays separate (plan decision #12). */}
      {pendingModAction && channelId && twitchUser ? (
        (() => {
          const action = pendingModAction;
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

          const needsTimeoutSlot =
            action.kind === "messageScoped" && action.actionType === "timeout";
          const needsSlowModeSlot =
            action.kind === "stripChatMode" &&
            action.modeKind === "slow-mode" &&
            !action.currentlyActive;
          const needsFollowersSlot =
            action.kind === "stripChatMode" &&
            action.modeKind === "followers-only" &&
            !action.currentlyActive;
          const needsRaidSlot =
            action.kind === "strip" && action.actionType === "raid";

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
                needsTimeoutSlot
                  ? ({ onDataChange, disabled }) => (
                      <TimeoutDurationPicker
                        disabled={disabled}
                        onChange={(s) => onDataChange({ durationSeconds: s })}
                      />
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
                const runMessageAction = async (
                  accessToken: string,
                ): Promise<HelixModResult<unknown>> => {
                  if (action.kind !== "messageScoped") {
                    throw new Error("unreachable");
                  }
                  const ctx = {
                    accessToken,
                    broadcasterId: channelId,
                    moderatorId: twitchUser.id,
                  };
                  switch (action.actionType) {
                    case "ban":
                      return banUser({ ...ctx, userId: action.message.userId });
                    case "timeout": {
                      const seconds =
                        (extraData as { durationSeconds?: number } | undefined)
                          ?.durationSeconds ?? 600;
                      return timeoutUser({
                        ...ctx,
                        userId: action.message.userId,
                        durationSeconds: seconds,
                      });
                    }
                    case "unban":
                      return unbanUser({ ...ctx, userId: action.message.userId });
                    case "delete":
                      return deleteChatMessage({
                        ...ctx,
                        messageId: action.message.id,
                      });
                  }
                };

                const runStripAction = async (
                  accessToken: string,
                ): Promise<HelixModResult<unknown>> => {
                  const ctx = {
                    accessToken,
                    broadcasterId: channelId,
                    moderatorId: twitchUser.id,
                  };
                  if (action.kind === "strip") {
                    switch (action.actionType) {
                      case "clear":
                        return clearChatHelix(ctx);
                      case "raid": {
                        const target = extraData as RaidTarget | null | undefined;
                        if (!target) {
                          return {
                            ok: false,
                            kind: "network",
                            message: "Pick a target channel first",
                          };
                        }
                        return startRaid({
                          accessToken,
                          fromBroadcasterId: channelId,
                          toBroadcasterId: target.broadcasterId,
                        });
                      }
                      case "commercial":
                        return runCommercial({
                          accessToken,
                          broadcasterId: channelId,
                          length: 60,
                        });
                      case "shield":
                        return setShieldMode({ ...ctx, active: true });
                      case "shieldOff":
                        return setShieldMode({ ...ctx, active: false });
                      case "uniqueChat":
                        return updateChatSettings({
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
                          ? (extraData as { durationSeconds?: number } | undefined)
                              ?.durationSeconds ?? 30
                          : undefined;
                        return updateChatSettings({
                          ...ctx,
                          settings: {
                            slow_mode: turnOn,
                            slow_mode_wait_time: turnOn ? seconds ?? 30 : null,
                          },
                        });
                      }
                      case "followers-only": {
                        const seconds = turnOn
                          ? (extraData as { durationSeconds?: number } | undefined)
                              ?.durationSeconds ?? 600
                          : undefined;
                        // Twitch wants follower_mode_duration in MINUTES.
                        const minutes = turnOn
                          ? Math.max(0, Math.floor((seconds ?? 600) / 60))
                          : undefined;
                        return updateChatSettings({
                          ...ctx,
                          settings: {
                            follower_mode: turnOn,
                            follower_mode_duration: turnOn ? minutes ?? 10 : null,
                          },
                        });
                      }
                      case "subscribers-only":
                        return updateChatSettings({
                          ...ctx,
                          settings: { subscriber_mode: turnOn },
                        });
                      case "emote-only":
                        return updateChatSettings({
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
                  const token = await window.electronAPI.auth.getToken("twitch");
                  if (!token?.accessToken) {
                    setPendingModAction(null);
                    toast.error("Sign in to Twitch to take this action");
                    return;
                  }
                  const result = await runAction(token.accessToken);
                  if (result.ok) {
                    // Optimistic room-state writeback so the strip flips its
                    // toggles immediately. The Helix call has already
                    // succeeded — TODO(U14.1) will replace this with the
                    // ROOMSTATE event from twitch-chat.
                    if (action.kind === "stripChatMode") {
                      const turnOn = !action.currentlyActive;
                      const seconds = turnOn
                        ? (extraData as { durationSeconds?: number } | undefined)
                            ?.durationSeconds ?? 30
                        : null;
                      if (action.modeKind === "slow-mode") {
                        updateRoomState("twitch", channelId, {
                          slowMode: turnOn ? seconds ?? 30 : null,
                        });
                      } else if (action.modeKind === "followers-only") {
                        const minutes = turnOn
                          ? Math.max(0, Math.floor((seconds ?? 600) / 60))
                          : null;
                        updateRoomState("twitch", channelId, {
                          followersOnly: turnOn ? minutes ?? 10 : null,
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
                      if (action.actionType === "ban") toast.success(`Banned ${username}`);
                      else if (action.actionType === "unban") toast.success(`Unbanned ${username}`);
                      else if (action.actionType === "delete") toast.success("Deleted message");
                      else {
                        const seconds =
                          (extraData as { durationSeconds?: number } | undefined)
                            ?.durationSeconds ?? 600;
                        toast.success(
                          `Timed out ${username} for ${formatTimeoutLabel(seconds)}`,
                        );
                      }
                    } else if (action.kind === "strip") {
                      toast.success("Done");
                    } else {
                      toast.success("Chat mode updated");
                    }
                    return;
                  }

                  if (result.kind === "missing-scopes") {
                    setPendingModAction(null);
                    promptReconnect({
                      missingScopes: result.missingScopes,
                      onReconnected: async () => {
                        const fresh = await window.electronAPI.auth.getToken("twitch");
                        if (!fresh?.accessToken) return;
                        const retry = await runAction(fresh.accessToken);
                        if (retry.ok) toast.success("Action completed");
                        else
                          toast.error("Action still failed after reconnect", {
                            description: retry.message,
                          });
                      },
                    });
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

      {/* Pin duration picker — opens when a mod clicks the hover Pin button
       *  on a chat message. On confirm, fires the GQL pinChatMessage mutation
       *  and lets the poller reconcile the banner on its next tick. */}
      {pinDialogMessage && channelId ? (
        <TwitchPinMessageDialog
          open={!!pinDialogMessage}
          onOpenChange={(open) => {
            if (!open) setPinDialogMessage(null);
          }}
          messagePreview={pinDialogMessage.rawContent || ""}
          busy={pinDialogBusy}
          onConfirm={async (durationSeconds) => {
            setPinDialogBusy(true);
            try {
              const token = await window.electronAPI.auth.getToken("twitch");
              if (!token?.accessToken) return;
              const result = await pinChatMessage(
                channelId,
                pinDialogMessage.id,
                durationSeconds,
                token.accessToken,
              );
              if (result.ok) {
                setPinDialogMessage(null);
                toast.success("Pinned message");
              } else if (result.kind === "unauthenticated") {
                setPinDialogMessage(null);
                promptReconnect();
              } else {
                // Forbidden / network / other failures: surface a toast and
                // close the dialog. The toast carries the action name + the
                // server's reason; the user can retry by re-opening the menu.
                setPinDialogMessage(null);
                toast.error("Couldn't pin message", {
                  description: result.message ?? result.kind,
                });
              }
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

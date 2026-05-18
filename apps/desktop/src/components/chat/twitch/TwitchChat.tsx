import type React from "react";
import { useEffect, useRef, useState } from "react";
import { BsGear, BsX } from "react-icons/bs";
import { toast } from "sonner";
import {
  pinChatMessage,
  unpinChatMessage,
} from "../../../backend/api/platforms/twitch/twitch-gql-pin-mutations";
import { twitchChatService } from "../../../backend/services/chat/twitch-chat";
import {
  startTwitchPinPolling,
  stopTwitchPinPolling,
} from "../../../backend/services/chat/twitch-pin-poller";
import { initializeTwitchEmotes } from "../../../backend/services/emotes";
import { useIsTwitchMod } from "../../../hooks/useIsTwitchMod";
import { useRequireModScopes } from "../../../hooks/useRequireModScopes";
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

export interface TwitchChatProps {
  /** Channel name to join */
  channel: string;
  /** Channel ID (broadcaster ID) */
  channelId?: string;
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

  // Mod-role gating for Pin/Unpin actions. Both hooks return safe defaults
  // when the user isn't signed in or doesn't moderate the current channel.
  const isMod = useIsTwitchMod(channelId);
  const { hasModScopes, promptReconnect } = useRequireModScopes();

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

  return (
    <div className="flex flex-col h-full w-full bg-[var(--color-background-secondary)]">
      <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <span className="text-white">Chat</span>
        </h2>
        <div className="flex space-x-2">{/* Status indicators can go here */}</div>
      </div>

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
        />
      </div>

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
};

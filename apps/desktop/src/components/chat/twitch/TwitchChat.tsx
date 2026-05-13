import type React from "react";
import { useEffect, useRef, useState } from "react";
import { BsGear, BsX } from "react-icons/bs";
import { twitchChatService } from "../../../backend/services/chat/twitch-chat";
import { initializeTwitchEmotes } from "../../../backend/services/emotes";
import type {
  ChatConnectionStatus,
  ChatMessage,
  ClearChat,
  MessageDeletion,
  UserNotice,
} from "../../../shared/chat-types";
import { useChatStore } from "../../../store/chat-store";
import { useEmoteStore } from "../../../store/emote-store";
import { ChatInput } from "../ChatInput";
import { ChatMessageList } from "../ChatMessageList";

export interface TwitchChatProps {
  /** Channel name to join */
  channel: string;
  /** Channel ID (broadcaster ID) */
  channelId?: string;
}

export const TwitchChat: React.FC<TwitchChatProps> = ({ channel, channelId }) => {
  // Chat store — subscribe only to fields read in render; actions have stable refs.
  const connectionStatus = useChatStore((state) => state.connectionStatus);
  const addMessage = useChatStore((state) => state.addMessage);
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

  // Track current channel for cleanup
  // Initialize with null so we know when it's the first connection (and clear previous messages)
  const currentChannelRef = useRef<string | null>(null);
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

        // System message: Connecting
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
          await twitchChatService.joinChannel(target, twitchUser.id);

          // System message: Connected
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
            await twitchChatService.joinChannel(channel);

            // System message: Connected
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
      currentChannelRef.current = null;
    };
    // loadGlobalEmotes and setActiveChannel are intentionally excluded from deps
    // to prevent chat reconnection when these store functions change. Global emotes are loaded once during initial connection,
    // and channel emotes are handled in a separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, clearMessages, addMessage, unloadChannelEmotes, loadGlobalEmotes, setActiveChannel]);

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

  // Event Listeners
  useEffect(() => {
    const handleMessage = (message: ChatMessage) => {
      if (message.platform === "twitch") {
        addMessage(message);
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

    twitchChatService.on("message", handleMessage);
    twitchChatService.on("userNotice", handleUserNotice);
    twitchChatService.on("connectionStateChange", handleConnectionStatus);
    twitchChatService.on("clearChat", handleClearChat);
    twitchChatService.on("messageDeleted", handleMessageDeleted);
    twitchChatService.on("error", handleError);

    return () => {
      twitchChatService.off("message", handleMessage);
      twitchChatService.off("userNotice", handleUserNotice);
      twitchChatService.off("connectionStateChange", handleConnectionStatus);
      twitchChatService.off("clearChat", handleClearChat);
      twitchChatService.off("messageDeleted", handleMessageDeleted);
      twitchChatService.off("error", handleError);
    };
  }, [addMessage, updateConnectionStatus, clearMessages, deleteMessage, deleteMessagesByUser]);

  return (
    <div className="flex flex-col h-full w-full bg-[var(--color-background-secondary)]">
      <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <span className="text-white">Chat</span>
        </h2>
        <div className="flex space-x-2">{/* Status indicators can go here */}</div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <ChatMessageList key={`twitch-${channel}`} />
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
              platform="twitch"
              channel={channel}
              canSend={isAuthenticated && connectionStatus.twitch.state === "connected"}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

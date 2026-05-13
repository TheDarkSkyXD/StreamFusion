import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BsChevronDown, BsGear, BsX } from "react-icons/bs";
import { kickChatService } from "../../../backend/services/chat/kick-chat";
import { initializeKickEmotes } from "../../../backend/services/emotes";
import type {
  ChatConnectionStatus,
  ChatMessage,
  ClearChat,
  KickPinnedMessage,
  KickPoll,
  MessageDeletion,
  UserNotice,
} from "../../../shared/chat-types";
import { useChatStore } from "../../../store/chat-store";
import { useEmoteStore } from "../../../store/emote-store";
import { type ChatInputHandle, ChatInput } from "../ChatInput";
import { ChatMessageList } from "../ChatMessageList";

export interface KickChatProps {
  /** Channel name to join */
  channel: string;
  /** Chatroom ID (required for Kick) */
  chatroomId?: number;
  /** Subscriber badges for the channel (for badge rendering) */
  subscriberBadges?: any[];
}

export const KickChat: React.FC<KickChatProps> = ({ channel, chatroomId, subscriberBadges }) => {
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
  const [pinnedMessage, setPinnedMessage] = useState<KickPinnedMessage | null>(null);
  const [showPinned, setShowPinned] = useState(true);
  const [isPinExpanded, setIsPinExpanded] = useState(false);
  const [activePoll, setActivePoll] = useState<KickPoll | null>(null);
  const [showPoll, setShowPoll] = useState(true);
  const [isPollExpanded, setIsPollExpanded] = useState(false);
  const chatInputRef = useRef<ChatInputHandle>(null);

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

        // System message: Connecting
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

        const kickToken = await window.electronAPI.auth.getToken("kick");

        if (!isMounted) return;

        if (kickToken) {
          // Authenticated
          await kickChatService.connect({
            accessToken: kickToken.accessToken,
            debug: import.meta.env.DEV,
          });

          if (!isMounted) return;
          setIsAuthenticated(true);

          // Initialize Kick Emotes
          initializeKickEmotes(kickToken.accessToken);
          if (isMounted) await loadGlobalEmotes();
        } else {
          // Anonymous
          await kickChatService.connect({
            debug: import.meta.env.DEV,
          });

          if (!isMounted) return;
          setIsAuthenticated(false);
          // Just load global emotes (BTTV/7TV)
          if (isMounted) await loadGlobalEmotes();
        }

        if (!isMounted) return;

        // Identify channel ID for emotes
        // Use chatroomId if available, otherwise channel slug
        const channelId = chatroomId ? chatroomId.toString() : channel;

        if (isMounted && channelId) {
          setActiveChannel(channelId);
          await loadChannelEmotes(channelId, channel, "kick");
        } else if (isMounted) {
          setActiveChannel(null);
        }

        if (!isMounted) return;

        if (channel && chatroomId) {
          await kickChatService.joinChannel(channel, chatroomId);

          // System message: Connected
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

        // Memory cleanup: unload channel emotes to free RAM
        const channelId = currentChannelRef.current.chatroomId
          ? currentChannelRef.current.chatroomId.toString()
          : currentChannelRef.current.channel;
        unloadChannelEmotes(channelId);
        setActiveChannel(null);
      }
      currentChannelRef.current = null;
    };
  }, [
    channel,
    chatroomId,
    clearMessages,
    loadGlobalEmotes,
    loadChannelEmotes,
    setActiveChannel,
    unloadChannelEmotes,
    addMessage,
  ]);

  // Separate effect for updating subscriber badges without triggering reconnection
  // This is intentionally separate from the connection effect to prevent badge updates
  // from causing the chat to disconnect and reconnect
  useEffect(() => {
    if (channel && subscriberBadges && subscriberBadges.length > 0) {
      kickChatService.setChannelBadges(channel, subscriberBadges);
    }
  }, [channel, subscriberBadges]);

  // Event Listeners
  useEffect(() => {
    const handleMessage = (message: ChatMessage) => {
      if (message.platform === "kick") {
        addMessage(message);
      }
    };

    const handleUserNotice = (notice: UserNotice) => {
      if (notice.platform !== "kick") return;
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

    const handlePinnedMessage = (msg: KickPinnedMessage) => {
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
        // Auto-dismiss after result_display_duration or 15s
        setTimeout(() => setActivePoll(null), 15000);
      }
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
    };
  }, [addMessage, updateConnectionStatus, clearMessages, deleteMessage, deleteMessagesByUser]);

  const handleReply = useCallback((message: ChatMessage) => {
    chatInputRef.current?.replyTo(message);
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-[var(--color-background-secondary)]">
      <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <span className="text-white">Chat</span>
        </h2>
        <div className="flex space-x-2">{/* Status indicators */}</div>
      </div>

      {/* Pinned Message Banner */}
      {pinnedMessage && showPinned && (
        <KickPinnedMessageBanner
          pin={pinnedMessage}
          isExpanded={isPinExpanded}
          onToggleExpand={() => setIsPinExpanded((v) => !v)}
          onDismiss={() => setShowPinned(false)}
        />
      )}

      {/* Poll Widget */}
      {activePoll && showPoll && (
        <KickPollWidget
          poll={activePoll}
          isExpanded={isPollExpanded}
          onToggleExpand={() => setIsPollExpanded((v) => !v)}
          onDismiss={() => setShowPoll(false)}
        />
      )}

      <div className="flex-1 min-h-0 relative">
        <ChatMessageList key={`kick-${channel}-${chatroomId}`} onReply={handleReply} />
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
              platform="kick"
              channel={channel}
              chatroomId={chatroomId}
              canSend={isAuthenticated && connectionStatus.kick.state === "connected"}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ========== Sub-components ==========

interface KickPinnedMessageBannerProps {
  pin: KickPinnedMessage;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDismiss: () => void;
}

const KickPinnedMessageBanner: React.FC<KickPinnedMessageBannerProps> = ({
  pin,
  isExpanded,
  onToggleExpand,
  onDismiss,
}) => {
  const sender = pin.message.sender;
  const pinnedBy = pin.pinned_by;

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-background-tertiary,#1a1a1a)] text-sm">
      <div className="flex items-start justify-between px-3 pt-2 pb-1 gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-gray-400 text-xs">Sent by</span>
            <span
              className="font-semibold text-xs"
              style={{ color: sender.identity.color || "#53FC18" }}
            >
              {sender.username}
            </span>
          </div>
          <p
            className={`text-white text-xs mt-0.5 ${isExpanded ? "" : "truncate"}`}
          >
            {pin.message.content}
          </p>
          {isExpanded && pinnedBy && (
            <p className="text-gray-500 text-xs mt-1">
              Pinned by{" "}
              <span style={{ color: pinnedBy.identity.color || "#53FC18" }}>
                {pinnedBy.username}
              </span>
            </p>
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
    </div>
  );
};

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

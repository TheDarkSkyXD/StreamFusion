/**
 * ChatInput Component
 *
 * Full-featured chat input with:
 * - Emote autocomplete (triggered by :)
 * - Mention autocomplete (triggered by @)
 * - Chat commands (/me, /clear, /timeout, /ban, etc.)
 * - Reply functionality with preview banner
 * - EmotePicker integration
 * - Character counter
 * - Platform-aware sending
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { BsEmojiSmile, BsReplyFill, BsSend, BsXLg } from "react-icons/bs";
import { kickChatService } from "../../backend/services/chat/kick-chat";
import { twitchChatService } from "../../backend/services/chat/twitch-chat";
import type { Emote } from "../../backend/services/emotes/emote-types";
import type { ChatMessage, ChatPlatform } from "../../shared/chat-types";
import { useChatStore } from "../../store/chat-store";
import { EmoteAutocomplete, useEmoteAutocomplete } from "./EmoteAutocomplete";
import { EmotePicker } from "./EmotePicker";
import {
  MentionAutocomplete,
  type RecentChatter,
  useMentionAutocomplete,
} from "./MentionAutocomplete";

// ========== Types ==========

export interface ChatInputProps {
  /** Current channel name */
  channel: string;
  /** Platform to send messages on */
  platform: ChatPlatform;
  /** Additional chatroom ID (required for Kick) */
  chatroomId?: number;
  /** Max message length */
  maxLength?: number;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the user is authenticated and can send */
  canSend?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Custom class name */
  className?: string;
}

interface ReplyState {
  messageId: string;
  username: string;
  displayName: string;
  content: string;
}

// ========== Chat Commands ==========

interface ParsedCommand {
  command: string;
  args: string[];
  originalMessage: string;
}

const CHAT_COMMANDS = {
  me: { platforms: ["twitch", "kick"], description: "Send an action message" },
  clear: { platforms: ["twitch", "kick"], description: "Clear chat (mod only)" },
  timeout: { platforms: ["twitch", "kick"], description: "Timeout a user (mod only)" },
  ban: { platforms: ["twitch", "kick"], description: "Ban a user (mod only)" },
  unban: { platforms: ["twitch", "kick"], description: "Unban a user (mod only)" },
  slow: { platforms: ["twitch"], description: "Enable slow mode" },
  slowoff: { platforms: ["twitch"], description: "Disable slow mode" },
  followers: { platforms: ["twitch"], description: "Enable followers-only mode" },
  followersoff: { platforms: ["twitch"], description: "Disable followers-only mode" },
  subscribers: { platforms: ["twitch"], description: "Enable subscribers-only mode" },
  subscribersoff: { platforms: ["twitch"], description: "Disable subscribers-only mode" },
  emoteonly: { platforms: ["twitch"], description: "Enable emote-only mode" },
  emoteonlyoff: { platforms: ["twitch"], description: "Disable emote-only mode" },
} as const;

function parseCommand(message: string): ParsedCommand | null {
  if (!message.startsWith("/")) return null;

  const parts = message.slice(1).split(" ");
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  return {
    command,
    args,
    originalMessage: message,
  };
}

// ========== Component ==========

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(({
  channel,
  platform,
  chatroomId,
  maxLength = 500,
  placeholder = "Send a message...",
  canSend = true,
  disabled = false,
  className = "",
}, ref) => {
  // State
  const [message, setMessage] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [reply, setReply] = useState<ReplyState | null>(null);
  const [isEmotePickerOpen, setIsEmotePickerOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Store
  const { messages } = useChatStore();

  // Autocomplete hooks
  const emoteAutocomplete = useEmoteAutocomplete();
  const mentionAutocomplete = useMentionAutocomplete();

  // Extract recent chatters from messages
  const recentChatters: RecentChatter[] = React.useMemo(() => {
    const chatterMap = new Map<string, RecentChatter>();

    // Go through messages in reverse to get most recent first
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type !== "message" || msg.platform !== platform) continue;

      if (!chatterMap.has(msg.username)) {
        chatterMap.set(msg.username, {
          username: msg.username,
          displayName: msg.displayName,
          color: msg.color,
          lastSeen: msg.timestamp,
        });
      }
    }

    return Array.from(chatterMap.values());
  }, [messages, platform]);

  // Handle input change
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const cursorPos = e.target.selectionStart;

      setMessage(value);
      setCursorPosition(cursorPos);
      setError(null);

      // Check for autocomplete triggers
      emoteAutocomplete.checkTrigger(value, cursorPos, ":");
      mentionAutocomplete.checkTrigger(value, cursorPos);
    },
    [emoteAutocomplete, mentionAutocomplete]
  );

  // Handle cursor position changes
  const handleSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    setCursorPosition(target.selectionStart);
  }, []);

  // Handle emote selection from autocomplete or picker
  const handleEmoteSelect = useCallback(
    (emote: Emote, startPos?: number, endPos?: number) => {
      if (startPos !== undefined && endPos !== undefined) {
        // From autocomplete - replace the trigger and query
        const before = message.slice(0, startPos);
        const after = message.slice(endPos);
        const newMessage = `${before}${emote.name} ${after}`;
        setMessage(newMessage);

        // Move cursor after the emote
        const newCursorPos = startPos + emote.name.length + 1;
        setCursorPosition(newCursorPos);

        // Focus and set cursor after state update
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
          }
        }, 0);
      } else {
        // From picker - insert at cursor position
        const before = message.slice(0, cursorPosition);
        const after = message.slice(cursorPosition);
        const newMessage = `${before}${emote.name} ${after}`;
        setMessage(newMessage);

        const newCursorPos = cursorPosition + emote.name.length + 1;
        setCursorPosition(newCursorPos);

        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
          }
        }, 0);
      }

      emoteAutocomplete.deactivate();
      setIsEmotePickerOpen(false);
    },
    [message, cursorPosition, emoteAutocomplete]
  );

  // Handle mention selection
  const handleMentionSelect = useCallback(
    (username: string, startPos: number, endPos: number) => {
      const before = message.slice(0, startPos);
      const after = message.slice(endPos);
      const newMessage = `${before}@${username} ${after}`;
      setMessage(newMessage);

      const newCursorPos = startPos + username.length + 2; // +2 for @ and space
      setCursorPosition(newCursorPos);

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);

      mentionAutocomplete.deactivate();
    },
    [message, mentionAutocomplete]
  );

  // Handle reply
  const handleReply = useCallback((msg: ChatMessage) => {
    setReply({
      messageId: msg.id,
      username: msg.username,
      displayName: msg.displayName,
      content: msg.rawContent.length > 50 ? `${msg.rawContent.slice(0, 50)}...` : msg.rawContent,
    });

    // Focus input
    inputRef.current?.focus();
  }, []);

  useImperativeHandle(ref, () => ({ replyTo: handleReply }), [handleReply]);

  const clearReply = useCallback(() => {
    setReply(null);
  }, []);

  // Handle send
  const handleSend = useCallback(async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || !canSend || isSending) return;

    setIsSending(true);
    setError(null);

    try {
      // Check for commands
      const parsedCommand = parseCommand(trimmedMessage);

      if (parsedCommand) {
        const { command, args } = parsedCommand;
        const cmdConfig = CHAT_COMMANDS[command as keyof typeof CHAT_COMMANDS];

        if (!cmdConfig || !(cmdConfig.platforms as readonly string[]).includes(platform)) {
          // Unknown command or not supported on this platform
          // Try to send as regular message anyway? Or show error?
          setError(`Unknown command: /${command}`);
          setIsSending(false);
          return;
        }

        // Handle /me command specially
        if (command === "me") {
          const actionMessage = args.join(" ");
          if (platform === "twitch") {
            await twitchChatService.sendAction(channel, actionMessage);
          } else {
            // Kick doesn't have native /me, send as regular message with emphasis
            await kickChatService.sendMessage(channel, `*${actionMessage}*`);
          }
        } else {
          // Other commands would need API calls to moderation endpoints
          // For now, just send as raw message and let the server handle it
          if (platform === "twitch") {
            await twitchChatService.sendMessage(channel, trimmedMessage);
          } else {
            await kickChatService.sendMessage(channel, trimmedMessage);
          }
        }
      } else {
        // Regular message
        if (reply) {
          // Send as reply
          if (platform === "twitch") {
            await twitchChatService.sendReply(channel, reply.messageId, trimmedMessage);
          } else {
            // Kick doesn't have native reply support, mention the user instead
            await kickChatService.sendMessage(channel, `@${reply.username} ${trimmedMessage}`);
          }
        } else {
          // Normal message
          if (platform === "twitch") {
            await twitchChatService.sendMessage(channel, trimmedMessage);
          } else {
            await kickChatService.sendMessage(channel, trimmedMessage);
          }
        }
      }

      // Clear on success
      setMessage("");
      setReply(null);
      inputRef.current?.focus();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to send message";
      setError(errorMessage);
      console.error("Failed to send message:", err);
    } finally {
      setIsSending(false);
    }
  }, [message, canSend, isSending, platform, channel, reply]);

  // Handle key press
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // If autocomplete is active, let it handle the keys
      if (emoteAutocomplete.isActive || mentionAutocomplete.isActive) {
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }

      if (e.key === "Escape") {
        if (reply) {
          clearReply();
        }
      }
    },
    [emoteAutocomplete.isActive, mentionAutocomplete.isActive, handleSend, reply, clearReply]
  );

  // Close autocompletes when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        emoteAutocomplete.deactivate();
        mentionAutocomplete.deactivate();
        setIsEmotePickerOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [emoteAutocomplete, mentionAutocomplete]);

  // Expose reply handler to parent (via context or callback in real implementation)
  // For now, we'll use the ChatPanel to coordinate

  const isOverLimit = message.length > maxLength;
  const charactersRemaining = maxLength - message.length;

  return (
    <div ref={containerRef} className={`relative flex flex-col ${className}`}>
      {/* Reply Preview */}
      {reply && (
        <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border-b border-[var(--color-border)] rounded-t-md">
          <BsReplyFill className="text-gray-400 flex-shrink-0" size={14} />
          <div className="flex-1 min-w-0">
            <span className="text-xs text-gray-400">Replying to </span>
            <span className="text-xs font-medium text-white">{reply.displayName}</span>
            <p className="text-xs text-gray-500 truncate">{reply.content}</p>
          </div>
          <button
            onClick={clearReply}
            className="flex-shrink-0 p-1 hover:bg-white/10 rounded transition-colors"
            aria-label="Cancel reply"
          >
            <BsXLg className="text-gray-400" size={12} />
          </button>
        </div>
      )}

      {/* Main Input Area */}
      <div
        className={`relative flex items-end gap-2 ${reply ? "rounded-b-md" : "rounded-md"} border border-[var(--color-border)] bg-[var(--color-background-tertiary)] px-3 py-2`}
      >
        {/* Emote Picker Button */}
        <button
          type="button"
          onClick={() => setIsEmotePickerOpen(!isEmotePickerOpen)}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex-shrink-0 p-1.5 hover:bg-white/10 rounded transition-colors text-gray-400 hover:text-white"
          aria-label="Open emote picker"
          disabled={disabled}
        >
          <BsEmojiSmile size={18} />
        </button>

        {/* Text Input */}
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={message}
            onChange={handleInputChange}
            onSelect={handleSelect}
            onKeyDown={handleKeyDown}
            placeholder={canSend ? placeholder : "Log in to chat"}
            disabled={disabled || !canSend}
            rows={1}
            className="w-full resize-none bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              minHeight: "24px",
              maxHeight: "120px",
            }}
          />

          {/* Emote Autocomplete */}
          <EmoteAutocomplete
            inputValue={message}
            cursorPosition={cursorPosition}
            onSelect={(emote, start, end) => handleEmoteSelect(emote, start, end)}
            onClose={emoteAutocomplete.deactivate}
            isActive={emoteAutocomplete.isActive}
          />

          {/* Mention Autocomplete */}
          <MentionAutocomplete
            inputValue={message}
            cursorPosition={cursorPosition}
            onSelect={handleMentionSelect}
            onClose={mentionAutocomplete.deactivate}
            isActive={mentionAutocomplete.isActive}
            recentChatters={recentChatters}
          />
        </div>

        {/* Character Counter */}
        {message.length > 0 && (
          <span
            className={`flex-shrink-0 text-xs ${
              isOverLimit
                ? "text-red-500"
                : charactersRemaining <= 50
                  ? "text-yellow-500"
                  : "text-gray-500"
            }`}
          >
            {charactersRemaining}
          </span>
        )}

        {/* Send Button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !canSend || !message.trim() || isOverLimit || isSending}
          className="flex-shrink-0 p-1.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
          aria-label="Send message"
        >
          <BsSend size={16} className="text-white" />
        </button>
      </div>

      {/* Emote Picker */}
      <EmotePicker
        isOpen={isEmotePickerOpen}
        onClose={() => setIsEmotePickerOpen(false)}
        onSelect={(emote) => handleEmoteSelect(emote)}
        position="top"
        platform={platform}
      />

      {/* Error Message */}
      {error && <div className="absolute -bottom-6 left-0 text-xs text-red-500">{error}</div>}
    </div>
  );
});

ChatInput.displayName = "ChatInput";

// Export a method type for external reply triggering
export type ChatInputHandle = {
  replyTo: (message: ChatMessage) => void;
};

export default ChatInput;

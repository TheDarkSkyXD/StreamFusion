/**
 * ChatInput Component
 *
 * Full-featured chat input with:
 * - Emote autocomplete (triggered by `:`)
 * - Mention autocomplete (triggered by `@`)
 * - Chat commands (`/me`, `/clear`, `/timeout`, `/ban`, etc.)
 * - Reply functionality with preview banner
 * - InfoBanner row showing active chat-room modes (U7)
 * - Two anchored emote dialogs (native + third-party, U8) with parent-local
 *   mutual exclusion
 * - Character counter and error display
 * - Platform-aware sending; **no send button** — Enter sends.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { BsReplyFill, BsXLg } from "react-icons/bs";
import { kickChatService } from "../../backend/services/chat/kick-chat";
import { twitchChatService } from "../../backend/services/chat/twitch-chat";
import type { Emote } from "../../backend/services/emotes/emote-types";
import type { ChatMessage, ChatPlatform } from "../../shared/chat-types";
import { EmoteAutocomplete, useEmoteAutocomplete } from "./EmoteAutocomplete";
import { InfoBanner } from "./InfoBanner";
import { NativeEmoteButton } from "./input/NativeEmoteButton";
import { ThirdPartyEmoteButton } from "./input/ThirdPartyEmoteButton";
import { MentionAutocomplete, useMentionAutocomplete } from "./MentionAutocomplete";

// ========== Types ==========

export interface ChatInputProps {
  /** Current channel name */
  channel: string;
  /** Platform to send messages on */
  platform: ChatPlatform;
  /** Additional chatroom ID (required for Kick) */
  chatroomId?: number;
  /** Stable channel identifier for room-state lookups (broadcaster ID on
   *  Twitch, chatroom/channel ID on Kick). Required as of U9: InfoBanner and
   *  both EmoteDialogs key per-channel state off this. */
  channelId: string;
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

type ActiveDialog = "native" | "thirdParty" | null;

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(({
  channel,
  platform,
  chatroomId: _chatroomId,
  channelId,
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
  // Single dialog-tracking state; opening one closes the other. Parent-local
  // concern, so no event bus or shared store.
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Autocomplete hooks
  const emoteAutocomplete = useEmoteAutocomplete();
  const mentionAutocomplete = useMentionAutocomplete();

  // Handle input change
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const cursorPos = e.target.selectionStart;

      setMessage(value);
      setCursorPosition(cursorPos);
      setError(null);

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

  // Handle emote selection from autocomplete or dialog. The autocomplete
  // path passes (startPos, endPos) so we replace the trigger + query span;
  // the dialog path omits them and we insert at the current cursor.
  const handleEmoteSelect = useCallback(
    (emote: Emote, startPos?: number, endPos?: number) => {
      if (startPos !== undefined && endPos !== undefined) {
        const before = message.slice(0, startPos);
        const after = message.slice(endPos);
        const newMessage = `${before}${emote.name} ${after}`;
        setMessage(newMessage);

        const newCursorPos = startPos + emote.name.length + 1;
        setCursorPosition(newCursorPos);

        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
          }
        }, 0);
      } else {
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
      setActiveDialog(null);
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

      const newCursorPos = startPos + username.length + 2;
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

    inputRef.current?.focus();
  }, []);

  const mentionUser = useCallback((username: string) => {
    setMessage((prev) => {
      const mention = `@${username} `;
      return prev.startsWith(mention) ? prev : `${mention}${prev}`;
    });
    setTimeout(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const pos = el.value.length;
        el.setSelectionRange(pos, pos);
      }
    }, 0);
  }, []);

  useImperativeHandle(
    ref,
    () => ({ replyTo: handleReply, mentionUser }),
    [handleReply, mentionUser],
  );

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
      const parsedCommand = parseCommand(trimmedMessage);

      if (parsedCommand) {
        const { command, args } = parsedCommand;
        const cmdConfig = CHAT_COMMANDS[command as keyof typeof CHAT_COMMANDS];

        if (!cmdConfig || !(cmdConfig.platforms as readonly string[]).includes(platform)) {
          setError(`Unknown command: /${command}`);
          setIsSending(false);
          return;
        }

        if (command === "me") {
          const actionMessage = args.join(" ");
          if (platform === "twitch") {
            await twitchChatService.sendAction(channel, actionMessage);
          } else {
            await kickChatService.sendMessage(channel, `*${actionMessage}*`);
          }
        } else {
          if (platform === "twitch") {
            await twitchChatService.sendMessage(channel, trimmedMessage);
          } else {
            await kickChatService.sendMessage(channel, trimmedMessage);
          }
        }
      } else {
        if (reply) {
          if (platform === "twitch") {
            await twitchChatService.sendReply(channel, reply.messageId, trimmedMessage);
          } else {
            await kickChatService.sendMessage(channel, `@${reply.username} ${trimmedMessage}`);
          }
        } else {
          if (platform === "twitch") {
            await twitchChatService.sendMessage(channel, trimmedMessage);
          } else {
            await kickChatService.sendMessage(channel, trimmedMessage);
          }
        }
      }

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

  // Handle key press — Enter sends; Shift+Enter inserts newline (default
  // textarea behavior, just don't preventDefault).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  // Outside-click only closes autocompletes here. EmoteDialog owns its own
  // outside-click (it portals out of `containerRef`, so this handler would
  // close it on every dialog interaction otherwise).
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        emoteAutocomplete.deactivate();
        mentionAutocomplete.deactivate();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [emoteAutocomplete, mentionAutocomplete]);

  const handleNativeOpenRequest = useCallback(() => {
    setActiveDialog((cur) => (cur === "native" ? null : "native"));
  }, []);

  const handleThirdPartyOpenRequest = useCallback(() => {
    setActiveDialog((cur) => (cur === "thirdParty" ? null : "thirdParty"));
  }, []);

  // viewerIsSubscribed for the Kick-native dialog: the viewer's own
  // subscriber badge isn't surfaced through any chat-state path reachable
  // from here today (KickChat threads `subscriberBadges` for *rendering*
  // other users' badges, not the viewer's own status). Per U8/U9 design,
  // `undefined` means "unknown" and disables the lock overlay — Kick will
  // server-side reject any subscriber-only emote the viewer can't use, so
  // there's no regression relative to today. Plumbing a viewer-subscription
  // signal is deferred as a follow-up.
  const viewerIsSubscribed: boolean | undefined = undefined;

  const isOverLimit = message.length > maxLength;
  const charactersRemaining = maxLength - message.length;

  const buttonsDisabled = disabled || !canSend;

  return (
    <div ref={containerRef} className={`relative flex flex-col ${className}`}>
      {/* Reply Preview — stays at the top, above InfoBanner */}
      {reply && (
        <div
          data-testid="reply-preview"
          className="flex items-center gap-2 px-3 py-2 bg-white/5 border-b border-[var(--color-border)] rounded-t-md"
        >
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

      {/* InfoBanner — renders null when no chat-room modes are active. */}
      <InfoBanner platform={platform} channelId={channelId} />

      {/* Main Input Area */}
      <div
        className={`relative flex items-end gap-2 ${reply ? "rounded-b-md" : "rounded-md"} border border-[var(--color-border)] bg-[var(--color-background-tertiary)] px-3 py-2`}
      >
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

          <EmoteAutocomplete
            inputValue={message}
            cursorPosition={cursorPosition}
            onSelect={(emote, start, end) => handleEmoteSelect(emote, start, end)}
            onClose={emoteAutocomplete.deactivate}
            isActive={emoteAutocomplete.isActive}
          />

          <MentionAutocomplete
            inputValue={message}
            cursorPosition={cursorPosition}
            onSelect={handleMentionSelect}
            onClose={mentionAutocomplete.deactivate}
            isActive={mentionAutocomplete.isActive}
            platform={platform}
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

        {/* Emote buttons (native + third-party). Send button is intentionally
            gone — Enter sends. */}
        <NativeEmoteButton
          platform={platform}
          channelId={channelId}
          isOpen={activeDialog === "native"}
          onOpenRequest={handleNativeOpenRequest}
          onEmoteSelect={handleEmoteSelect}
          disabled={buttonsDisabled}
          viewerIsSubscribed={viewerIsSubscribed}
        />
        <ThirdPartyEmoteButton
          platform={platform}
          channelId={channelId}
          isOpen={activeDialog === "thirdParty"}
          onOpenRequest={handleThirdPartyOpenRequest}
          onEmoteSelect={handleEmoteSelect}
          disabled={buttonsDisabled}
        />
      </div>

      {/* Error Message */}
      {error && <div className="absolute -bottom-6 left-0 text-xs text-red-500">{error}</div>}
    </div>
  );
});

ChatInput.displayName = "ChatInput";

// Export a method type for external reply / mention triggering
export type ChatInputHandle = {
  replyTo: (message: ChatMessage) => void;
  /** Prepend "@username " into the input and focus it. Used by the
   *  pinned-message Reply action where IRC reply-to threading isn't needed. */
  mentionUser: (username: string) => void;
};

export default ChatInput;

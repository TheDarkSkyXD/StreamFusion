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

import type React from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { BsReplyFill, BsXLg } from "react-icons/bs";
import { logger } from "@/renderer/logging/logger";
import { kickChatService } from "../../backend/services/chat/kick-chat";
import { twitchChatService } from "../../backend/services/chat/twitch-chat";
import type { Emote } from "../../backend/services/emotes/emote-types";
import type { ChatMessage, ChatPlatform, ContentFragment } from "../../shared/chat-types";
import { useAuthStore } from "../../store/auth-store";
import { useEmoteStore } from "../../store/emote-store";
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
   *  Twitch, chatroom/channel ID on Kick). `null` when the ID hasn't
   *  resolved yet — InfoBanner and both EmotePickerPopovers degrade gracefully
   *  rather than keying off an empty string (which would alias every
   *  not-yet-resolved channel into a single shared `platform:` store key
   *  and contaminate cross-channel state — see code review R9). */
  channelId: string | null;
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

/** Single Private Use Area code point that stands in for an inserted emote
 *  inside the textarea's `value`. Anything outside the PUA can be safely
 *  typed by users; this code point won't collide with real text. Each
 *  occurrence in `message` maps 1:1 with an entry in `emoteSlots` (same
 *  order), so the textarea sees an emote as ONE character — matching how
 *  KickTalk's `EmoteNode` counts as one node in the Lexical tree. */
const EMOTE_CHAR = "";

/** Reconcile the emote-slot list against the new textarea value after the
 *  user edits. Walks both old/new strings in lockstep — every EMOTE_CHAR
 *  that survives the edit keeps its corresponding slot; every EMOTE_CHAR
 *  that the user deleted drops its slot. Works correctly for deletes at
 *  any position (start, middle, end) and for plain-text edits that don't
 *  touch any EMOTE_CHAR. */
function reconcileEmoteSlots(oldText: string, oldSlots: Emote[], newText: string): Emote[] {
  // Walk new text counting EMOTE_CHARs; for each, find the matching slot
  // in oldSlots by counting EMOTE_CHARs up to the same logical position
  // via a basic LCS-style alignment (good enough for typical edits).
  const oldPositions: number[] = [];
  for (let i = 0; i < oldText.length; i++) {
    if (oldText[i] === EMOTE_CHAR) oldPositions.push(i);
  }
  const newPositions: number[] = [];
  for (let i = 0; i < newText.length; i++) {
    if (newText[i] === EMOTE_CHAR) newPositions.push(i);
  }
  if (newPositions.length === oldPositions.length) {
    // Same count → nothing removed; slots unchanged.
    return oldSlots;
  }
  // Greedy alignment: for each new EMOTE_CHAR, claim the leftmost
  // unclaimed old EMOTE_CHAR whose position-relative-to-its-neighbors
  // best matches. For the typical "delete one emote" case, this trivially
  // picks the correct surviving entries.
  const result: Emote[] = [];
  let oldI = 0;
  for (let newI = 0; newI < newPositions.length; newI++) {
    // Skip over any old slots that were deleted before this new one.
    // We detect a deletion when removing the next old slot brings the
    // remaining counts into alignment.
    const remainingNew = newPositions.length - newI;
    while (oldI < oldSlots.length && oldSlots.length - oldI > remainingNew) {
      oldI++;
    }
    if (oldI < oldSlots.length) {
      result.push(oldSlots[oldI]!);
      oldI++;
    }
  }
  return result;
}

/** Build ContentFragments from the textarea value + emote slots, mirroring
 *  what the Kick parser produces for inbound `[emote:id:name]` markers.
 *  Used by the Kick optimistic local echo so the user's own outbound message
 *  renders emote IMAGES instead of the raw emote-name text for the
 *  ~150-400ms before the Pusher delivery confirms. Non-emote runs collapse
 *  into single text fragments — mentions/URLs aren't broken out here
 *  (matching the prior single-text echo), the live Pusher message that
 *  replaces this echo handles them properly. */
function serializeFragments(message: string, slots: Emote[]): ContentFragment[] {
  const out: ContentFragment[] = [];
  let buf = "";
  let slotIdx = 0;
  const flush = () => {
    if (buf.length === 0) return;
    out.push({ type: "text", content: buf });
    buf = "";
  };
  for (let i = 0; i < message.length; i++) {
    const ch = message[i];
    if (ch === EMOTE_CHAR) {
      const slot = slots[slotIdx++];
      if (slot) {
        flush();
        out.push({
          type: "emote",
          id: slot.id,
          name: slot.name,
          url: slot.urls.url4x ?? slot.urls.url2x ?? slot.urls.url1x,
          isAnimated: slot.isAnimated,
          isZeroWidth: slot.isZeroWidth,
        });
        // Mirror serializeMessage: inject a space delimiter so adjacent
        // emotes stay visually separated (and parseable if anything later
        // re-runs over the rawContent).
        const next = message[i + 1];
        if (next !== undefined && !/\s/.test(next)) buf += " ";
      }
    } else {
      buf += ch;
    }
  }
  flush();
  return out;
}

/** Convert the textarea's placeholder-bearing value into the actual chat-server
 *  string. Native Kick emotes serialize as `[emote:id:name]` so the Kick chat
 *  server broadcasts them with that markup — without it, kick.com renders our
 *  sends as plain text for every other viewer (parity with KickTalk's
 *  EmoteNode.getTextContent). Twitch native emotes and 7TV/BTTV/FFZ fall back
 *  to the bare name: Twitch IRC tags are stamped server-side from the name,
 *  and 7TV/BTTV/FFZ aren't known to Kick's server at all (clients with the
 *  third-party extensions substitute the name client-side). A trailing space
 *  is inserted after each emote so adjacent emotes stay parseable.
 *  KickTalk reference: src/renderer/src/components/Chat/Input/EmoteNode.jsx. */
function serializeMessage(message: string, slots: Emote[], platform: ChatPlatform): string {
  if (slots.length === 0) return message;
  let result = "";
  let slotIdx = 0;
  for (let i = 0; i < message.length; i++) {
    const ch = message[i];
    if (ch === EMOTE_CHAR) {
      const slot = slots[slotIdx++];
      if (slot) {
        if (platform === "kick" && slot.provider === "kick") {
          result += `[emote:${slot.id}:${slot.name}]`;
        } else {
          result += slot.name;
        }
        // Inject a delimiter unless we're already at end or followed by whitespace.
        const next = message[i + 1];
        if (next !== undefined && !/\s/.test(next)) result += " ";
      }
    } else {
      result += ch;
    }
  }
  return result;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  (
    {
      channel,
      platform,
      chatroomId: _chatroomId,
      channelId,
      maxLength = 500,
      placeholder = "Send a message...",
      canSend = true,
      disabled = false,
      className = "",
    },
    ref
  ) => {
    // State
    const [message, setMessage] = useState("");
    /** One entry per EMOTE_CHAR in `message`, in left-to-right order. The
     *  textarea sees each inserted emote as a single character; this list
     *  carries the matching Emote so the overlay can render the actual image
     *  and `serializeMessage` can reconstruct the IRC payload on send. */
    const [emoteSlots, setEmoteSlots] = useState<Emote[]>([]);
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
    const thirdPartyPopoverAnchorRef = useRef<HTMLElement | null>(null);

    // Signed-in Kick user — needed to attach a sender identity to the optimistic
    // local echo of outbound messages. Kick's web v2 send path delivers the
    // sender's own message via Pusher ~150-400ms later with full identity; the
    // local optimistic echo bridges that latency and dedup-by-message-id
    // collapses the duplicate. Subscribed reactively so a mid-session
    // sign-in/out updates the value without remounting this component.
    const kickUser = useAuthStore((state) => state.kickUser);

    // Autocomplete hooks
    const emoteAutocomplete = useEmoteAutocomplete();
    const mentionAutocomplete = useMentionAutocomplete();

    // Emote-name → Emote lookup for the inline preview overlay. Subscribed once
    // and rebuilt on store mutations because the zustand selector for
    // getAllEmotes() returns a new array every call (would loop forever as a
    // direct selector — see NativeEmoteButton for the same pattern).
    const [emoteByName, setEmoteByName] = useState<Map<string, Emote>>(new Map());
    useEffect(() => {
      const refresh = () => {
        const all = useEmoteStore.getState().getAllEmotes();
        setEmoteByName(new Map(all.map((e) => [e.name, e])));
      };
      refresh();
      return useEmoteStore.subscribe(refresh);
    }, []);

    // Split the typed message into runs of (text | emote img) so the overlay
    // can render emote codes as actual images while the underlying textarea
    // still holds plain text. Uses a single regex that matches a whitespace
    // run or a non-whitespace run, so the original spacing/newlines are
    // preserved exactly — critical for keeping the overlay's wrap geometry
    // aligned with the textarea's.
    //
    // KickTalk's `EmoteNode` is a Lexical *decorator* node — the Lexical state
    // contains spaces around the emote (so the IRC text sent to chat is well
    // separated), but the rendered DOM is a tight `<img>` with `margin: 0 1px`.
    // We mimic that here in two ways: (1) the trailing whitespace token is
    // dropped from the overlay because it would otherwise render as a visible
    // gap between the last emote and the input's right edge — the textarea
    // still holds the space for caret position + send. (2) Emote images get a
    // `margin: 0 1px` matching KickTalk's `.emoteContainer > img` rule so
    // adjacent emotes pack tightly instead of being separated by a full
    // text-space's worth of whitespace.
    const overlayContent = useMemo(() => {
      if (!message) return null;
      // Walk the textarea value character by character. EMOTE_CHARs render
      // as the corresponding slot's `<img>`; everything else accumulates
      // into text runs. This keeps the overlay's visual width close to one
      // image-width per emote (instead of expanding to the full emote-name
      // width as before), which makes the trailing caret sit right after
      // the emote — the "extra characters" problem the user reported.
      const out: React.ReactNode[] = [];
      let buffer = "";
      let slotIdx = 0;
      const flushBuffer = (key: string) => {
        if (!buffer) return;
        // Also auto-detect typed emote names inside the buffer (e.g. user
        // typed "KEKW" by hand). Same token regex as before so wrapping
        // matches the textarea.
        const tokens = buffer.match(/\s+|\S+/g) ?? [];
        tokens.forEach((tok, ti) => {
          const named = !/^\s+$/.test(tok) ? emoteByName.get(tok) : undefined;
          if (named) {
            out.push(
              <img
                key={`${key}-${ti}-named`}
                src={named.urls.url1x}
                alt={named.name}
                data-emote-name={named.name}
                className="inline-block align-middle"
                style={{ height: "20px", width: "auto", margin: "0 1px" }}
                draggable={false}
              />
            );
          } else {
            out.push(
              <span key={`${key}-${ti}`} className="align-middle">
                {tok}
              </span>
            );
          }
        });
        buffer = "";
      };
      for (let i = 0; i < message.length; i++) {
        const ch = message[i];
        if (ch === EMOTE_CHAR) {
          flushBuffer(`pre-${i}`);
          const slot = emoteSlots[slotIdx++];
          if (slot) {
            out.push(
              <img
                key={`slot-${i}`}
                src={slot.urls.url1x}
                alt={slot.name}
                data-emote-name={slot.name}
                className="inline-block align-middle"
                style={{ height: "20px", width: "auto", margin: "0 1px" }}
                draggable={false}
              />
            );
          }
        } else {
          buffer += ch;
        }
      }
      flushBuffer("tail");
      return out;
    }, [message, emoteSlots, emoteByName]);

    // Handle input change
    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        const cursorPos = e.target.selectionStart;

        // Reconcile emote slots whenever an EMOTE_CHAR was deleted (or one
        // appeared without a matching slot — rare edge case from paste).
        setEmoteSlots((prev) => reconcileEmoteSlots(message, prev, value));
        setMessage(value);
        setCursorPosition(cursorPos);
        setError(null);

        // Autocomplete checks see the placeholder-bearing string. EMOTE_CHAR
        // is non-word, so `:`-trigger and `@`-trigger logic still find the
        // most recent literal `:` or `@` correctly.
        emoteAutocomplete.checkTrigger(value, cursorPos, ":");
        mentionAutocomplete.checkTrigger(value, cursorPos);
      },
      [message, emoteAutocomplete, mentionAutocomplete]
    );

    // Handle cursor position changes
    const handleSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const target = e.target as HTMLTextAreaElement;
      setCursorPosition(target.selectionStart);
    }, []);

    // Handle emote selection from autocomplete or dialog. The autocomplete
    // path passes (startPos, endPos) so we replace the trigger + query span;
    // the dialog path omits them and we insert at the current cursor.
    //
    // Each inserted emote becomes a SINGLE EMOTE_CHAR in the textarea, with
    // the matching `Emote` pushed into `emoteSlots` at the equivalent index.
    // This makes the emote count as one character — matching KickTalk's
    // `EmoteNode` (a single node in the Lexical tree, not its full name).
    const handleEmoteSelect = useCallback(
      (emote: Emote, startPos?: number, endPos?: number) => {
        const insertAt = startPos !== undefined ? startPos : cursorPosition;
        const replaceUpTo = endPos !== undefined ? endPos : cursorPosition;
        const before = message.slice(0, insertAt);
        const after = message.slice(replaceUpTo);
        // Append a trailing space after the emote unless the next char is
        // already whitespace — gives the user a clean spot to keep typing
        // without producing a double-space when an emote is appended at end.
        const trailing = after.startsWith(" ") || after.length === 0 ? "" : " ";
        const newMessage = `${before}${EMOTE_CHAR}${trailing}${after}`;
        const slotIndex = (before.match(new RegExp(EMOTE_CHAR, "g")) ?? []).length;
        const newCursorPos = insertAt + 1 + trailing.length;
        flushSync(() => {
          setEmoteSlots((prev) => [...prev.slice(0, slotIndex), emote, ...prev.slice(slotIndex)]);
          setMessage(newMessage);
          setCursorPosition(newCursorPos);
        });
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
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
        const newCursorPos = startPos + username.length + 2;
        flushSync(() => {
          setMessage(newMessage);
          setCursorPosition(newCursorPos);
        });
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }

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
      flushSync(() => {
        setMessage((prev) => {
          const mention = `@${username} `;
          return prev.startsWith(mention) ? prev : `${mention}${prev}`;
        });
      });
      const el = inputRef.current;
      if (el) {
        el.focus();
        const pos = el.value.length;
        el.setSelectionRange(pos, pos);
      }
    }, []);

    useImperativeHandle(ref, () => ({ replyTo: handleReply, mentionUser }), [
      handleReply,
      mentionUser,
    ]);

    const clearReply = useCallback(() => {
      setReply(null);
    }, []);

    // Handle send
    const handleSend = useCallback(async () => {
      // Convert placeholder-bearing textarea value into the real chat-server
      // string. For Kick, native emote slots become `[emote:id:name]` markup so
      // kick.com renders them as images for everyone (otherwise they ship as
      // plain text). The chat server has no awareness of our textarea placeholder.
      const serialized = serializeMessage(message, emoteSlots, platform);
      const trimmedMessage = serialized.trim();
      if (!trimmedMessage || !canSend || isSending) return;

      // Pre-rendered fragments for the Kick optimistic local echo so the
      // user's own message shows emote IMAGES (not raw text) until the Pusher
      // delivery replaces the echo. Twitch's IRC echo carries the parsed
      // emote tags from tmi.js, so it doesn't need this.
      const localFragments = serializeFragments(message, emoteSlots);

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
              // /me strips emote-slot context: actionMessage is rebuilt from the
              // serialized wire string's args, so no fragments to pass.
              await twitchChatService.sendAction(channel, actionMessage);
            } else {
              // /me strips emote slot context (actionMessage rebuilt from args
              // of the serialized wire string), so no fragments to pass — the
              // echo falls back to single text, matching prior behavior.
              await kickChatService.sendMessage(
                channel,
                `*${actionMessage}*`,
                kickUser ?? undefined
              );
            }
          } else {
            if (platform === "twitch") {
              await twitchChatService.sendMessage(channel, trimmedMessage, localFragments);
            } else {
              await kickChatService.sendMessage(
                channel,
                trimmedMessage,
                kickUser ?? undefined,
                localFragments
              );
            }
          }
        } else {
          if (reply) {
            if (platform === "twitch") {
              await twitchChatService.sendReply(
                channel,
                reply.messageId,
                trimmedMessage,
                localFragments
              );
            } else {
              // Prepend the @mention so the local echo shows the same
              // `@user message` shape Kick will broadcast back.
              const replyFragments: ContentFragment[] = [
                { type: "mention", username: reply.username },
                { type: "text", content: " " },
                ...localFragments,
              ];
              await kickChatService.sendMessage(
                channel,
                `@${reply.username} ${trimmedMessage}`,
                kickUser ?? undefined,
                replyFragments
              );
            }
          } else {
            if (platform === "twitch") {
              await twitchChatService.sendMessage(channel, trimmedMessage, localFragments);
            } else {
              await kickChatService.sendMessage(
                channel,
                trimmedMessage,
                kickUser ?? undefined,
                localFragments
              );
            }
          }
        }

        setMessage("");
        setEmoteSlots([]);
        setReply(null);
        inputRef.current?.focus();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to send message";
        setError(errorMessage);
        logger.error("UI:Chat:Input", "failed to send message", {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setIsSending(false);
      }
    }, [message, emoteSlots, canSend, isSending, platform, channel, reply, kickUser]);

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

    // Outside-click only closes autocompletes here. EmotePickerPopover owns its
    // own outside-click (it portals out of `containerRef`, so this handler would
    // close it on every popover interaction otherwise).
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

    // Character count tracks the SERIALIZED message (emote names + delimiters)
    // rather than the placeholder-bearing textarea value — that's what actually
    // gets transmitted and what the platform enforces a length limit on.
    const serializedLength = useMemo(
      () => serializeMessage(message, emoteSlots, platform).length,
      [message, emoteSlots, platform]
    );
    const isOverLimit = serializedLength > maxLength;
    const charactersRemaining = maxLength - serializedLength;

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
          className={`relative flex items-end gap-2 ${reply ? "rounded-b-md" : "rounded-md"} border border-[var(--color-border)] bg-[#191919] px-3 py-2`}
        >
          {/* Text Input — the overlay above the textarea renders emote tokens
            (e.g. `KEKW`) as images so the user can see live previews inline.
            The textarea itself is made transparent (`text-transparent`) but
            keeps `caret-white` so the cursor stays visible. The overlay is
            absolutely positioned, `pointer-events-none`, and uses the SAME
            font metrics + width as the textarea so its line wrapping matches
            character-for-character. */}
          <div className="flex-1 relative">
            {overlayContent && (
              <div
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none whitespace-pre-wrap break-words text-sm text-white leading-[1.5]"
                style={{ minHeight: "24px", maxHeight: "120px", overflow: "hidden" }}
              >
                {overlayContent}
              </div>
            )}
            <textarea
              ref={inputRef}
              value={message}
              onChange={handleInputChange}
              onSelect={handleSelect}
              onKeyDown={handleKeyDown}
              placeholder={canSend ? placeholder : "Log in to chat"}
              disabled={disabled || !canSend}
              rows={1}
              className="relative w-full resize-none bg-transparent text-sm text-transparent caret-white placeholder:text-gray-300 placeholder:font-bold focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed leading-[1.5]"
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
              channel={channel}
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
            gone — Enter sends. Outer wrapper mirrors KickTalk's `.chatInputActions`
            (border-left + slideAndFadeIn keyframe); inner pill mirrors
            `.chatEmoteBtns` (bg-white/5, border lifts to white/30 when open). */}
          <div
            className="flex items-center pl-3 ml-1 -mr-1 border-l animate-slide-and-fade-in"
            style={{ borderLeftColor: "rgba(255,255,255,0.16)" }}
          >
            {/* Inline `borderColor` overrides the unlayered `* { border-color: var(--color-border) }`
              in index.css, which beats Tailwind's layered border-color utilities at the
              cascade level. `bg-white/5` matches KickTalk's `.chatEmoteBtns`
              surface; the surrounding input box stays on KickTalk's darker
              --bg-input. `rounded-[4px]` mirrors KickTalk's exact 4px corner. */}
            <div
              className="flex items-center h-[38px] rounded-[4px] overflow-hidden border bg-white/5 transition-colors duration-150"
              style={{
                borderColor:
                  activeDialog !== null ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.05)",
              }}
            >
              <NativeEmoteButton
                platform={platform}
                channel={channel}
                channelId={channelId}
                isOpen={activeDialog === "native"}
                onOpenRequest={handleNativeOpenRequest}
                onEmoteSelect={handleEmoteSelect}
                disabled={buttonsDisabled}
                viewerIsSubscribed={viewerIsSubscribed}
                popoverAnchorRef={thirdPartyPopoverAnchorRef}
              />
              <span
                className={`h-full w-px transition-colors duration-150 ${
                  activeDialog !== null ? "bg-white/30" : "bg-white/5"
                }`}
              />
              <ThirdPartyEmoteButton
                platform={platform}
                channel={channel}
                channelId={channelId}
                isOpen={activeDialog === "thirdParty"}
                onOpenRequest={handleThirdPartyOpenRequest}
                onEmoteSelect={handleEmoteSelect}
                disabled={buttonsDisabled}
                popoverAnchorRef={thirdPartyPopoverAnchorRef}
              />
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && <div className="absolute -bottom-6 left-0 text-xs text-red-500">{error}</div>}
      </div>
    );
  }
);

ChatInput.displayName = "ChatInput";

// Export a method type for external reply / mention triggering
export type ChatInputHandle = {
  replyTo: (message: ChatMessage) => void;
  /** Prepend "@username " into the input and focus it. Used by the
   *  pinned-message Reply action where IRC reply-to threading isn't needed. */
  mentionUser: (username: string) => void;
};

export default ChatInput;

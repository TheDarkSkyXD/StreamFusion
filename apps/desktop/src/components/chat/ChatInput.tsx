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
 * - Platform-aware sending from Enter or the footer Chat button
 */

import { Link } from "@tanstack/react-router";
import type React from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { BsGear } from "react-icons/bs";
import { LuShield } from "react-icons/lu";
import { toast } from "sonner";
import { logger } from "@/renderer/logging/logger";
import { KickChatSendError, kickChatService } from "../../backend/services/chat/kick-chat";
import { twitchChatService } from "../../backend/services/chat/twitch-chat";
import type { Emote } from "../../backend/services/emotes/emote-types";
import { useChatRoomState } from "../../hooks/useChatRoomState";
import { channelsMatch } from "../../lib/id-utils";
import type {
  ChatMessage,
  ChatPlatform,
  ContentFragment,
  ReplyInfo,
  SubscriberEligibilityRequest,
  SubscriberEligibilityResult,
} from "../../shared/chat-types";
import { useAuthStore } from "../../store/auth-store";
import { useEmoteStore } from "../../store/emote-store";
import { useFollowStore } from "../../store/follow-store";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  TWITCH_CHAT_ACTION_TOOLTIP_ARROW_CLASS,
  TWITCH_CHAT_ACTION_TOOLTIP_CLASS,
} from "./ChatMessageActionStyles";
import { ChatQuickSettingsPopover } from "./ChatQuickSettingsPopover";
import { ChatComposerReplyPreview } from "./ChatReply";
import { EmoteAutocomplete, useEmoteAutocomplete } from "./EmoteAutocomplete";
import { InfoBanner } from "./InfoBanner";
import { NativeEmoteButton } from "./input/NativeEmoteButton";
import { QuickEmoteActionBar } from "./input/QuickEmoteActionBar";
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
  /** Kick broadcaster user_id, used by 7TV to resolve the current channel's Kick emotes. */
  kickUserId?: string;
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
  /** Whether the viewer has a platform auth session. Defaults to `canSend` for legacy callers. */
  isAuthenticated?: boolean;
  /** Called when an unauthenticated viewer attempts to send. */
  onAuthRequired?: (platform: ChatPlatform) => void | Promise<void>;
  /** True when known app state says this viewer can bypass room-mode restrictions. */
  viewerCanBypassRoomModes?: boolean;
  /** Opens the platform-owned channel page for restriction actions. */
  onOpenChannelPage?: (platform: ChatPlatform, channel: string) => void | Promise<void>;
  /** Checks subscriber-only eligibility. Unknown/missing checker must not false-block sends. */
  checkSubscriberEligibility?: (
    request: SubscriberEligibilityRequest
  ) => Promise<SubscriberEligibilityResult>;
  /** Show a link to the current channel's moderation page beside chat settings. */
  showModViewLink?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Custom class name */
  className?: string;
}

interface ReplyState {
  messageId: string;
  userId: string;
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
type RoomSendBlockerKind =
  | "followersOnly"
  | "subscribersOnly"
  | "twitchSubscriptionScopes"
  | "twitchVerification"
  | "emoteOnly"
  | "slowMode";
interface SendBlockerCopy {
  message: string;
  action: string | null;
}
interface ClassifiedSendBlocker {
  kind: RoomSendBlockerKind;
  copy: SendBlockerCopy;
  cooldownSeconds?: number;
}

/** Single Private Use Area code point that stands in for an inserted emote
 *  inside the editor state. Anything outside the PUA can be safely
 *  typed by users; this code point won't collide with real text. Each
 *  occurrence in `message` maps 1:1 with an entry in `emoteSlots` (same
 *  order), so rich editor helpers count an emote as ONE character. */
const EMOTE_CHAR = "";
const PLATFORM_CHAT_MESSAGE_MAX_LENGTH = 500;

/** Build ContentFragments from the rich editor value + emote slots, mirroring
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
          url: slot.urls.url2x ?? slot.urls.url1x,
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

function normalizeReplyMentionUsername(username: string): string {
  return username.trim().replace(/^@+/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function startsWithReplyMention(message: string, username: string): boolean {
  const normalizedUsername = normalizeReplyMentionUsername(username);
  if (!normalizedUsername) return false;

  return new RegExp(`^@${escapeRegExp(normalizedUsername)}(?:\\s|$)`, "i").test(message);
}

function withReplyMention(
  username: string,
  message: string,
  fragments: ContentFragment[]
): { message: string; fragments: ContentFragment[] } {
  const normalizedUsername = normalizeReplyMentionUsername(username);
  if (!normalizedUsername || startsWithReplyMention(message, normalizedUsername)) {
    return { message, fragments };
  }

  const prefixedMessage = `@${normalizedUsername} ${message}`;
  const mentionFragment: ContentFragment = { type: "mention", username: normalizedUsername };
  const [firstFragment, ...restFragments] = fragments;

  if (!firstFragment) {
    return { message: prefixedMessage, fragments: [mentionFragment] };
  }

  if (firstFragment.type === "text") {
    return {
      message: prefixedMessage,
      fragments: [
        mentionFragment,
        { ...firstFragment, content: ` ${firstFragment.content}` },
        ...restFragments,
      ],
    };
  }

  return {
    message: prefixedMessage,
    fragments: [mentionFragment, { type: "text", content: " " }, ...fragments],
  };
}

/** Convert the editor's placeholder-bearing value into the actual chat-server
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

function countEmotes(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch === EMOTE_CHAR) count++;
  }
  return count;
}

function isEmoteOnlyDraft(message: string): boolean {
  return countEmotes(message) > 0 && [...message].every((ch) => ch === EMOTE_CHAR || /\s/.test(ch));
}

function getChannelUrl(platform: ChatPlatform, channel: string): string {
  return platform === "twitch" ? `https://www.twitch.tv/${channel}` : `https://kick.com/${channel}`;
}

function getFollowSourceKey(platform: ChatPlatform, id: string, username: string): string {
  return `${platform}:${id || username.toLowerCase()}`;
}

function formatSlowModeWait(seconds: number): string {
  return `${Math.max(1, Math.ceil(seconds))}s`;
}

function isKickChatSendError(err: unknown): err is KickChatSendError {
  return (
    err instanceof KickChatSendError ||
    (err instanceof Error &&
      typeof (err as { kickSendResult?: unknown }).kickSendResult === "object" &&
      (err as { kickSendResult?: unknown }).kickSendResult !== null)
  );
}

function getKickSendResult(err: unknown): KickChatSendError["kickSendResult"] | null {
  if (!isKickChatSendError(err)) return null;
  return (err as { kickSendResult: KickChatSendError["kickSendResult"] }).kickSendResult;
}

function classifySendRejection(platform: ChatPlatform, err: unknown): ClassifiedSendBlocker | null {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (platform === "twitch") {
    if (lower.includes("slow") && lower.includes("mode")) {
      return {
        kind: "slowMode",
        copy: { message: "Slow mode is active. Try again in a moment.", action: null },
      };
    }
    if (lower.includes("verified") && lower.includes("phone")) {
      return {
        kind: "twitchVerification",
        copy: { message: "Add a phone number to chat on Twitch", action: "Open Twitch" },
      };
    }
    if (lower.includes("verified") && lower.includes("email")) {
      return {
        kind: "twitchVerification",
        copy: { message: "Verify your email to chat on Twitch", action: "Open Twitch" },
      };
    }
    if (lower.includes("verified")) {
      return {
        kind: "twitchVerification",
        copy: { message: "Verify your Twitch account to chat", action: "Open Twitch" },
      };
    }
  }

  const kickResult = platform === "kick" ? getKickSendResult(err) : null;
  if (kickResult) {
    if (kickResult.kind === "rate-limited") {
      const cooldownSeconds = kickResult.retryAfterSeconds;
      return {
        kind: "slowMode",
        copy: {
          message:
            cooldownSeconds !== undefined
              ? `Slow mode active. Wait ${formatSlowModeWait(cooldownSeconds)}.`
              : "Slow mode is active. Try again in a moment.",
          action: null,
        },
        cooldownSeconds,
      };
    }
    if (lower.includes("subscriber") || lower.includes("sub-only")) {
      return {
        kind: "subscribersOnly",
        copy: { message: "Subscribers-only chat is enabled", action: "Subscribe" },
      };
    }
    if (lower.includes("follower")) {
      return {
        kind: "followersOnly",
        copy: { message: "Followers-only chat is enabled", action: "Open channel" },
      };
    }
    if (lower.includes("emote")) {
      return {
        kind: "emoteOnly",
        copy: { message: "Emote-only chat is enabled", action: null },
      };
    }
  }

  return null;
}

function getNodeMessageLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }
  if (node instanceof HTMLElement && node.dataset.chatEmoteNode === "true") {
    return 1;
  }
  if (node instanceof HTMLBRElement) {
    return 1;
  }
  let length = 0;
  node.childNodes.forEach((child) => {
    length += getNodeMessageLength(child);
  });
  return length;
}

function getOffsetInsideNode(root: Node, container: Node, offset: number): number {
  if (root.nodeType === Node.TEXT_NODE) {
    return root === container ? offset : (root.textContent?.length ?? 0);
  }

  if (root === container) {
    let length = 0;
    for (let i = 0; i < offset; i++) {
      const child = root.childNodes[i];
      if (child) length += getNodeMessageLength(child);
    }
    return length;
  }

  if (root instanceof HTMLElement && root.dataset.chatEmoteNode === "true") {
    return 1;
  }

  let length = 0;
  for (const child of Array.from(root.childNodes)) {
    if (child === container || child.contains(container)) {
      return length + getOffsetInsideNode(child, container, offset);
    }
    length += getNodeMessageLength(child);
  }
  return length;
}

function getEditorPositionFromDomPoint(
  editor: HTMLElement,
  container: Node,
  offset: number
): number {
  return Math.min(getOffsetInsideNode(editor, container, offset), getNodeMessageLength(editor));
}

function getEditorSelectionRange(editor: HTMLElement): { start: number; end: number } {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { start: 0, end: 0 };
  }
  const range = selection.getRangeAt(0);
  const editorLength = getNodeMessageLength(editor);
  const startsInEditor = editor.contains(range.startContainer);
  const endsInEditor = editor.contains(range.endContainer);

  if (!startsInEditor && !endsInEditor) {
    if (range.collapsed) {
      return { start: 0, end: 0 };
    }
    if (typeof range.intersectsNode === "function" && range.intersectsNode(editor)) {
      return { start: 0, end: editorLength };
    }
    return { start: 0, end: 0 };
  }

  const start = startsInEditor
    ? getEditorPositionFromDomPoint(editor, range.startContainer, range.startOffset)
    : 0;
  const end = endsInEditor
    ? getEditorPositionFromDomPoint(editor, range.endContainer, range.endOffset)
    : editorLength;
  return start <= end ? { start, end } : { start: end, end: start };
}

function showMessageTooLongToast(maxLength: number) {
  toast.error("Message is too long", {
    id: "chat-message-too-long",
    description: `Twitch and Kick messages can be up to ${maxLength} characters.`,
  });
}

function setEditorCaret(editor: HTMLElement, position: number) {
  const target = Math.max(0, Math.min(position, getNodeMessageLength(editor)));
  const range = document.createRange();
  let offset = 0;
  let placed = false;

  for (const child of Array.from(editor.childNodes)) {
    const length = getNodeMessageLength(child);
    if (child instanceof HTMLElement && child.dataset.chatEmoteNode === "true") {
      if (target <= offset) {
        range.setStartBefore(child);
        range.collapse(true);
        placed = true;
        break;
      }
      if (target <= offset + length) {
        range.setStartAfter(child);
        range.collapse(true);
        placed = true;
        break;
      }
    } else if (child.nodeType === Node.TEXT_NODE) {
      if (target >= offset && target <= offset + length) {
        range.setStart(child, target - offset);
        range.collapse(true);
        placed = true;
        break;
      }
    }
    offset += length;
  }

  if (!placed) {
    range.setStart(editor, editor.childNodes.length);
    range.collapse(true);
  }

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  if (target >= getNodeMessageLength(editor)) {
    editor.scrollTop = editor.scrollHeight;
  }
}

function renderEditorDom(editor: HTMLElement, message: string, slots: Emote[]) {
  const nodes: Node[] = [];
  let buffer = "";
  let slotIndex = 0;

  const flushText = () => {
    if (!buffer) return;
    nodes.push(document.createTextNode(buffer));
    buffer = "";
  };

  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    if (char !== EMOTE_CHAR) {
      buffer += char;
      continue;
    }

    flushText();
    const emote = slots[slotIndex];
    if (emote) {
      const span = document.createElement("span");
      span.setAttribute("role", "button");
      span.setAttribute("aria-label", emote.name);
      span.dataset.chatEmoteNode = "true";
      span.dataset.slotIndex = String(slotIndex);
      span.dataset.emoteName = emote.name;
      span.contentEditable = "false";
      span.className = "inline-flex h-5 items-center align-middle";

      const img = document.createElement("img");
      img.src = emote.urls.url1x;
      img.alt = emote.name;
      img.className = "inline-block h-5 w-auto align-middle";
      img.draggable = false;
      span.appendChild(img);
      nodes.push(span);
    }
    slotIndex++;
  }

  flushText();
  editor.replaceChildren(...nodes);
}

function readEditorValue(editor: HTMLElement, slots: Emote[]): { message: string; slots: Emote[] } {
  let message = "";
  const nextSlots: Emote[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      message += node.textContent ?? "";
      return;
    }
    if (node instanceof HTMLBRElement) {
      message += "\n";
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    if (node.dataset.chatEmoteNode === "true") {
      const slot = slots[Number(node.dataset.slotIndex)];
      if (slot) {
        message += EMOTE_CHAR;
        nextSlots.push(slot);
      }
      return;
    }

    node.childNodes.forEach(walk);
  };

  editor.childNodes.forEach(walk);
  return { message, slots: nextSlots };
}

function replaceMessageRange(
  message: string,
  slots: Emote[],
  start: number,
  end: number,
  insertText: string,
  insertSlot?: Emote
): { message: string; slots: Emote[]; cursorPosition: number } {
  const before = message.slice(0, start);
  const removed = message.slice(start, end);
  const after = message.slice(end);
  const startSlot = countEmotes(before);
  const removedSlots = countEmotes(removed);
  const insertedSlots = insertSlot ? [insertSlot] : [];

  return {
    message: `${before}${insertText}${after}`,
    slots: [
      ...slots.slice(0, startSlot),
      ...insertedSlots,
      ...slots.slice(startSlot + removedSlots),
    ],
    cursorPosition: start + insertText.length,
  };
}

function getBackspaceRange(message: string, start: number, end: number) {
  if (start !== end) return { start, end };
  if (start <= 0) return null;

  if (message[start - 1] === " " && message[start - 2] === EMOTE_CHAR) {
    return { start: start - 2, end: start };
  }

  if (message[start - 1] === EMOTE_CHAR) {
    return { start: start - 1, end: message[start] === " " ? start + 1 : start };
  }

  return null;
}

function getDeleteRange(message: string, start: number, end: number) {
  if (start !== end) return { start, end };
  if (message[start] !== EMOTE_CHAR) return null;
  return { start, end: message[start + 1] === " " ? start + 2 : start + 1 };
}

function getPlainDeleteRange(
  message: string,
  start: number,
  end: number,
  direction: "backward" | "forward"
) {
  if (start !== end) return { start, end };
  if (direction === "backward" && start > 0) return { start: start - 1, end: start };
  if (direction === "forward" && start < message.length) return { start, end: start + 1 };
  return null;
}

function getInputDeleteRange(
  message: string,
  start: number,
  end: number,
  direction: "backward" | "forward"
) {
  return (
    (direction === "backward"
      ? getBackspaceRange(message, start, end)
      : getDeleteRange(message, start, end)) ?? getPlainDeleteRange(message, start, end, direction)
  );
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  (
    {
      channel,
      platform,
      chatroomId: _chatroomId,
      kickUserId,
      channelId,
      maxLength = PLATFORM_CHAT_MESSAGE_MAX_LENGTH,
      placeholder = "Send a message...",
      canSend = true,
      isAuthenticated,
      onAuthRequired,
      viewerCanBypassRoomModes = false,
      onOpenChannelPage,
      checkSubscriberEligibility,
      showModViewLink = false,
      disabled = false,
      className = "",
    },
    ref
  ) => {
    // State
    const [message, setMessage] = useState("");
    /** One entry per EMOTE_CHAR in `message`, in left-to-right order. The
     *  rich editor counts each inserted emote as a single character; this list
     *  carries the matching Emote so the editor can render the actual image
     *  and `serializeMessage` can reconstruct the IRC payload on send. */
    const [emoteSlots, setEmoteSlots] = useState<Emote[]>([]);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [reply, setReply] = useState<ReplyState | null>(null);
    // Single dialog-tracking state; opening one closes the other. Parent-local
    // concern, so no event bus or shared store.
    const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
    const [showChatSettings, setShowChatSettings] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isEditorFocused, setIsEditorFocused] = useState(false);
    const [showAuthBlocker, setShowAuthBlocker] = useState(false);
    const [activeRoomBlocker, setActiveRoomBlocker] = useState<RoomSendBlockerKind | null>(null);
    const [activeBlockerCopy, setActiveBlockerCopy] = useState<SendBlockerCopy | null>(null);
    const [slowCooldownUntilMs, setSlowCooldownUntilMs] = useState(0);
    const [slowCooldownDurationMs, setSlowCooldownDurationMs] = useState(0);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [error, setError] = useState<string | null>(null);

    // Refs
    const editorRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const thirdPartyPopoverAnchorRef = useRef<HTMLElement | null>(null);
    const settingsButtonRef = useRef<HTMLButtonElement>(null);
    const messageRef = useRef(message);
    const emoteSlotsRef = useRef(emoteSlots);
    const cursorPositionRef = useRef(cursorPosition);
    messageRef.current = message;
    emoteSlotsRef.current = emoteSlots;
    cursorPositionRef.current = cursorPosition;

    // Signed-in Kick user — needed to attach a sender identity to the optimistic
    // local echo of outbound messages. Kick's web v2 send path delivers the
    // sender's own message via Pusher ~150-400ms later with full identity; the
    // local optimistic echo bridges that latency and dedup-by-message-id
    // collapses the duplicate. Subscribed reactively so a mid-session
    // sign-in/out updates the value without remounting this component.
    const kickUser = useAuthStore((state) => state.kickUser);
    const localFollows = useFollowStore((state) => state.localFollows);
    const sourceByKey = useFollowStore((state) => state.sourceByKey);
    const roomState = useChatRoomState(platform, channelId);
    const viewerIsAuthenticated = isAuthenticated ?? canSend;
    const currentChannel = useMemo(
      () => ({
        platform,
        id: channelId ?? "",
        username: channel,
      }),
      [channel, channelId, platform]
    );
    const viewerFollowsChannel = useMemo(() => {
      if (!viewerIsAuthenticated) return false;
      const matchingFollow = localFollows.find((follow) => channelsMatch(follow, currentChannel));
      if (!matchingFollow) return false;
      const source =
        sourceByKey.get(
          getFollowSourceKey(platform, matchingFollow.id, matchingFollow.username ?? "")
        ) ??
        sourceByKey.get(getFollowSourceKey(platform, channelId ?? "", channel)) ??
        "guest";
      return source === platform;
    }, [
      channel,
      channelId,
      currentChannel,
      localFollows,
      platform,
      sourceByKey,
      viewerIsAuthenticated,
    ]);
    const authCopy =
      platform === "twitch"
        ? { message: "Log in to chat", action: "Log in" }
        : { message: "Sign in to chat", action: "Sign in" };
    const slowModeRemainingMs = Math.max(0, slowCooldownUntilMs - nowMs);
    const slowModeRemainingSeconds = Math.max(0, Math.ceil(slowModeRemainingMs / 1000));
    const showSlowModeCountdown = slowModeRemainingMs > 0 && slowCooldownDurationMs > 0;
    const slowModeProgressValue = showSlowModeCountdown
      ? Math.min(100, Math.max(0, (slowModeRemainingMs / slowCooldownDurationMs) * 100))
      : 0;
    const roomBlockerCopy: SendBlockerCopy | null =
      activeBlockerCopy ??
      (activeRoomBlocker === "followersOnly"
        ? { message: "Followers-only chat is enabled", action: "Open channel" }
        : activeRoomBlocker === "subscribersOnly"
          ? { message: "Subscribers-only chat is enabled", action: "Subscribe" }
          : activeRoomBlocker === "twitchSubscriptionScopes"
            ? {
                message: "Reconnect Twitch to check subscriber-only chat",
                action: "Reconnect Twitch",
              }
            : activeRoomBlocker === "twitchVerification"
              ? { message: "Verify your Twitch account to chat", action: "Open Twitch" }
              : activeRoomBlocker === "emoteOnly"
                ? { message: "Emote-only chat is enabled", action: null }
                : activeRoomBlocker === "slowMode"
                  ? {
                      message:
                        slowModeRemainingSeconds > 0
                          ? `Slow mode active. Wait ${formatSlowModeWait(slowModeRemainingSeconds)}.`
                          : "Slow mode is active. Try again in a moment.",
                      action: null,
                    }
                  : null);
    const roomModeCoveredByInfoBanner =
      (activeRoomBlocker === "followersOnly" &&
        roomState.followersOnly !== null &&
        roomState.followersOnly >= 0) ||
      (activeRoomBlocker === "twitchVerification" && roomState.twitchVerification !== null) ||
      (activeRoomBlocker === "subscribersOnly" && roomState.subscribersOnly) ||
      (activeRoomBlocker === "emoteOnly" && roomState.emoteOnly) ||
      (activeRoomBlocker === "slowMode" && roomState.slowMode !== null && roomState.slowMode > 0);
    const showDedicatedRoomBlocker =
      !showAuthBlocker && viewerIsAuthenticated && roomBlockerCopy && !roomModeCoveredByInfoBanner;

    // Autocomplete hooks
    const emoteAutocomplete = useEmoteAutocomplete();
    const mentionAutocomplete = useMentionAutocomplete();
    const addRecentEmote = useEmoteStore((state) => state.addRecentEmote);
    const { checkTrigger: checkEmoteAutocompleteTrigger, isActive: isEmoteAutocompleteActive } =
      emoteAutocomplete;
    const { checkTrigger: checkMentionAutocompleteTrigger, isActive: isMentionAutocompleteActive } =
      mentionAutocomplete;

    useLayoutEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      renderEditorDom(editor, message, emoteSlots);
      if (document.activeElement === editor) {
        setEditorCaret(editor, cursorPosition);
      }
    }, [message, emoteSlots, cursorPosition]);

    useEffect(() => {
      if (slowCooldownUntilMs <= Date.now()) return;

      setNowMs(Date.now());
      // timer-allowlist: short-lived slow-mode countdown tick cleared when cooldown changes/unmounts
      const intervalId = window.setInterval(() => {
        setNowMs(Date.now());
      }, 250);

      return () => window.clearInterval(intervalId);
    }, [slowCooldownUntilMs]);

    useEffect(() => {
      if (
        activeRoomBlocker === "slowMode" &&
        slowCooldownUntilMs > 0 &&
        slowCooldownUntilMs <= nowMs
      ) {
        setActiveRoomBlocker(null);
        setActiveBlockerCopy(null);
      }
      if (slowCooldownUntilMs > 0 && slowCooldownUntilMs <= nowMs) {
        setSlowCooldownDurationMs(0);
      }
    }, [activeRoomBlocker, nowMs, slowCooldownUntilMs]);

    const syncEditorFromDom = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;

      const currentMessage = messageRef.current;
      const parsed = readEditorValue(editor, emoteSlotsRef.current);
      const selection = getEditorSelectionRange(editor);
      const insertedLength = parsed.message.length - currentMessage.length;
      const nextCursorPosition =
        insertedLength > 0 && selection.start === 0 && selection.end === 0
          ? Math.min(parsed.message.length, cursorPositionRef.current + insertedLength)
          : selection.start;
      emoteSlotsRef.current = parsed.slots;
      messageRef.current = parsed.message;
      cursorPositionRef.current = nextCursorPosition;
      setEmoteSlots(parsed.slots);
      setMessage(parsed.message);
      setCursorPosition(nextCursorPosition);
      setError(null);
      emoteAutocomplete.checkTrigger(parsed.message, nextCursorPosition, ":");
      mentionAutocomplete.checkTrigger(parsed.message, nextCursorPosition);
    }, [emoteAutocomplete, mentionAutocomplete]);

    const updateCursorFromSelection = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const selection = getEditorSelectionRange(editor);
      if (selection.start !== selection.end) {
        cursorPositionRef.current = selection.start;
        return;
      }
      const nextPosition =
        selection.start === 0 &&
        selection.end === 0 &&
        cursorPositionRef.current > 0 &&
        messageRef.current.length > 0
          ? cursorPositionRef.current
          : selection.start;
      cursorPositionRef.current = nextPosition;
      setCursorPosition(nextPosition);
    }, []);

    const handleEditorFocus = useCallback(() => {
      setIsEditorFocused(true);
      const editor = editorRef.current;
      if (!editor) return;
      const selection = getEditorSelectionRange(editor);
      if (selection.start !== selection.end) {
        cursorPositionRef.current = selection.start;
        setCursorPosition(selection.start);
        return;
      }
      setEditorCaret(editor, cursorPosition);
    }, [cursorPosition]);

    const handleEditorBlur = useCallback(() => {
      setIsEditorFocused(false);
    }, []);

    const handleAuthRequired = useCallback(async () => {
      flushSync(() => {
        setError(null);
        setShowAuthBlocker(true);
        setActiveRoomBlocker(null);
        setActiveBlockerCopy(null);
      });
      try {
        await onAuthRequired?.(platform);
      } finally {
        editorRef.current?.focus();
      }
    }, [onAuthRequired, platform]);

    const getRoomSendBlocker = useCallback(
      (draftMessage: string): RoomSendBlockerKind | null => {
        if (viewerCanBypassRoomModes) return null;
        if (roomState.followersOnly !== null && roomState.followersOnly >= 0) {
          return viewerFollowsChannel ? null : "followersOnly";
        }
        if (platform === "twitch" && roomState.twitchVerification !== null) {
          return "twitchVerification";
        }
        return roomState.emoteOnly && !isEmoteOnlyDraft(draftMessage) ? "emoteOnly" : null;
      },
      [
        platform,
        roomState.emoteOnly,
        roomState.followersOnly,
        roomState.twitchVerification,
        viewerCanBypassRoomModes,
        viewerFollowsChannel,
      ]
    );

    const getSubscriberSendBlocker = useCallback(async (): Promise<RoomSendBlockerKind | null> => {
      if (viewerCanBypassRoomModes || !roomState.subscribersOnly || !checkSubscriberEligibility) {
        return null;
      }

      const result = await checkSubscriberEligibility({ platform, channel, channelId });
      if (result.status === "notSubscribed") return "subscribersOnly";
      if (result.status === "missingScopes") return "twitchSubscriptionScopes";
      return null;
    }, [
      channel,
      channelId,
      checkSubscriberEligibility,
      platform,
      roomState.subscribersOnly,
      viewerCanBypassRoomModes,
    ]);

    const getSlowModeSendBlocker = useCallback((): RoomSendBlockerKind | null => {
      if (viewerCanBypassRoomModes) return null;
      return slowCooldownUntilMs > Date.now() ? "slowMode" : null;
    }, [slowCooldownUntilMs, viewerCanBypassRoomModes]);

    const startSlowModeCooldown = useCallback(
      (seconds = roomState.slowMode ?? 0) => {
        if (viewerCanBypassRoomModes || seconds <= 0) return;
        const durationMs = seconds * 1000;
        const nextUntilMs = Date.now() + durationMs;
        setSlowCooldownDurationMs(durationMs);
        setSlowCooldownUntilMs(nextUntilMs);
        setNowMs(Date.now());
      },
      [roomState.slowMode, viewerCanBypassRoomModes]
    );

    const showRoomSendBlocker = useCallback((kind: RoomSendBlockerKind, copy?: SendBlockerCopy) => {
      flushSync(() => {
        setError(null);
        setShowAuthBlocker(false);
        setActiveRoomBlocker(kind);
        setActiveBlockerCopy(copy ?? null);
      });
      editorRef.current?.focus();
    }, []);

    const handleClassifiedSendBlocker = useCallback(
      (sendBlocker: ClassifiedSendBlocker) => {
        if (sendBlocker.kind === "slowMode" && sendBlocker.cooldownSeconds !== undefined) {
          startSlowModeCooldown(sendBlocker.cooldownSeconds);
          showRoomSendBlocker("slowMode");
          return;
        }

        showRoomSendBlocker(sendBlocker.kind, sendBlocker.copy);
      },
      [showRoomSendBlocker, startSlowModeCooldown]
    );

    const handleOpenChannelPage = useCallback(async () => {
      const openAction =
        onOpenChannelPage?.(platform, channel) ??
        window.electronAPI?.openExternal?.(getChannelUrl(platform, channel));
      try {
        await openAction;
      } finally {
        editorRef.current?.focus();
      }
    }, [channel, onOpenChannelPage, platform]);

    const handleRoomBlockerAction = useCallback(async () => {
      if (activeRoomBlocker === "twitchSubscriptionScopes") {
        try {
          await onAuthRequired?.("twitch");
        } finally {
          editorRef.current?.focus();
        }
        return;
      }

      await handleOpenChannelPage();
    }, [activeRoomBlocker, handleOpenChannelPage, onAuthRequired]);

    const replaceSelection = useCallback(
      (insertText: string, insertSlot?: Emote) => {
        const editor = editorRef.current;
        const parsedEditor = editor ? readEditorValue(editor, emoteSlotsRef.current) : null;
        const currentMessage = parsedEditor?.message ?? messageRef.current;
        const currentSlots = parsedEditor?.slots ?? emoteSlotsRef.current;
        const domSelection = editor
          ? getEditorSelectionRange(editor)
          : { start: cursorPositionRef.current, end: cursorPositionRef.current };
        const selection =
          editor &&
          domSelection.start === 0 &&
          domSelection.end === 0 &&
          cursorPositionRef.current > 0 &&
          document.activeElement === editor
            ? { start: cursorPositionRef.current, end: cursorPositionRef.current }
            : domSelection;
        const next = replaceMessageRange(
          currentMessage,
          currentSlots,
          selection.start,
          selection.end,
          insertText,
          insertSlot
        );
        flushSync(() => {
          messageRef.current = next.message;
          emoteSlotsRef.current = next.slots;
          cursorPositionRef.current = next.cursorPosition;
          setMessage(next.message);
          setEmoteSlots(next.slots);
          setCursorPosition(next.cursorPosition);
          setError(null);
        });
        if (editor) {
          renderEditorDom(editor, next.message, next.slots);
        }
        checkEmoteAutocompleteTrigger(next.message, next.cursorPosition, ":");
        checkMentionAutocompleteTrigger(next.message, next.cursorPosition);
        if (editor) {
          editor.focus();
          setEditorCaret(editor, next.cursorPosition);
        }
      },
      [checkEmoteAutocompleteTrigger, checkMentionAutocompleteTrigger]
    );

    const handleBeforeInput = useCallback(
      (e: React.FormEvent<HTMLDivElement>) => {
        const inputEvent = e.nativeEvent as InputEvent;
        const editor = editorRef.current;
        if (!editor || emoteAutocomplete.isActive || mentionAutocomplete.isActive) return;

        if (inputEvent.inputType === "insertText" && inputEvent.data) {
          e.preventDefault();
          replaceSelection(inputEvent.data);
          return;
        }

        if (
          inputEvent.inputType !== "deleteContentBackward" &&
          inputEvent.inputType !== "deleteContentForward"
        ) {
          return;
        }

        const selection = getEditorSelectionRange(editor);
        const parsedEditor = readEditorValue(editor, emoteSlotsRef.current);
        const currentMessage = parsedEditor.message;
        const currentSlots = parsedEditor.slots;
        const deleteRange = getInputDeleteRange(
          currentMessage,
          selection.start,
          selection.end,
          inputEvent.inputType === "deleteContentBackward" ? "backward" : "forward"
        );

        if (!deleteRange) return;

        e.preventDefault();
        const next = replaceMessageRange(
          currentMessage,
          currentSlots,
          deleteRange.start,
          deleteRange.end,
          ""
        );
        flushSync(() => {
          messageRef.current = next.message;
          emoteSlotsRef.current = next.slots;
          cursorPositionRef.current = next.cursorPosition;
          setMessage(next.message);
          setEmoteSlots(next.slots);
          setCursorPosition(next.cursorPosition);
          setError(null);
        });
        renderEditorDom(editor, next.message, next.slots);
        editor.focus();
        setEditorCaret(editor, next.cursorPosition);
      },
      [emoteAutocomplete.isActive, mentionAutocomplete.isActive, replaceSelection]
    );

    // Handle emote selection from autocomplete or dialog. The autocomplete
    // path passes (startPos, endPos) so we replace the trigger + query span;
    // the dialog path omits them and we insert at the current cursor.
    //
    // Each inserted emote becomes a SINGLE EMOTE_CHAR in the rich editor state, with
    // the matching `Emote` pushed into `emoteSlots` at the equivalent index.
    // This makes the emote count as one character — matching KickTalk's
    // `EmoteNode` (a single node in the Lexical tree, not its full name).
    const handleEmoteSelect = useCallback(
      (emote: Emote, startPos?: number, endPos?: number) => {
        if (disabled) {
          emoteAutocomplete.deactivate();
          setActiveDialog(null);
          return;
        }

        addRecentEmote(emote);

        const insertAt = startPos !== undefined ? startPos : cursorPosition;
        const replaceUpTo = endPos !== undefined ? endPos : cursorPosition;
        const after = message.slice(replaceUpTo);
        // Append a trailing space after the emote unless the next char is
        // already whitespace — gives the user a clean spot to keep typing
        // without producing a double-space when an emote is appended at end.
        const trailing = after.startsWith(" ") ? "" : " ";
        const next = replaceMessageRange(
          message,
          emoteSlots,
          insertAt,
          replaceUpTo,
          `${EMOTE_CHAR}${trailing}`,
          emote
        );
        flushSync(() => {
          setEmoteSlots(next.slots);
          setMessage(next.message);
          setCursorPosition(next.cursorPosition);
        });
        const editor = editorRef.current;
        if (editor) {
          editor.focus();
          setEditorCaret(editor, next.cursorPosition);
        }

        emoteAutocomplete.deactivate();
        setActiveDialog(null);
      },
      [message, emoteSlots, cursorPosition, emoteAutocomplete, disabled, addRecentEmote]
    );

    // Handle mention selection
    const handleMentionSelect = useCallback(
      (username: string, startPos: number, endPos: number) => {
        const next = replaceMessageRange(message, emoteSlots, startPos, endPos, `@${username} `);
        flushSync(() => {
          setMessage(next.message);
          setEmoteSlots(next.slots);
          setCursorPosition(next.cursorPosition);
        });
        const editor = editorRef.current;
        if (editor) {
          editor.focus();
          setEditorCaret(editor, next.cursorPosition);
        }

        mentionAutocomplete.deactivate();
      },
      [message, emoteSlots, mentionAutocomplete]
    );

    // Handle reply
    const handleReply = useCallback((msg: ChatMessage) => {
      setReply({
        messageId: msg.id,
        userId: msg.userId,
        username: msg.username,
        displayName: msg.displayName,
        content: msg.rawContent.length > 50 ? `${msg.rawContent.slice(0, 50)}...` : msg.rawContent,
      });

      editorRef.current?.focus();
    }, []);

    const mentionUser = useCallback(
      (username: string) => {
        const mention = `@${username} `;
        const nextMessage = message.startsWith(mention) ? message : `${mention}${message}`;
        flushSync(() => {
          setMessage(nextMessage);
          setCursorPosition(nextMessage.length);
        });
        const el = editorRef.current;
        if (el) {
          el.focus();
          setEditorCaret(el, nextMessage.length);
        }
      },
      [message]
    );

    useImperativeHandle(ref, () => ({ replyTo: handleReply, mentionUser }), [
      handleReply,
      mentionUser,
    ]);

    const clearReply = useCallback(() => {
      setReply(null);
    }, []);

    const sendChatPayload = useCallback(
      async (trimmedMessage: string, localFragments: ContentFragment[]) => {
        if (reply) {
          const replyPayload = withReplyMention(reply.username, trimmedMessage, localFragments);
          if (platform === "twitch") {
            await twitchChatService.sendReply(
              channel,
              reply.messageId,
              replyPayload.message,
              replyPayload.fragments
            );
          } else {
            const localReplyTo: ReplyInfo = {
              parentMessageId: reply.messageId,
              parentUserId: reply.userId,
              parentUsername: reply.username,
              parentDisplayName: reply.displayName,
              parentMessageBody: reply.content,
            };
            await kickChatService.sendMessage(
              channel,
              replyPayload.message,
              kickUser ?? undefined,
              replyPayload.fragments,
              localReplyTo
            );
          }
          return;
        }

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
      },
      [channel, kickUser, platform, reply]
    );

    const handleQuickEmoteSend = useCallback(
      async (emote: Emote) => {
        if (disabled || isSending) return;

        const quickMessage = EMOTE_CHAR;
        const quickSlots = [emote];
        const serialized = serializeMessage(quickMessage, quickSlots, platform);
        const trimmedMessage = serialized.trim();
        if (!trimmedMessage) return;
        if (serialized.length > maxLength) {
          showMessageTooLongToast(maxLength);
          editorRef.current?.focus();
          return;
        }
        if (!viewerIsAuthenticated) {
          await handleAuthRequired();
          return;
        }
        const roomBlocker = getRoomSendBlocker(quickMessage);
        if (roomBlocker === "followersOnly") {
          showRoomSendBlocker(roomBlocker);
          return;
        }
        const subscriberBlocker = await getSubscriberSendBlocker();
        if (subscriberBlocker) {
          showRoomSendBlocker(subscriberBlocker);
          return;
        }
        if (roomBlocker) {
          showRoomSendBlocker(roomBlocker);
          return;
        }
        const slowModeBlocker = getSlowModeSendBlocker();
        if (slowModeBlocker) {
          showRoomSendBlocker(slowModeBlocker);
          return;
        }
        if (!canSend) return;

        const localFragments = serializeFragments(quickMessage, quickSlots);
        addRecentEmote(emote);
        setIsSending(true);
        setError(null);

        try {
          await sendChatPayload(trimmedMessage, localFragments);
          startSlowModeCooldown();
          setActiveRoomBlocker(null);
          setActiveBlockerCopy(null);
          setReply(null);
          editorRef.current?.focus();
        } catch (err) {
          const sendBlocker = classifySendRejection(platform, err);
          if (sendBlocker) {
            handleClassifiedSendBlocker(sendBlocker);
            logger.info("UI:Chat:Input", "quick emote send blocked by room restriction", {
              blocker: sendBlocker.kind,
            });
            return;
          }

          const errorMessage = err instanceof Error ? err.message : "Failed to send message";
          setError(errorMessage);
          logger.error("UI:Chat:Input", "failed to send quick emote", {
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          setIsSending(false);
        }
      },
      [
        addRecentEmote,
        canSend,
        disabled,
        getRoomSendBlocker,
        getSubscriberSendBlocker,
        getSlowModeSendBlocker,
        handleAuthRequired,
        handleClassifiedSendBlocker,
        isSending,
        maxLength,
        platform,
        sendChatPayload,
        showRoomSendBlocker,
        startSlowModeCooldown,
        viewerIsAuthenticated,
      ]
    );

    // Handle send
    const handleSend = useCallback(async () => {
      // Convert placeholder-bearing editor state into the real chat-server
      // string. For Kick, native emote slots become `[emote:id:name]` markup so
      // kick.com renders them as images for everyone (otherwise they ship as
      // plain text). The chat server has no awareness of our private emote marker.
      const serialized = serializeMessage(message, emoteSlots, platform);
      const trimmedMessage = serialized.trim();
      if (!trimmedMessage || isSending) return;
      if (serialized.length > maxLength) {
        showMessageTooLongToast(maxLength);
        editorRef.current?.focus();
        return;
      }
      if (!viewerIsAuthenticated) {
        await handleAuthRequired();
        return;
      }
      const roomBlocker = getRoomSendBlocker(message);
      if (roomBlocker === "followersOnly") {
        showRoomSendBlocker(roomBlocker);
        return;
      }
      const subscriberBlocker = await getSubscriberSendBlocker();
      if (subscriberBlocker) {
        showRoomSendBlocker(subscriberBlocker);
        return;
      }
      if (roomBlocker) {
        showRoomSendBlocker(roomBlocker);
        return;
      }
      const slowModeBlocker = getSlowModeSendBlocker();
      if (slowModeBlocker) {
        showRoomSendBlocker(slowModeBlocker);
        return;
      }
      if (!canSend) return;

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
          await sendChatPayload(trimmedMessage, localFragments);
        }

        setMessage("");
        setEmoteSlots([]);
        startSlowModeCooldown();
        setActiveRoomBlocker(null);
        setActiveBlockerCopy(null);
        setReply(null);
        setCursorPosition(0);
        editorRef.current?.focus();
      } catch (err) {
        const sendBlocker = classifySendRejection(platform, err);
        if (sendBlocker) {
          handleClassifiedSendBlocker(sendBlocker);
          logger.info("UI:Chat:Input", "message send blocked by room restriction", {
            blocker: sendBlocker.kind,
          });
          return;
        }

        const errorMessage = err instanceof Error ? err.message : "Failed to send message";
        setError(errorMessage);
        logger.error("UI:Chat:Input", "failed to send message", {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setIsSending(false);
      }
    }, [
      message,
      emoteSlots,
      canSend,
      getRoomSendBlocker,
      getSubscriberSendBlocker,
      getSlowModeSendBlocker,
      handleAuthRequired,
      handleClassifiedSendBlocker,
      isSending,
      platform,
      channel,
      kickUser,
      maxLength,
      sendChatPayload,
      showRoomSendBlocker,
      startSlowModeCooldown,
      viewerIsAuthenticated,
    ]);

    // Handle key press — Enter sends; Shift+Enter inserts newline (default
    // contenteditable behavior, just do not preventDefault).
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        const isTextInput =
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !(e.nativeEvent as KeyboardEvent).isComposing;
        if (isTextInput) {
          e.preventDefault();
          replaceSelection(e.key);
          return;
        }

        if (e.key === "Backspace" || e.key === "Delete") {
          const editor = editorRef.current;
          const currentCursorPosition = cursorPositionRef.current;
          const selection = editor
            ? getEditorSelectionRange(editor)
            : { start: currentCursorPosition, end: currentCursorPosition };
          const deleteSelection =
            editor &&
            selection.start === 0 &&
            selection.end === 0 &&
            currentCursorPosition > 0 &&
            e.currentTarget === editor
              ? { start: currentCursorPosition, end: currentCursorPosition }
              : selection;
          const parsedEditor = editor ? readEditorValue(editor, emoteSlotsRef.current) : null;
          const currentMessage = parsedEditor?.message ?? messageRef.current;
          const currentSlots = parsedEditor?.slots ?? emoteSlotsRef.current;
          const deleteRange = getInputDeleteRange(
            currentMessage,
            deleteSelection.start,
            deleteSelection.end,
            e.key === "Backspace" ? "backward" : "forward"
          );

          if (deleteRange) {
            e.preventDefault();
            const next = replaceMessageRange(
              currentMessage,
              currentSlots,
              deleteRange.start,
              deleteRange.end,
              ""
            );
            flushSync(() => {
              messageRef.current = next.message;
              emoteSlotsRef.current = next.slots;
              cursorPositionRef.current = next.cursorPosition;
              setMessage(next.message);
              setEmoteSlots(next.slots);
              setCursorPosition(next.cursorPosition);
              setError(null);
            });
            if (editor) {
              renderEditorDom(editor, next.message, next.slots);
            }
            checkEmoteAutocompleteTrigger(next.message, next.cursorPosition, ":");
            checkMentionAutocompleteTrigger(next.message, next.cursorPosition);
            editor?.focus();
            if (editor) {
              setEditorCaret(editor, next.cursorPosition);
            }
            return;
          }
        }

        if (isEmoteAutocompleteActive || isMentionAutocompleteActive) {
          return;
        }

        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }

        if (e.key === "Enter" && e.shiftKey) {
          e.preventDefault();
          replaceSelection("\n");
        }

        if (e.key === "Escape") {
          if (reply) {
            clearReply();
          }
        }
      },
      [
        checkEmoteAutocompleteTrigger,
        checkMentionAutocompleteTrigger,
        handleSend,
        isEmoteAutocompleteActive,
        isMentionAutocompleteActive,
        replaceSelection,
        reply,
        clearReply,
      ]
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
    // rather than the placeholder-bearing editor state — that's what actually
    // gets transmitted and what the platform enforces a length limit on.
    const serializedLength = useMemo(
      () => serializeMessage(message, emoteSlots, platform).length,
      [message, emoteSlots, platform]
    );
    const isOverLimit = serializedLength > maxLength;
    const charactersRemaining = maxLength - serializedLength;

    const buttonsDisabled = disabled;
    const composerDisabled = disabled;
    const sendUnavailable = viewerIsAuthenticated && !canSend;
    const slowModeSendLocked = showSlowModeCountdown && !viewerCanBypassRoomModes;
    const canSubmit =
      !composerDisabled &&
      !sendUnavailable &&
      !isSending &&
      !isOverLimit &&
      !slowModeSendLocked &&
      serializeMessage(message, emoteSlots, platform).trim().length > 0;
    const shouldDimSubmit =
      composerDisabled || sendUnavailable || isSending || isOverLimit || slowModeSendLocked;
    const submitDisabled = composerDisabled || sendUnavailable || isSending || slowModeSendLocked;
    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLDivElement>) => {
        e.preventDefault();
        replaceSelection(e.clipboardData.getData("text/plain"));
      },
      [replaceSelection]
    );

    return (
      <div ref={containerRef} className={`relative flex flex-col ${className}`}>
        {/* Reply Preview — stays at the top, above InfoBanner */}
        {reply && (
          <ChatComposerReplyPreview
            displayName={reply.displayName}
            content={reply.content}
            onCancel={clearReply}
          />
        )}

        <QuickEmoteActionBar
          platform={platform}
          onSelect={handleQuickEmoteSend}
          disabled={disabled || isSending}
        />

        {/* InfoBanner — renders null when no chat-room modes are active. */}
        <InfoBanner
          platform={platform}
          channelId={channelId}
          viewerSatisfiesFollowerOnly={viewerFollowsChannel}
        />

        {showAuthBlocker && !viewerIsAuthenticated && (
          <div
            data-testid="chat-send-blocker"
            role="status"
            className="mb-1 flex items-center justify-between gap-3 rounded-md border border-[var(--color-border,rgba(83,83,95,0.48))] bg-[#262626] px-2 py-1 text-sm font-semibold text-white"
          >
            <span className="min-w-0 truncate">{authCopy.message}</span>
            <button
              type="button"
              onClick={handleAuthRequired}
              className={`flex-shrink-0 rounded-[4px] px-2 py-0.5 text-xs font-bold transition-opacity duration-150 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                platform === "twitch" ? "bg-[#9146FF] text-white" : "bg-[#53FC18] text-[#0f0f0f]"
              }`}
            >
              {authCopy.action}
            </button>
          </div>
        )}

        {showDedicatedRoomBlocker && (
          <div
            data-testid="chat-send-blocker"
            role="status"
            className="mb-1 flex items-center justify-between gap-3 rounded-md border border-[var(--color-border,rgba(83,83,95,0.48))] bg-[#262626] px-2 py-1 text-sm font-semibold text-white"
          >
            <span className="min-w-0 truncate">{roomBlockerCopy.message}</span>
            {roomBlockerCopy.action && (
              <button
                type="button"
                onClick={handleRoomBlockerAction}
                className={`flex-shrink-0 rounded-[4px] px-2 py-0.5 text-xs font-bold transition-opacity duration-150 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  platform === "twitch" ? "bg-[#9146FF] text-white" : "bg-[#53FC18] text-[#0f0f0f]"
                }`}
              >
                {roomBlockerCopy.action}
              </button>
            )}
          </div>
        )}

        {/* Main Input Area */}
        <div className={`relative flex flex-col gap-2 ${reply ? "rounded-b-md" : ""}`}>
          <div
            data-testid="chat-input-text-row"
            className="relative flex items-end gap-2 overflow-hidden rounded-md border-2 bg-[#191919] px-3 py-2 transition-colors duration-150"
            style={{ borderColor: isEditorFocused ? "#ffffff" : "var(--color-border)" }}
          >
            {/* Rich editor: inserted emotes are real inline nodes, so Chromium
            places the caret after the image instead of over a hidden placeholder. */}
            <div className="relative flex flex-1 self-stretch items-center">
              {!message && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-start text-left text-sm font-bold leading-[1.5] text-neutral-300">
                  {viewerIsAuthenticated ? placeholder : authCopy.message}
                </div>
              )}
              <div
                ref={editorRef}
                role="textbox"
                aria-label={viewerIsAuthenticated ? placeholder : authCopy.message}
                aria-multiline="true"
                aria-disabled={disabled}
                contentEditable={!disabled}
                suppressContentEditableWarning={true}
                data-testid="chat-rich-input"
                onBeforeInput={handleBeforeInput}
                onInput={syncEditorFromDom}
                onKeyUp={updateCursorFromSelection}
                onMouseUp={updateCursorFromSelection}
                onFocus={handleEditorFocus}
                onBlur={handleEditorBlur}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className="no-scrollbar relative min-h-6 max-h-[120px] w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent text-sm leading-[1.5] text-white caret-white focus:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                style={{ wordBreak: "break-word" }}
              />

              <EmoteAutocomplete
                inputValue={message}
                cursorPosition={cursorPosition}
                onSelect={(emote, start, end) => handleEmoteSelect(emote, start, end)}
                onClose={emoteAutocomplete.deactivate}
                isActive={emoteAutocomplete.isActive}
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
                      : "text-white"
                }`}
              >
                {charactersRemaining}
              </span>
            )}

            {/* Emote buttons (native + third-party). The wrapper keeps them in
              the input row while preserving the KickTalk action divider. */}
            <div
              className="flex items-center gap-2 pl-3 ml-1 -mr-1 border-l animate-slide-and-fade-in"
              style={{ borderLeftColor: "rgba(255,255,255,0.16)" }}
            >
              {/* Inline `borderColor` overrides the unlayered `* { border-color: var(--color-border) }`
                in global.css, which beats Tailwind's layered border-color utilities at the
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
                  kickUserId={kickUserId}
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
                  kickUserId={kickUserId}
                  isOpen={activeDialog === "thirdParty"}
                  onOpenRequest={handleThirdPartyOpenRequest}
                  onEmoteSelect={handleEmoteSelect}
                  disabled={buttonsDisabled}
                  popoverAnchorRef={thirdPartyPopoverAnchorRef}
                />
              </div>
            </div>
            <MentionAutocomplete
              inputValue={message}
              cursorPosition={cursorPosition}
              onSelect={handleMentionSelect}
              onClose={mentionAutocomplete.deactivate}
              isActive={mentionAutocomplete.isActive}
              platform={platform}
              channel={channel}
            />
            {showSlowModeCountdown && (
              <div
                aria-label="Slow mode cooldown"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(slowModeProgressValue)}
                className="absolute inset-x-0 bottom-0 h-1.5 bg-[rgba(83,83,95,0.55)]"
                data-testid="chat-slow-mode-progress"
                role="progressbar"
              >
                <div
                  className={`h-full transition-[width] duration-200 ease-linear ${
                    platform === "twitch" ? "bg-[#a970ff]" : "bg-[#53FC18]"
                  }`}
                  style={{ width: `${slowModeProgressValue}%` }}
                />
              </div>
            )}
          </div>

          {/* Footer actions. The second row is only chat settings + submit. */}
          <div
            data-testid="chat-input-action-row"
            className={`relative flex items-center gap-2 animate-slide-and-fade-in ${
              showSlowModeCountdown ? "justify-between" : "justify-end"
            }`}
          >
            {showSlowModeCountdown && (
              <p
                className="min-w-0 flex-1 truncate text-base font-bold leading-6 text-[#efeff1]"
                data-testid="chat-slow-mode-countdown"
              >
                You can chat in {formatSlowModeWait(slowModeRemainingSeconds)}
              </p>
            )}
            <div className="flex items-center gap-2">
              {showModViewLink ? (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Link
                      to={platform === "twitch" ? "/mod/twitch/$channel" : "/mod/kick/$channel"}
                      params={{ channel }}
                      data-testid="chat-mod-view-link"
                      aria-label="Open channel moderation page"
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#191919] ${
                        platform === "twitch"
                          ? "border-[#9146FF]/40 bg-[#9146FF]/15 text-[#a970ff] hover:bg-[#9146FF]/25"
                          : "border-[#53FC18]/40 bg-[#53FC18]/15 text-[#53FC18] hover:bg-[#53FC18]/25"
                      }`}
                    >
                      <LuShield className="h-4 w-4" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className={TWITCH_CHAT_ACTION_TOOLTIP_CLASS}
                    arrowClassName={TWITCH_CHAT_ACTION_TOOLTIP_ARROW_CLASS}
                  >
                    Mod View
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    ref={settingsButtonRef}
                    type="button"
                    onClick={() => setShowChatSettings((v) => !v)}
                    aria-label="Chat settings"
                    aria-expanded={showChatSettings}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white transition-colors duration-150 hover:bg-[#232629] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#191919]"
                  >
                    <BsGear size={18} style={{ stroke: "currentColor", strokeWidth: 0.45 }} />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className={TWITCH_CHAT_ACTION_TOOLTIP_CLASS}
                  arrowClassName={TWITCH_CHAT_ACTION_TOOLTIP_ARROW_CLASS}
                >
                  Chat settings
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                onClick={handleSend}
                disabled={submitDisabled}
                aria-disabled={!canSubmit}
                className={`h-[38px] flex-shrink-0 cursor-pointer rounded-[4px] bg-white px-4 text-sm font-bold text-[#0f0f0f] transition-opacity duration-150 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#191919] disabled:cursor-not-allowed ${
                  shouldDimSubmit ? "opacity-40" : ""
                }`}
              >
                Chat
              </button>
            </div>
            {showChatSettings && (
              <ChatQuickSettingsPopover
                platform={platform}
                placement="top"
                triggerRef={settingsButtonRef}
                onClose={() => setShowChatSettings(false)}
              />
            )}
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

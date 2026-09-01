/**
 * ChatInput tests — U9 layout.
 *
 * The new ChatInput hosts InfoBanner + two emote buttons (each with its own
 * EmotePickerPopover), the quick settings gear, and the footer Chat button.
 * We mock InfoBanner and popovers at the module boundary to keep these tests
 * focused on the input shell + wiring; the real components have their own
 * test suites.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const toastErrorMock = vi.hoisted(() => vi.fn());
const twitchChatListeners = vi.hoisted(() => new Map<string, Set<(event: unknown) => void>>());

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href="#" data-to={to} data-params={JSON.stringify(params ?? {})} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

const emotePickerPopoverCalls = vi.hoisted(
  () =>
    [] as Array<{
      isOpen: boolean;
      scope: "native" | "thirdParty";
      anchorRef: { current: HTMLElement | null };
    }>
);
const quickSettingsPopoverCalls = vi.hoisted(
  () =>
    [] as Array<{
      platform?: "kick" | "twitch";
      placement?: "bottom" | "top";
      triggerRef?: { current: HTMLElement | null };
    }>
);
const nativePickerEmote = vi.hoisted(() => ({
  id: "25",
  name: "Kappa",
  provider: "twitch" as const,
  urls: {
    url1x: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0",
    url2x: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0",
  },
  isGlobal: true,
  isAnimated: false,
}));
const thirdPartyPickerEmote = vi.hoisted(() => ({
  id: "7tv-1",
  name: "PogSeven",
  provider: "7tv" as const,
  urls: {
    url1x: "https://cdn.7tv.app/emote/7tv-1/1x.webp",
    url2x: "https://cdn.7tv.app/emote/7tv-1/2x.webp",
  },
  isGlobal: true,
  isAnimated: false,
  isZeroWidth: false,
}));
const mentionAutocompleteCtl = vi.hoisted(() => ({
  isActive: false,
  openAutocomplete: vi.fn(),
  closeAutocomplete: vi.fn(),
  deactivate: vi.fn(),
  checkTrigger: vi.fn(),
}));
const emoteStoreState = vi.hoisted(() => ({
  searchEmotes: () => [],
  loadedGlobalPlatforms: new Set<"twitch" | "kick">(),
  loadedChannels: new Set<string>(),
  emoteRevision: 0,
  activeChannelId: null as string | null,
  favoriteEmotes: [],
  recentEmotes: [] as Array<{
    id: string;
    name: string;
    provider: "twitch" | "kick" | "7tv" | "bttv" | "ffz";
    urls: { url1x: string; url2x: string; url4x?: string };
    isGlobal: boolean;
    isAnimated: boolean;
    isZeroWidth: boolean;
  }>,
  recentEmotesByScope: {} as Record<string, Emote[]>,
  isLoading: false,
  getProviderEmotes: () => [],
  getEmotesByProvider: () => new Map(),
  getEmotesByProviderForChannel: (_channelId: string) => new Map(),
  getAllEmotes: () => [],
  addRecentEmote: vi.fn(),
  claimLegacyRecentEmotes: vi.fn(),
  toggleFavorite: vi.fn(),
  isFavorite: () => false,
}));

vi.mock("@backend/services/chat/kick-chat", () => ({
  KickChatSendError: class KickChatSendError extends Error {
    kickSendResult: {
      ok: false;
      kind: string;
      message: string;
      retryAfterSeconds?: number;
    };

    constructor(result: { ok: false; kind: string; message: string; retryAfterSeconds?: number }) {
      super(result.message);
      this.name = "KickChatSendError";
      this.kickSendResult = result;
    }
  },
  kickChatService: {
    sendMessage: vi.fn(async () => true),
    sendAction: vi.fn(async () => true),
  },
}));
vi.mock("@backend/services/chat/twitch-chat", () => ({
  twitchChatService: {
    sendMessage: vi.fn(async () => true),
    sendAction: vi.fn(async () => true),
    sendReply: vi.fn(async () => true),
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      const listeners = twitchChatListeners.get(event) ?? new Set();
      listeners.add(listener);
      twitchChatListeners.set(event, listeners);
    }),
    off: vi.fn((event: string, listener: (payload: unknown) => void) => {
      twitchChatListeners.get(event)?.delete(listener);
    }),
    emit: vi.fn((event: string, payload: unknown) => {
      twitchChatListeners.get(event)?.forEach((listener) => listener(payload));
    }),
  },
}));

vi.mock("@/store/chat-store", () => ({
  useChatStore: () => ({ messagesByChannel: {} }),
}));

// Selector-capable zustand mock — mirrors EmotePicker.test.tsx so any
// `useEmoteStore((s) => s.foo)` calls inside EmotePickerPopover (or
// descendants) don't blow up under the mock. We mock EmotePickerPopover
// itself for the open-state assertions below — the real component has its
// own behavior tests.
vi.mock("@/store/emote-store", () => {
  // ChatInput now reads emotes for inline rendering via
  // `useEmoteStore.getState().getAllEmotes()` and resubscribes via
  // `useEmoteStore.subscribe(refresh)` — the selector-callable shape alone
  // isn't enough.
  const useEmoteStore = ((selector?: (s: typeof emoteStoreState) => unknown) =>
    selector ? selector(emoteStoreState) : emoteStoreState) as ((
    selector?: (s: typeof emoteStoreState) => unknown
  ) => unknown) & {
    getState: () => typeof emoteStoreState;
    subscribe: (fn: (s: typeof emoteStoreState) => void) => () => void;
  };
  useEmoteStore.getState = () => emoteStoreState;
  useEmoteStore.subscribe = () => () => {};
  return {
    getEmoteViewerScopeKey: ({
      platform,
      userId,
    }: {
      platform: "twitch" | "kick";
      userId: string | null;
    }) => `${platform}:${userId ?? "guest"}`,
    useEmoteStore,
  };
});

// Mock InfoBanner — we control its visibility per test via the impl.
const infoBannerImpl = vi.fn();
vi.mock("@/features/chat/components/chat/InfoBanner", () => ({
  InfoBanner: (props: {
    platform: string;
    channelId: string | null;
    viewerSatisfiesFollowerOnly?: boolean;
  }) => infoBannerImpl(props) ?? null,
}));

// Mock EmotePickerPopover so we can assert open/closed state without pulling
// in the popover's portal positioning / shallow-zustand wiring.
vi.mock("@/features/chat/components/chat/EmotePickerPopover", () => ({
  EmotePickerPopover: ({
    isOpen,
    scope,
    anchorRef,
    onSelect,
  }: {
    isOpen: boolean;
    scope: "native" | "thirdParty";
    onClose: () => void;
    onSelect: (emote: typeof nativePickerEmote | typeof thirdPartyPickerEmote) => void;
    anchorRef: { current: HTMLElement | null };
  }) => {
    emotePickerPopoverCalls.push({ isOpen, scope, anchorRef });
    const emote = scope === "thirdParty" ? thirdPartyPickerEmote : nativePickerEmote;
    return isOpen ? (
      <div data-testid={`emote-picker-popover-${scope}`}>
        <button type="button" onClick={() => onSelect(emote)}>
          Select {emote.name}
        </button>
      </div>
    ) : null;
  },
}));

vi.mock("@/features/chat/components/chat/ChatQuickSettingsPopover", () => ({
  ChatQuickSettingsPopover: (props: {
    platform?: "kick" | "twitch";
    placement?: "bottom" | "top";
    triggerRef?: { current: HTMLElement | null };
  }) => {
    quickSettingsPopoverCalls.push(props);
    return <div data-testid="chat-quick-settings-popover" />;
  },
}));

// Both emote buttons now look up the channel avatar for the picker's
// channel-tab thumbnail. Stub the hook so we don't need a QueryClientProvider
// in this shell-focused suite.
vi.mock("@/features/discovery/data/queries/useChannels", () => ({
  useChannelByUsername: () => ({ data: undefined }),
}));

vi.mock("@/features/chat/components/chat/MentionAutocomplete", () => {
  return {
    MentionAutocomplete: ({ isActive }: { isActive: boolean }) =>
      isActive ? <div data-testid="mention-autocomplete-anchor" /> : null,
  };
});

vi.mock("@/features/chat/components/chat/mention-suggestions", () => {
  return {
    getMentionSuggestions: ({
      inputValue,
      cursorPosition,
    }: {
      inputValue: string;
      cursorPosition: number;
    }) =>
      mentionAutocompleteCtl.isActive
        ? {
            match: { start: 0, end: cursorPosition, query: inputValue },
            suggestions: [],
          }
        : { match: null, suggestions: [] },
  };
});

import type { UnifiedChannel } from "@shared/platform-types";
import {
  loadKickChatModule,
  loadTwitchChatModule,
} from "@backend/services/chat/chat-service-loader";
import { KickChatSendError, kickChatService } from "@backend/services/chat/kick-chat";
import { twitchChatService } from "@backend/services/chat/twitch-chat";
import type { Emote, EmoteProvider } from "@backend/services/emotes/emote-types";
import { ChatInput, type ChatInputHandle } from "@/features/chat/components/chat/ChatInput";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES, DEFAULT_USER_PREFERENCES } from "@shared/auth-types";
import type { ChatMessage } from "@shared/chat-types";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { useRoomStateStore } from "@/store/room-state-store";

beforeAll(async () => {
  await Promise.all([loadKickChatModule(), loadTwitchChatModule()]);
});

beforeEach(() => {
  emotePickerPopoverCalls.length = 0;
  quickSettingsPopoverCalls.length = 0;
  emoteStoreState.loadedGlobalPlatforms = new Set();
  emoteStoreState.loadedChannels = new Set();
  emoteStoreState.emoteRevision = 0;
  emoteStoreState.activeChannelId = null;
  emoteStoreState.favoriteEmotes = [];
  emoteStoreState.recentEmotes = [];
  emoteStoreState.recentEmotesByScope = {};
  emoteStoreState.getEmotesByProvider = () => new Map();
  emoteStoreState.getEmotesByProviderForChannel = () => new Map();
  emoteStoreState.getAllEmotes = () => [];
  emoteStoreState.addRecentEmote.mockClear();
  emoteStoreState.claimLegacyRecentEmotes.mockClear();
  emoteStoreState.toggleFavorite.mockClear();
  toastErrorMock.mockReset();
  vi.mocked(twitchChatService.sendMessage).mockClear();
  vi.mocked(twitchChatService.sendReply).mockClear();
  vi.mocked(twitchChatService.sendAction).mockClear();
  twitchChatListeners.clear();
  vi.mocked(kickChatService.sendMessage).mockClear();
  useRoomStateStore.setState({ entries: {} });
  useFollowStore.setState({ localFollows: [], sourceByKey: new Map() });
  infoBannerImpl.mockReset();
  mentionAutocompleteCtl.isActive = false;
  mentionAutocompleteCtl.openAutocomplete.mockClear();
  mentionAutocompleteCtl.closeAutocomplete.mockClear();
  mentionAutocompleteCtl.deactivate.mockClear();
  mentionAutocompleteCtl.checkTrigger.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "electronAPI");
});

function renderWithTooltipProvider(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function renderInput(overrides: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  return renderWithTooltipProvider(
    <ChatInput channel="ninja" platform="twitch" channelId="12345" {...overrides} />
  );
}

function makeQuickEmote(
  partial: Partial<Emote> & { id: string; name: string; provider: EmoteProvider }
): Emote {
  return {
    id: partial.id,
    name: partial.name,
    provider: partial.provider,
    isGlobal: partial.isGlobal ?? true,
    availability: partial.availability,
    isAnimated: partial.isAnimated ?? false,
    isZeroWidth: partial.isZeroWidth ?? false,
    urls: partial.urls ?? {
      url1x: `https://example.test/${partial.id}/1x.webp`,
      url2x: `https://example.test/${partial.id}/2x.webp`,
    },
    kickSection: partial.kickSection,
    subscribersOnly: partial.subscribersOnly,
  };
}

function makeFollowedChannel(partial: Partial<UnifiedChannel> = {}): UnifiedChannel {
  return {
    id: partial.id ?? "12345",
    platform: partial.platform ?? "twitch",
    username: partial.username ?? "ninja",
    displayName: partial.displayName ?? "Ninja",
    avatarUrl: partial.avatarUrl ?? "https://example.test/avatar.png",
    isLive: partial.isLive ?? true,
    isVerified: partial.isVerified ?? true,
    isPartner: partial.isPartner ?? true,
    ...partial,
  };
}

function getEditor(name: RegExp | string = /send a message/i) {
  return screen.getByRole("textbox", { name });
}

function typeInEditor(editor: HTMLElement, text: string) {
  editor.textContent = text;
  fireEvent.input(editor);
}

function setCaretAtTextEnd(editor: HTMLElement) {
  const text = editor.firstChild;
  if (!text) return;
  const range = document.createRange();
  range.setStart(text, text.textContent?.length ?? 0);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function selectEditorText(editor: HTMLElement, start: number, end: number) {
  const text = editor.firstChild;
  if (!text) return;
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

// Guards: moderation routes use the active platform and stay hidden without moderator authority.
// Guards: the rich editor preserves selection, deletion, scrolling, and reply payload behavior.
describe("ChatInput — basics", () => {
  it("hides the moderation page shield by default", () => {
    renderInput();
    expect(screen.queryByTestId("chat-mod-view-link")).not.toBeInTheDocument();
  });

  it("renders a Twitch moderation page shield when allowed", () => {
    renderInput({ showModViewLink: true });
    const link = screen.getByTestId("chat-mod-view-link");
    expect(link).toHaveAttribute("data-to", "/mod/twitch/$channel");
    expect(link).toHaveAttribute("data-params", JSON.stringify({ channel: "ninja" }));
  });

  it("renders a Kick moderation page shield when allowed", () => {
    renderInput({ platform: "kick", showModViewLink: true });
    const link = screen.getByTestId("chat-mod-view-link");
    expect(link).toHaveAttribute("data-to", "/mod/kick/$channel");
    expect(link).toHaveAttribute("data-params", JSON.stringify({ channel: "ninja" }));
  });

  it("accepts keyboard text insertion from an empty rich editor", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const editor = getEditor();

    act(() => {
      editor.focus();
      fireEvent.keyDown(editor, { key: "a" });
      fireEvent.keyDown(editor, { key: "b" });
    });

    expect(editor).toHaveTextContent("ab");
  });

  it("scrolls the rich editor to the bottom as typing extends the draft", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const editor = getEditor();
    Object.defineProperty(editor, "scrollHeight", { configurable: true, value: 240 });
    Object.defineProperty(editor, "clientHeight", { configurable: true, value: 80 });
    editor.scrollTop = 0;

    act(() => {
      editor.focus();
      fireEvent.keyDown(editor, { key: "a" });
    });

    expect(editor.scrollTop).toBe(240);
  });

  it("deletes regular text with one Backspace", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const editor = getEditor();

    act(() => {
      editor.focus();
      fireEvent.keyDown(editor, { key: "a" });
      fireEvent.keyDown(editor, { key: "b" });
      fireEvent.keyDown(editor, { key: "Backspace" });
    });

    expect(editor).toHaveTextContent("a");
  });

  it("deletes a highlighted long draft with one Backspace", async () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const editor = getEditor();
    const longDraft = "x".repeat(650);

    typeInEditor(editor, longDraft);
    await waitFor(() => expect(screen.getByText("-150")).toBeInTheDocument());
    act(() => {
      editor.focus();
    });
    selectEditorText(editor, 0, longDraft.length);
    act(() => {
      fireEvent.keyDown(editor, { key: "Backspace" });
    });

    expect(editor.textContent).toBe("");
    expect(screen.getByText("Send a message...")).toBeInTheDocument();
  });

  it("preserves a highlighted partial selection through focus before Backspace", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const editor = getEditor();

    typeInEditor(editor, "abcdef");
    selectEditorText(editor, 1, 5);

    act(() => {
      fireEvent.focus(editor);
      fireEvent.keyDown(editor, { key: "Backspace" });
    });

    expect(editor.textContent).toBe("af");
  });

  it("keeps a small highlighted selection visible after mouse selection completes", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const editor = getEditor();

    typeInEditor(editor, "abcdef");
    selectEditorText(editor, 1, 5);
    fireEvent.mouseUp(editor);

    const selection = window.getSelection();
    expect(selection?.rangeCount).toBe(1);
    expect(selection?.getRangeAt(0).toString()).toBe("bcde");
  });

  it("deletes a large highlighted selection after mouse selection completes", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const editor = getEditor();
    const prefix = "keep-start ";
    const highlighted = "x".repeat(240);
    const suffix = " keep-end";

    typeInEditor(editor, `${prefix}${highlighted}${suffix}`);
    selectEditorText(editor, prefix.length, prefix.length + highlighted.length);
    fireEvent.mouseUp(editor);

    const selection = window.getSelection();
    expect(selection?.getRangeAt(0).toString()).toBe(highlighted);

    fireEvent.keyDown(editor, { key: "Backspace" });

    expect(editor.textContent).toBe(`${prefix}${suffix}`);
  });

  it("respects the disabled prop", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ disabled: true });
    expect(getEditor()).toHaveAttribute("aria-disabled", "true");
    expect(getEditor()).toHaveAttribute("contenteditable", "false");
  });

  it("keeps reply state when the login surface opens auth", async () => {
    infoBannerImpl.mockReturnValue(null);
    const onAuthRequired = vi.fn(async () => {});
    const ref = createRef<ChatInputHandle>();
    renderWithTooltipProvider(
      <ChatInput
        ref={ref}
        channel="ninja"
        platform="twitch"
        channelId="12345"
        canSend={false}
        isAuthenticated={false}
        onAuthRequired={onAuthRequired}
      />
    );
    const msg: ChatMessage = {
      id: "m1",
      platform: "twitch",
      type: "message",
      channel: "ninja",
      userId: "u1",
      username: "alice",
      displayName: "Alice",
      color: "#fff",
      badges: [],
      content: [{ type: "text", content: "hello" }],
      rawContent: "hello there",
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };
    act(() => ref.current?.replyTo(msg));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Log in to chat" }));
    });

    expect(onAuthRequired).toHaveBeenCalledWith("twitch");
    expect(screen.getByTestId("reply-preview")).toBeInTheDocument();
  });

  // Guards: reply sends must include the visible @username in both the wire message and optimistic echo; otherwise it only appears after chat refresh.
  it("sends Twitch replies with the parent username visible in the message", async () => {
    infoBannerImpl.mockReturnValue(null);
    const ref = createRef<ChatInputHandle>();
    renderWithTooltipProvider(
      <ChatInput
        ref={ref}
        channel="ninja"
        platform="twitch"
        channelId="12345"
        canSend
        isAuthenticated
      />
    );
    const msg: ChatMessage = {
      id: "m1",
      platform: "twitch",
      type: "message",
      channel: "ninja",
      userId: "u1",
      username: "alice",
      displayName: "Alice",
      color: "#fff",
      badges: [],
      content: [{ type: "text", content: "hello" }],
      rawContent: "hello there",
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };
    act(() => ref.current?.replyTo(msg));
    const editor = getEditor();
    typeInEditor(editor, "reply draft");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(twitchChatService.sendReply).toHaveBeenCalledWith("ninja", "m1", "@alice reply draft", [
      { type: "mention", username: "alice" },
      { type: "text", content: " reply draft" },
    ]);
  });

  // Guards: reply sends must include the visible @username in both the wire message and optimistic echo; otherwise it only appears after chat refresh.
  it("sends Kick replies with reply metadata and the parent username visible in the optimistic echo", async () => {
    infoBannerImpl.mockReturnValue(null);
    const ref = createRef<ChatInputHandle>();
    renderWithTooltipProvider(
      <ChatInput
        ref={ref}
        channel="ninja"
        platform="kick"
        channelId="12345"
        canSend
        isAuthenticated
      />
    );
    const msg: ChatMessage = {
      id: "m1",
      platform: "kick",
      type: "message",
      channel: "ninja",
      userId: "u1",
      username: "alice",
      displayName: "Alice",
      color: "#fff",
      badges: [],
      content: [{ type: "text", content: "hello" }],
      rawContent: "hello there",
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };
    act(() => ref.current?.replyTo(msg));
    const editor = getEditor();
    typeInEditor(editor, "reply draft");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(kickChatService.sendMessage).toHaveBeenCalledWith(
      "ninja",
      "@alice reply draft",
      undefined,
      [
        { type: "mention", username: "alice" },
        { type: "text", content: " reply draft" },
      ],
      {
        parentMessageId: "m1",
        parentUserId: "u1",
        parentUsername: "alice",
        parentDisplayName: "Alice",
        parentMessageBody: "hello there",
      }
    );
  });
});

// Guards: a focused composer cannot accept key or paste mutations after auth changes to guest mode.
// Guards: Twitch and Kick guests get a keyboard-accessible login surface with consistent copy.
// Guards: guest login masks draft chrome while preserving the draft for auth recovery.
describe("ChatInput - guest authentication gate", () => {
  it.each(["twitch", "kick"] as const)(
    "uses the same guest login button copy on %s",
    (platform) => {
      renderInput({ platform, canSend: false, isAuthenticated: false });

      expect(screen.getAllByRole("button", { name: "Log in to chat" })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Sign in to chat" })).not.toBeInTheDocument();
    }
  );

  it("does not accept keyboard text after a focused composer becomes guest-only", () => {
    const { rerender } = renderInput({ canSend: true, isAuthenticated: true });
    const editor = getEditor();
    typeInEditor(editor, "draft");
    act(() => editor.focus());

    rerender(
      <TooltipProvider>
        <ChatInput
          channel="ninja"
          platform="twitch"
          channelId="12345"
          canSend={false}
          isAuthenticated={false}
        />
      </TooltipProvider>
    );

    expect(screen.getByRole("button", { name: "Log in to chat" })).toHaveFocus();
    const lockedEditor = screen.getByTestId("chat-rich-input");
    fireEvent.keyDown(lockedEditor, { key: "x" });

    expect(lockedEditor.textContent).toBe("draft");
  });

  it("does not accept pasted text after a focused composer becomes guest-only", () => {
    const { rerender } = renderInput({ canSend: true, isAuthenticated: true });
    const editor = getEditor();
    typeInEditor(editor, "draft");
    act(() => editor.focus());

    rerender(
      <TooltipProvider>
        <ChatInput
          channel="ninja"
          platform="twitch"
          channelId="12345"
          canSend={false}
          isAuthenticated={false}
        />
      </TooltipProvider>
    );

    const lockedEditor = screen.getByTestId("chat-rich-input");
    fireEvent.paste(lockedEditor, {
      clipboardData: { getData: () => " pasted" },
    });

    expect(lockedEditor.textContent).toBe("draft");
  });

  it("fully masks draft chrome in guest mode without discarding the draft", () => {
    const { rerender } = renderInput({
      canSend: true,
      isAuthenticated: true,
      maxLength: 100,
    });
    typeInEditor(getEditor(), "draft");
    expect(screen.getByText("95")).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <ChatInput
          channel="ninja"
          platform="twitch"
          channelId="12345"
          canSend={false}
          isAuthenticated={false}
          maxLength={100}
        />
      </TooltipProvider>
    );

    expect(screen.getByRole("button", { name: "Log in to chat" })).toHaveClass("bg-[#191919]");
    expect(screen.queryByText("95")).not.toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <ChatInput
          channel="ninja"
          platform="twitch"
          channelId="12345"
          canSend
          isAuthenticated
          maxLength={100}
        />
      </TooltipProvider>
    );

    expect(getEditor().textContent).toBe("draft");
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("uses a clickable Twitch login surface while the underlying composer stays inert", async () => {
    const onAuthRequired = vi.fn();

    renderInput({
      platform: "twitch",
      canSend: false,
      isAuthenticated: false,
      onAuthRequired,
    });

    const editor = screen.getByTestId("chat-rich-input");
    expect(editor).toHaveAttribute("contenteditable", "false");
    expect(editor).toHaveAttribute("aria-readonly", "true");

    await act(async () => {
      fireEvent.click(editor);
    });
    expect(onAuthRequired).not.toHaveBeenCalled();

    const loginButton = screen.getByRole("button", { name: "Log in to chat" });
    await act(async () => {
      fireEvent.click(loginButton);
    });
    expect(onAuthRequired).toHaveBeenCalledWith("twitch");
  });

  it("uses a keyboard-accessible Kick login surface", async () => {
    const onAuthRequired = vi.fn();
    const user = userEvent.setup({ delay: null });

    renderInput({
      platform: "kick",
      canSend: false,
      isAuthenticated: false,
      onAuthRequired,
    });

    const editor = screen.getByTestId("chat-rich-input");
    expect(editor).toHaveAttribute("contenteditable", "false");
    expect(editor).toHaveAttribute("aria-readonly", "true");

    const loginButton = screen.getByRole("button", { name: "Log in to chat" });
    loginButton.focus();
    await user.keyboard("{Enter}");

    expect(onAuthRequired).toHaveBeenCalledWith("kick");
  });
});

// Guards: room-state send blockers must preserve draft editing and reuse the existing InfoBanner surface.
describe("ChatInput — room-state send blockers", () => {
  it("publishes the same reactive send eligibility consumed by selected-message Reply", async () => {
    const onSendEligibilityChange = vi.fn();
    const { rerender } = renderInput({
      isAuthenticated: true,
      canSend: false,
      onSendEligibilityChange,
    });

    await waitFor(() =>
      expect(onSendEligibilityChange).toHaveBeenLastCalledWith({
        state: "ineligible",
        reason: "Chat is reconnecting",
      })
    );

    rerender(
      <TooltipProvider>
        <ChatInput
          channel="ninja"
          platform="twitch"
          channelId="12345"
          isAuthenticated
          canSend
          onSendEligibilityChange={onSendEligibilityChange}
        />
      </TooltipProvider>
    );
    await waitFor(() =>
      expect(onSendEligibilityChange).toHaveBeenLastCalledWith({ state: "eligible" })
    );

    act(() => {
      useRoomStateStore.getState().updateRoomState("twitch", "12345", { followersOnly: 10 });
    });
    await waitFor(() =>
      expect(onSendEligibilityChange).toHaveBeenLastCalledWith({
        state: "ineligible",
        reason: "Followers-only chat is enabled",
      })
    );
  });

  it("blocks follower-only sends without rendering a duplicate blocker row", async () => {
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Followers Only Mode</div>);
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { followersOnly: 10 });
    renderInput({ isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "hello followers");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId("info-banner-stub")).toHaveTextContent("Followers Only Mode");
    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
    expect(editor).toHaveTextContent("hello followers");
    expect(document.activeElement).toBe(editor);
  });

  it("blocks non-emote messages in emote-only mode without rendering a duplicate blocker row", async () => {
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Emote Only Mode</div>);
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { emoteOnly: true });
    renderInput({ isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "plain text");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId("info-banner-stub")).toHaveTextContent("Emote Only Mode");
    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
    expect(editor).toHaveTextContent("plain text");
  });

  it("prioritizes follower-only over emote-only when both modes are active", async () => {
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Followers Only Mode</div>);
    useRoomStateStore
      .getState()
      .updateRoomState("twitch", "12345", { followersOnly: 0, emoteOnly: true });
    renderInput({ isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "plain text");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId("info-banner-stub")).toHaveTextContent("Followers Only Mode");
    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
  });

  it("does not pre-block follower-only mode when the viewer follows the channel", async () => {
    infoBannerImpl.mockReturnValue(null);
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { followersOnly: 10 });
    useFollowStore.setState({
      localFollows: [makeFollowedChannel()],
      sourceByKey: new Map([["twitch:12345", "twitch"]]),
    });
    renderInput({ isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "followed message");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(twitchChatService.sendMessage).toHaveBeenCalledWith("ninja", "followed message", [
      { type: "text", content: "followed message" },
    ]);
    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
  });

  it("does not pre-block known room-mode bypass roles", async () => {
    infoBannerImpl.mockReturnValue(null);
    useRoomStateStore
      .getState()
      .updateRoomState("twitch", "12345", { followersOnly: 10, emoteOnly: true });
    renderInput({ isAuthenticated: true, canSend: true, viewerCanBypassRoomModes: true });
    const editor = getEditor();
    typeInEditor(editor, "mod message");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(twitchChatService.sendMessage).toHaveBeenCalledWith("ninja", "mod message", [
      { type: "text", content: "mod message" },
    ]);
    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
  });

  it("keeps reply state and inserted emote slots when room-state blocks a send", async () => {
    infoBannerImpl.mockReturnValue(null);
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { followersOnly: 10 });
    const ref = createRef<ChatInputHandle>();
    renderWithTooltipProvider(
      <ChatInput
        ref={ref}
        channel="ninja"
        platform="twitch"
        channelId="12345"
        isAuthenticated={true}
        canSend={true}
      />
    );
    const msg: ChatMessage = {
      id: "m2",
      platform: "twitch",
      type: "message",
      channel: "ninja",
      userId: "u2",
      username: "bob",
      displayName: "Bob",
      color: "#fff",
      badges: [],
      content: [{ type: "text", content: "hello" }],
      rawContent: "hello",
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };

    act(() => ref.current?.replyTo(msg));
    fireEvent.click(screen.getByTestId("native-emote-button"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select Kappa" }));
    });
    const editor = getEditor();
    await waitFor(() => {
      expect(editor.querySelector("[data-chat-emote-node='true']")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(twitchChatService.sendReply).not.toHaveBeenCalled();
    expect(screen.getByTestId("reply-preview")).toBeInTheDocument();
    expect(editor.querySelector("[data-chat-emote-node='true']")).toBeInTheDocument();
  });
});

// Guards: subscriber-only preflight blocks only on definite platform results and keeps unknown states sendable.
describe("ChatInput — subscriber-only preflight", () => {
  // Guards: failed subscriber verification releases the send guard and keeps the draft editable.
  it("keeps the draft and surfaces an error when subscriber verification fails", async () => {
    infoBannerImpl.mockReturnValue(null);
    const checkSubscriberEligibility = vi.fn().mockRejectedValue(new Error("Eligibility failed"));
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { subscribersOnly: true });
    renderInput({ isAuthenticated: true, canSend: true, checkSubscriberEligibility });
    const editor = getEditor();
    typeInEditor(editor, "keep this");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(editor).toHaveTextContent("keep this");
    expect(screen.getByText("Eligibility failed")).toBeInTheDocument();
    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
  });

  it("discards a late subscriber result after the composer changes channels", async () => {
    let resolveEligibility: ((result: { status: "notSubscribed" }) => void) | undefined;
    const checkSubscriberEligibility = vi.fn(
      () =>
        new Promise<{ status: "notSubscribed" }>((resolve) => {
          resolveEligibility = resolve;
        })
    );
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { subscribersOnly: true });
    const { rerender } = renderInput({
      isAuthenticated: true,
      canSend: true,
      checkSubscriberEligibility,
    });
    const editor = getEditor();
    typeInEditor(editor, "must not leak channels");

    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => expect(checkSubscriberEligibility).toHaveBeenCalledOnce());

    rerender(
      <TooltipProvider>
        <ChatInput
          channel="shroud"
          platform="twitch"
          channelId="67890"
          isAuthenticated
          canSend
          checkSubscriberEligibility={checkSubscriberEligibility}
        />
      </TooltipProvider>
    );
    await act(async () => {
      resolveEligibility?.({ status: "notSubscribed" });
    });

    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
  });

  it("blocks Twitch subscriber-only sends when preflight says the viewer is not subscribed", async () => {
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Subscribers Only Mode</div>);
    const checkSubscriberEligibility = vi.fn(async () => ({ status: "notSubscribed" as const }));
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { subscribersOnly: true });
    renderInput({ isAuthenticated: true, canSend: true, checkSubscriberEligibility });
    const editor = getEditor();
    typeInEditor(editor, "sub check");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(checkSubscriberEligibility).toHaveBeenCalledWith({
      platform: "twitch",
      channel: "ninja",
      channelId: "12345",
    });
    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId("info-banner-stub")).toHaveTextContent("Subscribers Only Mode");
    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
    expect(editor).toHaveTextContent("sub check");
  });

  it("shows a reconnect blocker when Twitch subscriber preflight is missing scopes", async () => {
    infoBannerImpl.mockReturnValue(null);
    const checkSubscriberEligibility = vi.fn(async () => ({
      status: "missingScopes" as const,
      missingScopes: ["user:read:subscriptions"],
    }));
    const onAuthRequired = vi.fn(async () => {});
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { subscribersOnly: true });
    renderInput({
      isAuthenticated: true,
      canSend: true,
      checkSubscriberEligibility,
      onAuthRequired,
    });
    const editor = getEditor();
    typeInEditor(editor, "scope check");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-send-blocker")).toHaveTextContent(
      "Reconnect Twitch to check subscriber-only chat"
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reconnect twitch/i }));
    });

    expect(onAuthRequired).toHaveBeenCalledWith("twitch");
    expect(editor).toHaveTextContent("scope check");
  });

  it("allows Kick subscriber-only sends when preflight is unknown", async () => {
    infoBannerImpl.mockReturnValue(null);
    const checkSubscriberEligibility = vi.fn(async () => ({ status: "unknown" as const }));
    useRoomStateStore.getState().updateRoomState("kick", "12345", { subscribersOnly: true });
    renderInput({
      platform: "kick",
      isAuthenticated: true,
      canSend: true,
      checkSubscriberEligibility,
    });
    const editor = getEditor();
    typeInEditor(editor, "unknown should send");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(checkSubscriberEligibility).toHaveBeenCalledWith({
      platform: "kick",
      channel: "ninja",
      channelId: "12345",
    });
    expect(kickChatService.sendMessage).toHaveBeenCalledWith(
      "ninja",
      "unknown should send",
      undefined,
      [{ type: "text", content: "unknown should send" }]
    );
    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
  });

  it("blocks Kick subscriber-only sends when preflight says not subscribed", async () => {
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Subscribers Only Mode</div>);
    const checkSubscriberEligibility = vi.fn(async () => ({ status: "notSubscribed" as const }));
    useRoomStateStore.getState().updateRoomState("kick", "12345", { subscribersOnly: true });
    renderInput({
      platform: "kick",
      isAuthenticated: true,
      canSend: true,
      checkSubscriberEligibility,
    });
    const editor = getEditor();
    typeInEditor(editor, "kick sub check");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(kickChatService.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId("info-banner-stub")).toHaveTextContent("Subscribers Only Mode");
    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
  });
});

// Guards: platform send rejections become the same single blocker banner as preflight restrictions.
// Guards: authoritative room-mode changes promptly remove stale send blockers.
// Guards: switching channels cannot inherit a room-mode blocker from the prior channel.
// Guards: viewer bans replace room-mode banners with an unambiguous banned-from-chat banner.
describe("ChatInput — send rejection blockers", () => {
  it("shows only the banned-from-chat banner and blocks Twitch retries", async () => {
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Emote Only Mode</div>);
    renderInput({ isAuthenticated: true, canSend: true, viewerUserId: "viewer-1" });

    act(() => {
      twitchChatService.emit("viewerSendRestriction", {
        platform: "twitch",
        channel: "ninja",
        channelId: "12345",
        restriction: "banned",
      });
    });

    expect(screen.getByTestId("chat-send-blocker")).toHaveTextContent("You are banned from chat");
    expect(screen.queryByTestId("info-banner-stub")).toBeNull();

    const editor = getEditor();
    typeInEditor(editor, "retry message");
    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });
    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
  });

  it("turns a Kick forbidden send result into a banned-from-chat banner", async () => {
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Emote Only Mode</div>);
    vi.mocked(kickChatService.sendMessage).mockRejectedValueOnce(
      new KickChatSendError({
        ok: false,
        kind: "forbidden",
        message: "You are banned or timed out in this channel.",
      })
    );
    renderInput({ platform: "kick", isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "blocked message");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(screen.getByTestId("chat-send-blocker")).toHaveTextContent("You are banned from chat");
    expect(screen.queryByTestId("info-banner-stub")).toBeNull();
    expect(editor).toHaveTextContent("blocked message");
  });

  it("restores the rejected draft and blocks retries after Twitch reports phone verification", async () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ isAuthenticated: true, canSend: true, viewerUserId: "viewer-1" });
    const editor = getEditor();
    typeInEditor(editor, "phone gated");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });
    expect(editor).toHaveTextContent("");

    act(() => {
      twitchChatService.emit("viewerSendRestriction", {
        platform: "twitch",
        channel: "ninja",
        channelId: "12345",
        restriction: "verification",
        requirement: "phone",
      });
    });

    const blocker = screen.getByTestId("twitch-verification-card");
    expect(blocker).toHaveTextContent("Verified Accounts Only Chat");
    expect(blocker).toHaveTextContent("requires phone verification");
    expect(editor).toHaveTextContent("phone gated");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(twitchChatService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("ignores viewer restrictions emitted for another Twitch channel", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ isAuthenticated: true, canSend: true, viewerUserId: "viewer-1" });

    act(() => {
      twitchChatService.emit("viewerSendRestriction", {
        platform: "twitch",
        channel: "shroud",
        channelId: "67890",
        restriction: "verification",
        requirement: "phone",
      });
    });

    expect(screen.queryByTestId("twitch-verification-card")).toBeNull();
  });

  it("keeps the authoritative room-mode banner visible with the viewer blocker", () => {
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Slow Mode [30s]</div>);
    renderInput({ isAuthenticated: true, canSend: true, viewerUserId: "viewer-1" });

    act(() => {
      twitchChatService.emit("viewerSendRestriction", {
        platform: "twitch",
        channel: "ninja",
        channelId: "12345",
        restriction: "verification",
        requirement: "phone",
      });
    });

    expect(screen.getByTestId("info-banner-stub")).toHaveTextContent("Slow Mode [30s]");
    expect(screen.getByTestId("twitch-verification-card")).toBeInTheDocument();
  });

  it("clears the viewer restriction when the account or channel context changes", () => {
    infoBannerImpl.mockReturnValue(null);
    const { rerender } = renderInput({
      isAuthenticated: true,
      canSend: true,
      viewerUserId: "viewer-1",
    });

    act(() => {
      twitchChatService.emit("viewerSendRestriction", {
        platform: "twitch",
        channel: "ninja",
        channelId: "12345",
        restriction: "verification",
        requirement: "phone",
      });
    });
    expect(screen.getByTestId("twitch-verification-card")).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <ChatInput
          channel="ninja"
          platform="twitch"
          channelId="12345"
          isAuthenticated
          canSend
          viewerUserId="viewer-2"
        />
      </TooltipProvider>
    );
    expect(screen.queryByTestId("twitch-verification-card")).toBeNull();

    act(() => {
      twitchChatService.emit("viewerSendRestriction", {
        platform: "twitch",
        channel: "ninja",
        channelId: "12345",
        restriction: "verification",
        requirement: "phone",
      });
    });
    rerender(
      <TooltipProvider>
        <ChatInput
          channel="shroud"
          platform="twitch"
          channelId="67890"
          isAuthenticated
          canSend
          viewerUserId="viewer-2"
        />
      </TooltipProvider>
    );
    expect(screen.queryByTestId("twitch-verification-card")).toBeNull();
  });

  it("dismisses the blocker for one retry and shows it again after another rejection", async () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ isAuthenticated: true, canSend: true, viewerUserId: "viewer-1" });
    const editor = getEditor();

    act(() => {
      twitchChatService.emit("viewerSendRestriction", {
        platform: "twitch",
        channel: "ninja",
        channelId: "12345",
        restriction: "verification",
        requirement: "phone",
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss verification notice" }));
    expect(screen.queryByTestId("twitch-verification-card")).toBeNull();

    typeInEditor(editor, "retry me");
    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });
    expect(twitchChatService.sendMessage).toHaveBeenCalledOnce();

    act(() => {
      twitchChatService.emit("viewerSendRestriction", {
        platform: "twitch",
        channel: "ninja",
        channelId: "12345",
        restriction: "verification",
        requirement: "phone",
      });
    });
    expect(screen.getByTestId("twitch-verification-card")).toBeInTheDocument();
    expect(editor).toHaveTextContent("retry me");
  });

  it("opens Twitch security settings from Verify Account", async () => {
    infoBannerImpl.mockReturnValue(null);
    const openExternal = vi.fn(async () => {});
    window.electronAPI = { openExternal } as unknown as typeof window.electronAPI;
    renderInput({ isAuthenticated: true, canSend: true, viewerUserId: "viewer-1" });

    act(() => {
      twitchChatService.emit("viewerSendRestriction", {
        platform: "twitch",
        channel: "ninja",
        channelId: "12345",
        restriction: "verification",
        requirement: "phone",
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Verify Account" }));
    });

    expect(openExternal).toHaveBeenCalledWith("https://www.twitch.tv/settings/security");
  });

  it("uses the verification card when Twitch rejects the send promise", async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(twitchChatService.sendMessage).mockRejectedValueOnce(
      new Error("This room requires a verified email address to chat")
    );
    renderInput({ isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "email gated");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(screen.getByTestId("twitch-verification-card")).toHaveTextContent(
      "requires email verification"
    );
    expect(editor).toHaveTextContent("email gated");
  });

  it("uses Kick structured subscriber-only failures as a send blocker", async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(kickChatService.sendMessage).mockRejectedValueOnce(
      new KickChatSendError({
        ok: false,
        kind: "forbidden",
        message: "Subscribers-only chat is enabled",
      })
    );
    renderInput({ platform: "kick", isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "kick gated");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(screen.getByTestId("chat-send-blocker")).toHaveTextContent(
      "Subscribers-only chat is enabled"
    );
    expect(screen.getByRole("button", { name: /subscribe/i })).toBeInTheDocument();
    expect(editor).toHaveTextContent("kick gated");
  });

  it("removes a stale Kick subscribers-only blocker when the current room turns the mode off", async () => {
    infoBannerImpl.mockReturnValue(null);
    useRoomStateStore.getState().updateRoomState("kick", "12345", { subscribersOnly: true });
    vi.mocked(kickChatService.sendMessage).mockRejectedValueOnce(
      new KickChatSendError({
        ok: false,
        kind: "forbidden",
        message: "Subscribers-only chat is enabled",
      })
    );
    renderInput({ platform: "kick", isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "kick gated");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });
    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();

    act(() => {
      useRoomStateStore.getState().updateRoomState("kick", "12345", { subscribersOnly: false });
    });

    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
  });

  it("does not carry a Kick subscribers-only blocker into another channel", async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(kickChatService.sendMessage).mockRejectedValueOnce(
      new KickChatSendError({
        ok: false,
        kind: "forbidden",
        message: "Subscribers-only chat is enabled",
      })
    );
    const { rerender } = renderInput({
      platform: "kick",
      isAuthenticated: true,
      canSend: true,
    });
    const editor = getEditor();
    typeInEditor(editor, "kick gated");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });
    expect(screen.getByTestId("chat-send-blocker")).toHaveTextContent(
      "Subscribers-only chat is enabled"
    );

    rerender(
      <TooltipProvider>
        <ChatInput
          channel="another-channel"
          platform="kick"
          channelId="67890"
          isAuthenticated
          canSend
        />
      </TooltipProvider>
    );

    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
  });

  it("keeps ordinary send failures as inline errors", async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(twitchChatService.sendMessage).mockRejectedValueOnce(new Error("Network failed"));
    renderInput({ isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "still error");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
    expect(screen.getByText("Network failed")).toBeInTheDocument();
    expect(editor).toHaveTextContent("still error");
  });
});

// Guards: slow mode is enforced only after stricter blockers and preserves drafts while the cooldown runs.
describe("ChatInput — slow-mode cooldown", () => {
  it("starts a local slow-mode cooldown after a successful send", async () => {
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Slow Mode [5s]</div>);
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { slowMode: 5 });
    renderInput({ isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "first");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(twitchChatService.sendMessage).toHaveBeenCalledTimes(1);
    typeInEditor(editor, "second");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(twitchChatService.sendMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("info-banner-stub")).toHaveTextContent("Slow Mode [5s]");
    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
    expect(editor).toHaveTextContent("second");
  });

  it("renders a countdown progress bar while slow mode blocks the next send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z"));

    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Slow Mode [5s]</div>);
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { slowMode: 5 });
    renderInput({ isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "first");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    const progress = screen.getByRole("progressbar", {
      name: /slow mode cooldown/i,
    });
    expect(progress).toHaveAttribute("aria-valuenow", "100");
    const countdown = screen.getByTestId("chat-slow-mode-countdown");
    expect(countdown).toHaveTextContent("You can chat in 5s");
    expect(countdown).toHaveClass("text-base", "font-bold", "leading-6");
    expect(screen.getByTestId("chat-input-action-row")).toContainElement(countdown);

    typeInEditor(editor, "second");
    expect(screen.getByRole("button", { name: "Chat" })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(progress).toHaveAttribute("aria-valuenow", "50");
    expect(countdown).toHaveTextContent("You can chat in 3s");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(screen.queryByTestId("chat-slow-mode-progress")).toBeNull();
    expect(screen.queryByTestId("chat-slow-mode-countdown")).toBeNull();
  });

  it("places countdown text before the mod shortcut when the mod icon is visible", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z"));

    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Slow Mode [5s]</div>);
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { slowMode: 5 });
    renderInput({ isAuthenticated: true, canSend: true, showModViewLink: true });
    const editor = getEditor();
    typeInEditor(editor, "first");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    const countdown = screen.getByTestId("chat-slow-mode-countdown");
    const modLink = screen.getByTestId("chat-mod-view-link");
    expect(screen.getByTestId("chat-input-action-row")).toContainElement(countdown);
    expect(countdown.compareDocumentPosition(modLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("keeps emote-only ahead of slow mode in blocker priority", async () => {
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Emote Only Mode</div>);
    useRoomStateStore
      .getState()
      .updateRoomState("twitch", "12345", { emoteOnly: true, slowMode: 5 });
    renderInput({ isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "plain text");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId("info-banner-stub")).toHaveTextContent("Emote Only Mode");
    expect(screen.queryByTestId("chat-send-blocker")).toBeNull();
  });

  it("turns Kick retry-after send rejections into a slow-mode cooldown", async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(kickChatService.sendMessage).mockRejectedValueOnce(
      new KickChatSendError({
        ok: false,
        kind: "rate-limited",
        message: "Slow down - Kick rate limit.",
        retryAfterSeconds: 7,
      })
    );
    renderInput({ platform: "kick", isAuthenticated: true, canSend: true });
    const editor = getEditor();
    typeInEditor(editor, "too fast");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(screen.getByTestId("chat-send-blocker")).toHaveTextContent("Slow mode active. Wait 7s.");
    expect(editor).toHaveTextContent("too fast");
  });
});

// Guards: chat input footer keeps a platform-neutral white Chat submit button beside the white settings gear.
// Guards: footer Chat submit uses the same send path as Enter, so button-send and keyboard-send stay in sync.
// Guards: settings gear and Chat submit stay below the editor in a second row without moving emote pickers down.
// Guards: only the editor/emote row is outlined; footer actions stay outside the input box outline.
// Guards: authenticated quick settings opens directly above the quick-emote strip instead of floating over chat.
// Guards: guest quick settings opens directly above the login input when no account is connected.
describe("ChatInput — footer actions", () => {
  it("renders the old white settings gear next to a neutral Chat button", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const settingsButton = screen.getByRole("button", { name: /chat settings/i });
    expect(settingsButton).toHaveClass("text-white");
    expect(settingsButton).toHaveClass("h-8", "w-8", "rounded-full", "hover:bg-[#232629]");
    expect(settingsButton.querySelector("svg")?.style.stroke.toLowerCase()).toBe("currentcolor");
    expect(screen.getByRole("button", { name: "Chat" })).toHaveClass("bg-white", "text-[#0f0f0f]");
  });

  it("keeps the empty Chat button visually white while disabled", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const chatButton = screen.getByRole("button", { name: "Chat" });
    expect(chatButton).not.toBeDisabled();
    expect(chatButton).toHaveAttribute("aria-disabled", "true");
    expect(chatButton).toHaveClass("cursor-pointer");
    expect(chatButton).toHaveClass("bg-white", "text-[#0f0f0f]");
    expect(chatButton).not.toHaveClass("opacity-40");
  });

  it("places the settings gear and Chat button below the input row", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const textRow = screen.getByTestId("chat-input-text-row");
    const actionRow = screen.getByTestId("chat-input-action-row");
    expect(textRow).toHaveClass("border-2", "rounded-md", "bg-[#191919]");
    expect(actionRow).toHaveClass("relative");
    expect(actionRow).not.toHaveClass("border-t");
    expect(textRow).toContainElement(getEditor());
    expect(textRow).toContainElement(screen.getByTestId("native-emote-button"));
    expect(textRow).toContainElement(screen.getByTestId("third-party-emote-button"));
    expect(actionRow).toContainElement(screen.getByRole("button", { name: /chat settings/i }));
    expect(actionRow).toContainElement(screen.getByRole("button", { name: "Chat" }));
    expect(actionRow).not.toContainElement(screen.getByTestId("native-emote-button"));
    expect(actionRow).not.toContainElement(screen.getByTestId("third-party-emote-button"));
    expect(textRow.compareDocumentPosition(actionRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("turns the input row border white while the editor is focused", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const textRow = screen.getByTestId("chat-input-text-row");

    fireEvent.focus(getEditor());

    expect(textRow).toHaveClass("border-2");
    expect(textRow).toHaveStyle({ borderColor: "#ffffff" });
  });

  it.each(["twitch", "kick"] as const)(
    "opens authenticated %s quick settings above the quick-emote strip",
    (platform) => {
      infoBannerImpl.mockReturnValue(null);
      const quickEmote = makeQuickEmote({ id: "25", name: "Quick", provider: platform });
      emoteStoreState.getEmotesByProvider = () =>
        new Map<EmoteProvider, Emote[]>([[platform, [quickEmote]]]);
      renderInput({ platform, isAuthenticated: true });
      const settingsButton = screen.getByRole("button", { name: /chat settings/i });
      fireEvent.click(settingsButton);
      const popover = screen.getByTestId("chat-quick-settings-popover");
      const actionRow = screen.getByTestId("chat-input-action-row");

      expect(actionRow).not.toContainElement(popover);
      const overlayAnchor = screen.getByTestId("chat-quick-settings-overlay-anchor");
      expect(overlayAnchor).toContainElement(popover);
      expect(overlayAnchor.parentElement).toHaveAttribute(
        "data-testid",
        "chat-emote-settings-anchor"
      );
      expect(overlayAnchor).toHaveClass("absolute", "inset-x-0", "top-0", "max-w-full");
      expect(overlayAnchor).not.toHaveClass("mb-12");
      expect(quickSettingsPopoverCalls.at(-1)?.placement).toBe("top");
      expect(quickSettingsPopoverCalls.at(-1)?.platform).toBe(platform);
      expect(quickSettingsPopoverCalls.at(-1)?.triggerRef?.current).toBe(settingsButton);
    }
  );

  it("keeps quick settings above the logged-out login surface", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ canSend: false, isAuthenticated: false });

    expect(screen.getByRole("button", { name: "Log in to chat" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /chat settings/i }));

    expect(screen.getByTestId("chat-input-action-row")).toHaveClass("z-20");
    const overlayAnchor = screen.getByTestId("chat-quick-settings-overlay-anchor");
    expect(overlayAnchor).toContainElement(screen.getByTestId("chat-quick-settings-popover"));
    expect(overlayAnchor.parentElement).toHaveAttribute("data-testid", "chat-input-main-area");
    expect(overlayAnchor).toHaveClass("absolute", "inset-x-0", "top-0", "max-w-full");
    expect(overlayAnchor).not.toHaveClass("mb-12");
  });

  it("clicking Chat sends the message on Twitch", async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(twitchChatService.sendMessage).mockClear();
    renderInput();
    typeInEditor(getEditor(), "hello");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    });
    expect(twitchChatService.sendMessage).toHaveBeenCalledWith("ninja", "hello", [
      { type: "text", content: "hello" },
    ]);
    expect(getEditor()).toHaveTextContent("");
  });
});

// Guards: room-mode banners receive trustworthy account-backed follow state and never replace the editor.
describe("ChatInput — InfoBanner integration", () => {
  it("renders InfoBanner content above the input row when modes are active", () => {
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Slow Mode [30s]</div>);
    renderInput();
    expect(screen.getByTestId("info-banner-stub")).toBeInTheDocument();
    expect(getEditor()).toBeInTheDocument();
  });

  it("renders nothing for InfoBanner when no modes active (banner row is invisible)", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    expect(screen.queryByTestId("info-banner-stub")).toBeNull();
  });

  it("passes account-backed follow state to InfoBanner for follower-only visibility", () => {
    infoBannerImpl.mockReturnValue(null);
    useFollowStore.setState({
      localFollows: [makeFollowedChannel()],
      sourceByKey: new Map([["twitch:12345", "twitch"]]),
    });

    renderInput({ isAuthenticated: true, canSend: true });

    expect(infoBannerImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "twitch",
        channelId: "12345",
        viewerSatisfiesFollowerOnly: true,
      })
    );
  });

  it("does not hide follower-only for a signed-out viewer without a follow", () => {
    infoBannerImpl.mockReturnValue(null);

    renderInput({ isAuthenticated: false, canSend: false });

    expect(infoBannerImpl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        viewerSatisfiesFollowerOnly: false,
      })
    );
  });

  it("does not hide follower-only for a signed-out viewer with only a local follow", () => {
    infoBannerImpl.mockReturnValue(null);
    useFollowStore.setState({
      localFollows: [makeFollowedChannel()],
      sourceByKey: new Map([["twitch:12345", "guest"]]),
    });

    renderInput({ isAuthenticated: false, canSend: false });

    expect(infoBannerImpl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        viewerSatisfiesFollowerOnly: false,
      })
    );
  });

  it("does not hide follower-only for an authenticated viewer with only a local follow", () => {
    infoBannerImpl.mockReturnValue(null);
    useFollowStore.setState({
      localFollows: [makeFollowedChannel()],
      sourceByKey: new Map([["twitch:12345", "guest"]]),
    });

    renderInput({ isAuthenticated: true, canSend: true });

    expect(infoBannerImpl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        viewerSatisfiesFollowerOnly: false,
      })
    );
  });

  it("updates InfoBanner immediately when the authenticated follow source becomes platform-backed", async () => {
    infoBannerImpl.mockReturnValue(null);
    useFollowStore.setState({
      localFollows: [makeFollowedChannel()],
      sourceByKey: new Map([["twitch:12345", "guest"]]),
    });
    renderInput({ isAuthenticated: true, canSend: true });

    expect(infoBannerImpl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        viewerSatisfiesFollowerOnly: false,
      })
    );

    act(() => {
      useFollowStore.setState({
        localFollows: [makeFollowedChannel()],
        sourceByKey: new Map([["twitch:12345", "twitch"]]),
      });
    });

    await waitFor(() => {
      expect(infoBannerImpl).toHaveBeenLastCalledWith(
        expect.objectContaining({
          viewerSatisfiesFollowerOnly: true,
        })
      );
    });
  });

  it("places the quick emote action bar above InfoBanner", () => {
    const globalTwitch = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.getEmotesByProvider = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [globalTwitch]]]);
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Slow Mode</div>);

    renderInput();

    const quickBar = screen.getByTestId("quick-emote-action-bar");
    const banner = screen.getByTestId("info-banner-stub");
    const textRow = screen.getByTestId("chat-input-text-row");

    expect(quickBar.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(banner.compareDocumentPosition(textRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("reply preview stacks above InfoBanner when both are active", () => {
    infoBannerImpl.mockReturnValue(<div data-testid="info-banner-stub">Slow Mode</div>);
    const ref = createRef<ChatInputHandle>();
    renderWithTooltipProvider(
      <ChatInput ref={ref} channel="ninja" platform="twitch" channelId="12345" />
    );
    const msg: ChatMessage = {
      id: "m1",
      platform: "twitch",
      type: "message",
      channel: "ninja",
      userId: "u1",
      username: "alice",
      displayName: "Alice",
      color: "#fff",
      badges: [],
      content: [{ type: "text", content: "hello" }],
      rawContent: "hello",
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };
    act(() => ref.current?.replyTo(msg));
    const replyPreview = screen.getByTestId("reply-preview");
    const banner = screen.getByTestId("info-banner-stub");
    // DOM order check: reply preview comes before banner.
    const root = replyPreview.parentElement;
    expect(root).not.toBeNull();
    const children = Array.from(root!.children);
    const replyIdx = children.indexOf(replyPreview);
    const bannerIdx = children.indexOf(banner.parentElement as HTMLElement);
    // banner is wrapped by the InfoBanner stub's render slot, but both share
    // the same parent. If parent equality isn't true, fall back to
    // compareDocumentPosition.
    if (replyIdx >= 0 && bannerIdx >= 0) {
      expect(replyIdx).toBeLessThan(bannerIdx);
    } else {
      const pos = replyPreview.compareDocumentPosition(banner);
      // Node.DOCUMENT_POSITION_FOLLOWING === 4
      expect(pos & 4).toBe(4);
    }
  });
});

// Guards: native and third-party pickers share an anchor, remain mutually exclusive, and respect disabled state.
describe("ChatInput — emote dialogs", () => {
  it("clicking the native button opens NativeEmotePicker only", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    fireEvent.click(screen.getByTestId("native-emote-button"));
    expect(screen.getByTestId("emote-picker-popover-native")).toBeInTheDocument();
    expect(screen.queryByTestId("emote-picker-popover-thirdParty")).toBeNull();
  });

  it("clicking the third-party button opens ThirdPartyEmotePicker only", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    fireEvent.click(screen.getByTestId("third-party-emote-button"));
    expect(screen.getByTestId("emote-picker-popover-thirdParty")).toBeInTheDocument();
    expect(screen.queryByTestId("emote-picker-popover-native")).toBeNull();
  });

  it("opening native closes third-party (mutual exclusion)", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    fireEvent.click(screen.getByTestId("third-party-emote-button"));
    expect(screen.getByTestId("emote-picker-popover-thirdParty")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("native-emote-button"));
    expect(screen.queryByTestId("emote-picker-popover-thirdParty")).toBeNull();
    expect(screen.getByTestId("emote-picker-popover-native")).toBeInTheDocument();
  });

  it("anchors the native picker to the third-party picker position", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    fireEvent.click(screen.getByTestId("native-emote-button"));

    const nativePopover = [...emotePickerPopoverCalls]
      .reverse()
      .find((call) => call.scope === "native");
    const thirdPartyPopover = [...emotePickerPopoverCalls]
      .reverse()
      .find((call) => call.scope === "thirdParty");

    expect(nativePopover?.isOpen).toBe(true);
    expect(nativePopover?.anchorRef).toBe(thirdPartyPopover?.anchorRef);
    expect(nativePopover?.anchorRef.current).toBe(screen.getByTestId("third-party-emote-button"));
  });

  it("clicking the same button again closes its dialog", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const btn = screen.getByTestId("native-emote-button");
    fireEvent.click(btn);
    expect(screen.getByTestId("emote-picker-popover-native")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByTestId("emote-picker-popover-native")).toBeNull();
  });

  it("disables both emote buttons when ChatInput is disabled", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ disabled: true });
    expect(screen.getByTestId("native-emote-button")).toBeDisabled();
    expect(screen.getByTestId("third-party-emote-button")).toBeDisabled();
  });

  it("keeps emote pickers available when canSend=false", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ canSend: false });
    expect(screen.getByTestId("native-emote-button")).toBeEnabled();
    expect(screen.getByTestId("third-party-emote-button")).toBeEnabled();

    fireEvent.click(screen.getByTestId("native-emote-button"));
    expect(screen.getByTestId("emote-picker-popover-native")).toBeInTheDocument();
  });

  it("uses the KickTalk emote button frame sizing and border treatment", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ platform: "kick" });
    const nativeButton = screen.getByTestId("native-emote-button");
    const thirdPartyButton = screen.getByTestId("third-party-emote-button");
    const buttonFrame = nativeButton.parentElement;
    const actionRail = buttonFrame?.parentElement;

    expect(nativeButton).toHaveClass("w-14");
    expect(thirdPartyButton).toHaveClass("w-14");
    expect(buttonFrame).toHaveClass("h-[38px]", "border", "bg-white/5");
    expect(buttonFrame).toHaveStyle({ borderColor: "rgba(255,255,255,0.05)" });
    expect(actionRail).toHaveStyle({ borderLeftColor: "rgba(255,255,255,0.16)" });
  });
});

// Guards: quick emote strip shows platform global emotes when no recent emotes exist.
// Guards: recently used emotes stay first and can come from any provider available on the current platform.
// Guards: selecting a quick emote sends it immediately and promotes it to frequently used without touching drafts.
// Guards: accepted quick clicks can overlap after 50 ms, while earlier clicks disappear instead of queueing.
// Guards: quick-send throttle elapsed time stays stable across wall-clock corrections.
// Guards: sub-50 ms clicks are dropped before async subscriber eligibility can queue concurrent sends.
// Guards: slow mode reserves one pending quick send before subscriber preflight and releases it after failure.
// Guards: rejected quick-send subscriber checks surface inline without leaking an unhandled rejection or leaving the send pending.
// Guards: channel contexts own independent throttle and token-safe pending slow-mode sends.
// Guards: each quick emote has its own visible tile and spacing instead of one flat gray strip.
describe("ChatInput — quick emote action bar", () => {
  it("reactively hides and restores the quick-emote action row from chatDisplay.quickEmotes", () => {
    const previousPreferences = useAuthStore.getState().preferences;
    const kappa = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.getEmotesByProvider = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [kappa]]]);

    try {
      renderInput();

      expect(screen.getByTestId("chat-emote-action-row")).toBeInTheDocument();
      expect(screen.getByTestId("quick-emote-action-bar")).toBeInTheDocument();

      act(() => {
        useAuthStore.setState({
          preferences: {
            ...DEFAULT_USER_PREFERENCES,
            chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, quickEmotes: false },
          },
        });
      });

      expect(screen.queryByTestId("chat-emote-action-row")).not.toBeInTheDocument();
      expect(screen.queryByTestId("quick-emote-action-bar")).not.toBeInTheDocument();

      act(() => {
        useAuthStore.setState({
          preferences: {
            ...DEFAULT_USER_PREFERENCES,
            chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, quickEmotes: true },
          },
        });
      });

      expect(screen.getByTestId("chat-emote-action-row")).toBeInTheDocument();
      expect(screen.getByTestId("quick-emote-action-bar")).toBeInTheDocument();
    } finally {
      act(() => {
        useAuthStore.setState({ preferences: previousPreferences });
      });
    }
  });

  it.each([
    ["twitch", "Kappa", "25"],
    ["kick", "KEKW", "1730762"],
  ] as const)(
    "starts a %s quick send immediately and accepts another click at exactly 50 ms",
    async (platform, emoteName, emoteId) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
      const emote = makeQuickEmote({ id: emoteId, name: emoteName, provider: platform });
      emoteStoreState.getEmotesByProvider = () =>
        new Map<EmoteProvider, Emote[]>([[platform, [emote]]]);
      const sendMessage =
        platform === "twitch" ? twitchChatService.sendMessage : kickChatService.sendMessage;
      vi.mocked(sendMessage).mockImplementationOnce(() => new Promise(() => {}));

      renderInput({ platform });
      const quickEmoteButton = screen.getByRole("button", { name: `Use ${emoteName}` });

      await act(async () => {
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(50);
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });

      expect(sendMessage).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    ["twitch", "Kappa", "25"],
    ["kick", "KEKW", "1730762"],
  ] as const)(
    "uses monotonic elapsed time for the %s quick-send throttle",
    async (platform, emoteName, emoteId) => {
      vi.useFakeTimers();
      const initialWallTime = new Date("2026-08-02T12:00:00.000Z");
      vi.setSystemTime(initialWallTime);
      const emote = makeQuickEmote({ id: emoteId, name: emoteName, provider: platform });
      emoteStoreState.getEmotesByProvider = () =>
        new Map<EmoteProvider, Emote[]>([[platform, [emote]]]);
      const sendMessage =
        platform === "twitch" ? twitchChatService.sendMessage : kickChatService.sendMessage;
      vi.mocked(sendMessage).mockImplementationOnce(() => new Promise(() => {}));

      renderInput({ platform });
      const quickEmoteButton = screen.getByRole("button", { name: `Use ${emoteName}` });
      await act(async () => {
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date(initialWallTime.getTime() + 60_000));
      await act(async () => {
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(50);
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });

      expect(sendMessage).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    ["twitch", "Kappa", "25"],
    ["kick", "KEKW", "1730762"],
  ] as const)(
    "drops a second %s quick click while subscriber eligibility is pending",
    async (platform, emoteName, emoteId) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
      useRoomStateStore.getState().updateRoomState(platform, "12345", { subscribersOnly: true });
      const emote = makeQuickEmote({ id: emoteId, name: emoteName, provider: platform });
      emoteStoreState.getEmotesByProvider = () =>
        new Map<EmoteProvider, Emote[]>([[platform, [emote]]]);
      const sendMessage =
        platform === "twitch" ? twitchChatService.sendMessage : kickChatService.sendMessage;
      const eligibilityResolvers: Array<(result: { status: "subscribed" }) => void> = [];
      const checkSubscriberEligibility = vi.fn(
        () =>
          new Promise<{ status: "subscribed" }>((resolve) => {
            eligibilityResolvers.push(resolve);
          })
      );

      renderInput({ platform, checkSubscriberEligibility });
      const quickEmoteButton = screen.getByRole("button", { name: `Use ${emoteName}` });
      fireEvent.click(quickEmoteButton);
      await act(async () => {
        vi.advanceTimersByTime(49);
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });

      expect(checkSubscriberEligibility).toHaveBeenCalledTimes(1);

      await act(async () => {
        eligibilityResolvers[0]({ status: "subscribed" });
        await Promise.resolve();
        vi.advanceTimersByTime(1_000);
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
    }
  );

  it("surfaces a rejected quick-emote subscriber check and releases the pending send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
    const emote = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.getEmotesByProvider = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [emote]]]);
    useRoomStateStore
      .getState()
      .updateRoomState("twitch", "12345", { slowMode: 5, subscribersOnly: true });
    let rejectEligibility!: (reason: Error) => void;
    const checkSubscriberEligibility = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectEligibility = reject;
          })
      )
      .mockResolvedValueOnce({ status: "subscribed" as const });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    const writeLog = vi.fn();
    window.electronAPI = { logs: { write: writeLog } } as unknown as typeof window.electronAPI;
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      renderInput({ checkSubscriberEligibility });
      const quickEmoteButton = screen.getByRole("button", { name: "Use Kappa" });

      fireEvent.click(quickEmoteButton);
      expect(checkSubscriberEligibility).toHaveBeenCalledOnce();
      await act(async () => {
        rejectEligibility(new Error("Eligibility failed"));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
      expect(unhandledRejections).toEqual([]);
      expect(quickEmoteButton).toBeEnabled();
      expect(screen.getByText("Eligibility failed")).toBeInTheDocument();
      expect(writeLog).toHaveBeenCalledWith({
        level: "error",
        tag: "UI:Chat:Input",
        message: "failed to verify subscriber eligibility",
        meta: { error: "Eligibility failed" },
      });

      await act(async () => {
        vi.advanceTimersByTime(50);
        fireEvent.click(quickEmoteButton);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(checkSubscriberEligibility).toHaveBeenCalledTimes(2);
      expect(twitchChatService.sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("reports a later synchronous quick-emote failure as a send failure", async () => {
    const emote = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.getEmotesByProvider = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [emote]]]);
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { subscribersOnly: true });
    const checkSubscriberEligibility = vi.fn().mockResolvedValue({ status: "subscribed" as const });
    const writeLog = vi.fn();
    window.electronAPI = { logs: { write: writeLog } } as unknown as typeof window.electronAPI;
    emoteStoreState.addRecentEmote.mockImplementationOnce(() => {
      throw new Error("Recent emote update failed");
    });

    renderInput({ checkSubscriberEligibility });
    fireEvent.click(screen.getByRole("button", { name: "Use Kappa" }));

    await waitFor(() => {
      expect(screen.getByText("Recent emote update failed")).toBeInTheDocument();
    });
    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
    expect(writeLog).toHaveBeenCalledWith({
      level: "error",
      tag: "UI:Chat:Input",
      message: "failed to send quick emote",
      meta: { error: "Recent emote update failed" },
    });
  });

  it.each([
    ["twitch", "Kappa", "25"],
    ["kick", "KEKW", "1730762"],
  ] as const)(
    "keeps a later %s slow-mode click from winning during subscriber preflight",
    async (platform, emoteName, emoteId) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
      useRoomStateStore
        .getState()
        .updateRoomState(platform, "12345", { slowMode: 5, subscribersOnly: true });
      const emote = makeQuickEmote({ id: emoteId, name: emoteName, provider: platform });
      emoteStoreState.getEmotesByProvider = () =>
        new Map<EmoteProvider, Emote[]>([[platform, [emote]]]);
      const sendMessage =
        platform === "twitch" ? twitchChatService.sendMessage : kickChatService.sendMessage;
      const eligibilityResolvers: Array<(result: { status: "subscribed" }) => void> = [];
      const checkSubscriberEligibility = vi.fn(
        () =>
          new Promise<{ status: "subscribed" }>((resolve) => {
            eligibilityResolvers.push(resolve);
          })
      );

      renderInput({ platform, checkSubscriberEligibility });
      const quickEmoteButton = screen.getByRole("button", { name: `Use ${emoteName}` });
      fireEvent.click(quickEmoteButton);
      await act(async () => {
        vi.advanceTimersByTime(50);
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });

      expect(checkSubscriberEligibility).toHaveBeenCalledTimes(2);
      expect(sendMessage).not.toHaveBeenCalled();

      await act(async () => {
        eligibilityResolvers[1]({ status: "subscribed" });
        await Promise.resolve();
      });
      expect(sendMessage).not.toHaveBeenCalled();

      await act(async () => {
        eligibilityResolvers[0]({ status: "subscribed" });
        await Promise.resolve();
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ["twitch", "Kappa", "25"],
    ["kick", "KEKW", "1730762"],
  ] as const)(
    "isolates pending %s slow-mode quick sends and throttles across channel contexts",
    async (platform, emoteName, emoteId) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
      useRoomStateStore.getState().updateRoomState(platform, "12345", { slowMode: 5 });
      useRoomStateStore.getState().updateRoomState(platform, "67890", { slowMode: 5 });
      const emote = makeQuickEmote({ id: emoteId, name: emoteName, provider: platform });
      emoteStoreState.getEmotesByProvider = () =>
        new Map<EmoteProvider, Emote[]>([[platform, [emote]]]);
      const sendMessage =
        platform === "twitch" ? twitchChatService.sendMessage : kickChatService.sendMessage;
      let rejectFirstSend!: (reason: Error) => void;
      vi.mocked(sendMessage)
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectFirstSend = reject;
            })
        )
        .mockImplementationOnce(() => new Promise(() => {}));

      const { rerender } = renderInput({ platform });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: `Use ${emoteName}` }));
        await Promise.resolve();
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);

      rerender(
        <TooltipProvider>
          <ChatInput channel="other" platform={platform} channelId="67890" />
        </TooltipProvider>
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: `Use ${emoteName}` }));
        await Promise.resolve();
      });
      expect(sendMessage).toHaveBeenCalledTimes(2);

      await act(async () => {
        rejectFirstSend(new Error("First context failed"));
        await Promise.resolve();
        vi.advanceTimersByTime(50);
        fireEvent.click(screen.getByRole("button", { name: `Use ${emoteName}` }));
        await Promise.resolve();
      });

      expect(sendMessage).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    ["twitch", "Kappa", "25"],
    ["kick", "KEKW", "1730762"],
  ] as const)(
    "drops a %s quick-emote click inside 50 ms instead of queueing it",
    async (platform, emoteName, emoteId) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
      const emote = makeQuickEmote({ id: emoteId, name: emoteName, provider: platform });
      emoteStoreState.getEmotesByProvider = () =>
        new Map<EmoteProvider, Emote[]>([[platform, [emote]]]);
      const sendMessage =
        platform === "twitch" ? twitchChatService.sendMessage : kickChatService.sendMessage;
      let resolveFirstSend!: () => void;
      vi.mocked(sendMessage).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstSend = resolve;
          })
      );

      renderInput({ platform });
      const quickEmoteButton = screen.getByRole("button", { name: `Use ${emoteName}` });
      await act(async () => {
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(49);
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(1_000);
        resolveFirstSend();
        await Promise.resolve();
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ["twitch", "Kappa", "25"],
    ["kick", "KEKW", "1730762"],
  ] as const)(
    "leaves the typed draft untouched during a pending %s quick send",
    async (platform, emoteName, emoteId) => {
      const emote = makeQuickEmote({ id: emoteId, name: emoteName, provider: platform });
      emoteStoreState.getEmotesByProvider = () =>
        new Map<EmoteProvider, Emote[]>([[platform, [emote]]]);
      const sendMessage =
        platform === "twitch" ? twitchChatService.sendMessage : kickChatService.sendMessage;
      vi.mocked(sendMessage).mockImplementationOnce(() => new Promise(() => {}));

      renderInput({ platform });
      const editor = getEditor();
      typeInEditor(editor, "keep this draft");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: `Use ${emoteName}` }));
        await Promise.resolve();
      });

      expect(editor).toHaveTextContent("keep this draft");
    }
  );

  it.each([
    ["twitch", "Kappa", "25"],
    ["kick", "KEKW", "1730762"],
  ] as const)(
    "releases the %s slow-mode in-flight guard when a quick send fails",
    async (platform, emoteName, emoteId) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
      useRoomStateStore.getState().updateRoomState(platform, "12345", { slowMode: 5 });
      const emote = makeQuickEmote({ id: emoteId, name: emoteName, provider: platform });
      emoteStoreState.getEmotesByProvider = () =>
        new Map<EmoteProvider, Emote[]>([[platform, [emote]]]);
      const sendMessage =
        platform === "twitch" ? twitchChatService.sendMessage : kickChatService.sendMessage;
      vi.mocked(sendMessage).mockRejectedValueOnce(new Error("Network failed"));

      renderInput({ platform });
      const quickEmoteButton = screen.getByRole("button", { name: `Use ${emoteName}` });
      await act(async () => {
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(50);
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });

      expect(sendMessage).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    ["twitch", "Kappa", "25"],
    ["kick", "KEKW", "1730762"],
  ] as const)(
    "keeps a later %s quick-emote click blocked while a slow-mode send is pending",
    async (platform, emoteName, emoteId) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
      useRoomStateStore.getState().updateRoomState(platform, "12345", { slowMode: 5 });
      const emote = makeQuickEmote({ id: emoteId, name: emoteName, provider: platform });
      emoteStoreState.getEmotesByProvider = () =>
        new Map<EmoteProvider, Emote[]>([[platform, [emote]]]);
      const sendMessage =
        platform === "twitch" ? twitchChatService.sendMessage : kickChatService.sendMessage;
      vi.mocked(sendMessage).mockImplementationOnce(() => new Promise(() => {}));

      renderInput({ platform });
      const quickEmoteButton = screen.getByRole("button", { name: `Use ${emoteName}` });
      await act(async () => {
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(50);
        fireEvent.click(quickEmoteButton);
        await Promise.resolve();
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["twitch", "kick"] as const)(
    "renders spaced %s quick emote tiles without a full-width gray strip",
    (platform) => {
      const globalEmote = makeQuickEmote({
        id: platform === "twitch" ? "25" : "1730762",
        name: platform === "twitch" ? "Kappa" : "KEKW",
        provider: platform,
      });
      emoteStoreState.getEmotesByProvider = () =>
        new Map<EmoteProvider, Emote[]>([[platform, [globalEmote]]]);

      renderInput({ platform });

      expect(screen.getByTestId("chat-emote-action-row")).not.toHaveClass("bg-[#252525]");
      expect(screen.getByTestId("quick-emote-action-bar")).toHaveClass("gap-2");
      expect(screen.getByTestId("quick-emote-button")).toHaveClass(
        "border-white/10",
        "bg-[#252525]"
      );
      expect(screen.getByTestId("chat-input-text-row")).toHaveClass("bg-[#191919]");
    }
  );

  it("shows global emotes as the fallback quick row", () => {
    const globalTwitch = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    const channelTwitch = makeQuickEmote({
      id: "channel-1",
      name: "ChannelOnly",
      provider: "twitch",
      isGlobal: false,
    });
    const globalSevenTv = makeQuickEmote({ id: "7tv-2", name: "RainTime", provider: "7tv" });
    emoteStoreState.getEmotesByProvider = () =>
      new Map<EmoteProvider, Emote[]>([
        ["twitch", [globalTwitch, channelTwitch]],
        ["7tv", [globalSevenTv]],
      ]);

    renderInput();

    expect(screen.getAllByTestId("quick-emote-button").map((button) => button.ariaLabel)).toEqual([
      "Use Kappa",
      "Use RainTime",
    ]);
  });

  it("limits the quick row to nine complete emote tiles", () => {
    const kickEmotes = Array.from({ length: 11 }, (_, index) =>
      makeQuickEmote({
        id: `kick-${index + 1}`,
        name: `KickEmote${index + 1}`,
        provider: "kick",
      })
    );
    emoteStoreState.getEmotesByProvider = () =>
      new Map<EmoteProvider, Emote[]>([["kick", kickEmotes]]);

    renderInput({ platform: "kick" });

    expect(screen.getAllByTestId("quick-emote-button")).toHaveLength(9);
    expect(screen.queryByRole("button", { name: "Use KickEmote10" })).not.toBeInTheDocument();
  });

  it("uses Kick-sized 24px emote art", () => {
    const globalTwitch = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.getEmotesByProvider = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [globalTwitch]]]);

    renderInput();

    expect(screen.getByAltText("Kappa")).toHaveStyle({ height: "24px" });
  });

  it("places recent emotes before global fallback emotes", () => {
    const recentSevenTv = makeQuickEmote({
      id: "7tv-r",
      name: "recentSTV",
      provider: "7tv",
      isGlobal: false,
    });
    const globalTwitch = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.recentEmotesByScope["twitch:guest"] = [recentSevenTv];
    emoteStoreState.getEmotesByProvider = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [globalTwitch]]]);

    renderInput();

    expect(screen.getAllByTestId("quick-emote-button").map((button) => button.ariaLabel)).toEqual([
      "Use recentSTV",
      "Use Kappa",
    ]);
  });

  // Guards: signing back into the same platform account restores its quick-emote row,
  // while guest or another account's recent choices stay isolated.
  it("shows recent emotes for the authenticated Twitch viewer", () => {
    const accountRecent = makeQuickEmote({
      id: "account-r",
      name: "accountRecent",
      provider: "twitch",
      isGlobal: false,
    });
    const guestRecent = makeQuickEmote({
      id: "guest-r",
      name: "guestRecent",
      provider: "twitch",
      isGlobal: false,
    });
    const otherAccountRecent = makeQuickEmote({
      id: "other-r",
      name: "otherRecent",
      provider: "twitch",
      isGlobal: false,
    });
    emoteStoreState.recentEmotes = [guestRecent];
    emoteStoreState.recentEmotesByScope = {
      "twitch:viewer-1": [accountRecent],
      "twitch:viewer-2": [otherAccountRecent],
      "twitch:guest": [guestRecent],
    };

    const { rerender } = renderInput({ viewerUserId: "viewer-1" });

    expect(screen.getAllByTestId("quick-emote-button").map((button) => button.ariaLabel)).toEqual([
      "Use accountRecent",
    ]);

    rerender(
      <TooltipProvider>
        <ChatInput channel="ninja" platform="twitch" channelId="12345" />
      </TooltipProvider>
    );
    expect(screen.getAllByTestId("quick-emote-button").map((button) => button.ariaLabel)).toEqual([
      "Use guestRecent",
    ]);

    rerender(
      <TooltipProvider>
        <ChatInput channel="ninja" platform="twitch" channelId="12345" viewerUserId="viewer-2" />
      </TooltipProvider>
    );
    expect(screen.getAllByTestId("quick-emote-button").map((button) => button.ariaLabel)).toEqual([
      "Use otherRecent",
    ]);

    rerender(
      <TooltipProvider>
        <ChatInput channel="ninja" platform="twitch" channelId="12345" viewerUserId="viewer-1" />
      </TooltipProvider>
    );
    expect(screen.getAllByTestId("quick-emote-button").map((button) => button.ariaLabel)).toEqual([
      "Use accountRecent",
    ]);
  });

  it("sends a quick Twitch emote and records it as frequently used", async () => {
    const globalTwitch = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.getEmotesByProvider = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [globalTwitch]]]);

    renderInput();
    typeInEditor(getEditor(), "draft");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use Kappa" }));
    });

    await waitFor(() => {
      expect(twitchChatService.sendMessage).toHaveBeenCalledWith("ninja", "Kappa", [
        {
          type: "emote",
          id: "25",
          name: "Kappa",
          url: "https://example.test/25/2x.webp",
          isAnimated: false,
          isZeroWidth: false,
        },
      ]);
    });
    expect(emoteStoreState.addRecentEmote).toHaveBeenCalledWith(
      { platform: "twitch", userId: null },
      globalTwitch
    );
    expect(getEditor().textContent).toBe("draft");
  });

  it("sends a quick Kick native emote using Kick emote markup", async () => {
    const kickEmote = makeQuickEmote({ id: "1730762", name: "KEKW", provider: "kick" });
    emoteStoreState.getEmotesByProvider = () =>
      new Map<EmoteProvider, Emote[]>([["kick", [kickEmote]]]);

    renderInput({ platform: "kick" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use KEKW" }));
    });

    await waitFor(() => {
      expect(kickChatService.sendMessage).toHaveBeenCalledWith(
        "ninja",
        "[emote:1730762:KEKW]",
        undefined,
        [
          {
            type: "emote",
            id: "1730762",
            name: "KEKW",
            url: "https://example.test/1730762/2x.webp",
            isAnimated: false,
            isZeroWidth: false,
          },
        ]
      );
    });
    expect(emoteStoreState.addRecentEmote).toHaveBeenCalledWith(
      { platform: "kick", userId: null },
      kickEmote
    );
  });
});

// Guards: the contextual colon row replaces quick-send, inserts into the draft without sending, then a later Enter sends.
// Guards: unmatched ordinary words do not reserve an empty contextual-emote row when Quick Emotes is off.
describe("ChatInput — contextual emote row", () => {
  it("keeps typed contextual suggestions and insertion working when quick emotes are disabled", async () => {
    const previousPreferences = useAuthStore.getState().preferences;
    const kappa = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.getEmotesByProviderForChannel = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [kappa]]]);
    const user = userEvent.setup({ delay: null });

    try {
      act(() => {
        useAuthStore.setState({
          preferences: {
            ...DEFAULT_USER_PREFERENCES,
            chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, quickEmotes: false },
          },
        });
      });

      renderInput();
      const editor = getEditor();
      await user.click(editor);
      await user.keyboard("K");

      expect(screen.getByTestId("contextual-emote-row")).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Insert Kappa from Twitch" })).toBeInTheDocument();
      expect(screen.queryByTestId("quick-emote-action-bar")).not.toBeInTheDocument();

      await user.click(screen.getByRole("option", { name: "Insert Kappa from Twitch" }));

      expect(editor.querySelector("[data-emote-name='Kappa']")).toBeInTheDocument();
    } finally {
      act(() => {
        useAuthStore.setState({ preferences: previousPreferences });
      });
    }
  });

  it("does not reserve a contextual emote row for an unmatched ordinary word when quick emotes are disabled", async () => {
    const previousPreferences = useAuthStore.getState().preferences;
    const kappa = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.getEmotesByProviderForChannel = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [kappa]]]);
    const user = userEvent.setup({ delay: null });

    try {
      act(() => {
        useAuthStore.setState({
          preferences: {
            ...DEFAULT_USER_PREFERENCES,
            chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, quickEmotes: false },
          },
        });
      });

      renderInput();
      const editor = getEditor();
      await user.click(editor);
      await user.keyboard("ordinary");

      expect(screen.queryByTestId("chat-emote-action-row")).not.toBeInTheDocument();
      expect(screen.queryByTestId("contextual-emote-row")).not.toBeInTheDocument();
      expect(screen.queryByTestId("quick-emote-action-bar")).not.toBeInTheDocument();
    } finally {
      act(() => {
        useAuthStore.setState({ preferences: previousPreferences });
      });
    }
  });

  // Guards: Frosty-style ordinary word typing opens results from the first character using real keyboard events.
  it("opens contextual results while a user types an ordinary current word", async () => {
    const kappa = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.getEmotesByProviderForChannel = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [kappa]]]);
    const user = userEvent.setup({ delay: null });

    renderInput();
    const editor = getEditor();
    await user.click(editor);
    await user.keyboard("K");

    expect(editor).toHaveTextContent("K");
    expect(screen.getByTestId("contextual-emote-row")).toBeInTheDocument();
  });

  // Guards: real printable keydown/keyup sequencing keeps the caret-local colon query active.
  it("opens contextual results when a user types a colon query", async () => {
    const kappa = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.getEmotesByProviderForChannel = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [kappa]]]);
    const user = userEvent.setup({ delay: null });

    renderInput();
    const editor = getEditor();
    await user.click(editor);
    await user.type(editor, ":Ka");

    expect(editor).toHaveTextContent(":Ka");
    expect(screen.getByTestId("contextual-emote-row")).toBeInTheDocument();
    expect(screen.queryByTestId("quick-emote-action-bar")).not.toBeInTheDocument();
  });

  // Guards: a lagging DOM selection reported on printable keyup cannot collapse the state-driven query caret.
  it("keeps the query active when printable keyup reports the previous DOM caret", async () => {
    const kappa = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.getEmotesByProviderForChannel = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [kappa]]]);
    const user = userEvent.setup({ delay: null });

    renderInput();
    const editor = getEditor();
    await user.click(editor);
    await user.keyboard(":K");
    selectEditorText(editor, 1, 1);
    fireEvent.keyUp(editor, { key: "K" });

    expect(editor).toHaveTextContent(":K");
    expect(screen.getByTestId("contextual-emote-row")).toBeInTheDocument();
  });

  it("replaces the colon query and requires a subsequent Enter to send", async () => {
    const kappa = makeQuickEmote({ id: "25", name: "Kappa", provider: "twitch" });
    emoteStoreState.getEmotesByProviderForChannel = (channelId: string) =>
      channelId === "12345" ? new Map<EmoteProvider, Emote[]>([["twitch", [kappa]]]) : new Map();
    emoteStoreState.getEmotesByProvider = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [kappa]]]);

    renderInput();
    const editor = getEditor();
    fireEvent.focus(editor);
    typeInEditor(editor, ":K");

    expect(screen.getByTestId("contextual-emote-row")).toBeInTheDocument();
    expect(screen.queryByTestId("quick-emote-action-bar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "Insert Kappa from Twitch" }));

    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
    expect(editor.querySelector("[data-emote-name='Kappa']")).toBeInTheDocument();
    expect(screen.getByTestId("quick-emote-action-bar")).toBeInTheDocument();

    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => {
      expect(twitchChatService.sendMessage).toHaveBeenCalledWith(
        "ninja",
        "Kappa",
        expect.arrayContaining([
          expect.objectContaining({ type: "emote", id: "25", name: "Kappa" }),
        ])
      );
    });
  });

  // Guards: visible contextual emotes never hijack Enter from the typed draft on either platform.
  it.each([
    ["twitch", "Kappa", "25"],
    ["kick", "KEKW", "1730762"],
  ] as const)(
    "sends the exact typed %s draft on Enter while an emote suggestion is visible",
    async (platform, emoteName, emoteId) => {
      const emote = makeQuickEmote({ id: emoteId, name: emoteName, provider: platform });
      emoteStoreState.getEmotesByProviderForChannel = () =>
        new Map<EmoteProvider, Emote[]>([[platform, [emote]]]);

      renderInput({ platform });
      const editor = getEditor();
      fireEvent.focus(editor);
      typeInEditor(editor, "K");

      expect(
        screen.getByRole("option", {
          name: `Insert ${emoteName} from ${platform === "twitch" ? "Twitch" : "Kick"}`,
        })
      ).toBeVisible();
      fireEvent.keyDown(editor, { key: "Enter" });

      await waitFor(() => {
        if (platform === "twitch") {
          expect(twitchChatService.sendMessage).toHaveBeenCalledWith("ninja", "K", [
            { type: "text", content: "K" },
          ]);
        } else {
          expect(kickChatService.sendMessage).toHaveBeenCalledWith("ninja", "K", undefined, [
            { type: "text", content: "K" },
          ]);
        }
      });
      expect(editor.querySelector(`[data-emote-name='${emoteName}']`)).not.toBeInTheDocument();
    }
  );

  // Guards: Kick contextual insertion retains native wire markup and optimistic emote fragments.
  it("preserves Kick native serialization after contextual insertion", async () => {
    const kickEmote = makeQuickEmote({ id: "1730762", name: "KEKW", provider: "kick" });
    emoteStoreState.getEmotesByProviderForChannel = () =>
      new Map<EmoteProvider, Emote[]>([["kick", [kickEmote]]]);

    renderInput({ platform: "kick" });
    const editor = getEditor();
    fireEvent.focus(editor);
    typeInEditor(editor, ":K");

    fireEvent.click(screen.getByRole("option", { name: "Insert KEKW from Kick" }));
    expect(kickChatService.sendMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => {
      expect(kickChatService.sendMessage).toHaveBeenCalledWith(
        "ninja",
        "[emote:1730762:KEKW]",
        undefined,
        expect.arrayContaining([
          expect.objectContaining({ type: "emote", id: "1730762", name: "KEKW" }),
        ])
      );
    });
  });
});

// Guards: one Backspace after picking an emote removes the whole inline emote token and its inserted delimiter.
describe("ChatInput — rich emote editing", () => {
  it("inserts a 7TV picker emote as an inline editor node", async () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();

    fireEvent.click(screen.getByTestId("third-party-emote-button"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select PogSeven" }));
    });

    const editor = getEditor();
    await waitFor(() => {
      expect(editor.querySelector("[data-emote-name='PogSeven']")).toBeInTheDocument();
    });
    expect(editor.querySelectorAll("[data-chat-emote-node='true']")).toHaveLength(1);
  });

  it("removes a picker-inserted emote with one Backspace", async () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();

    fireEvent.click(screen.getByTestId("native-emote-button"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select Kappa" }));
    });

    const editor = getEditor();
    await waitFor(() => {
      expect(editor.querySelectorAll("[data-chat-emote-node='true']")).toHaveLength(1);
    });

    fireEvent.keyDown(editor, { key: "Backspace" });

    expect(editor.querySelector("[data-chat-emote-node='true']")).toBeNull();
    expect(editor.textContent).toBe("");
    expect(screen.getByText("Send a message...")).toBeInTheDocument();
  });
});

// Guards: mention and slash-command previews escape the clipped text row while staying anchored to the composer.
// Guards: mention suggestions do not steal Backspace editing.
describe("ChatInput - completion overlays", () => {
  it("anchors mention results outside the clipped text row", () => {
    infoBannerImpl.mockReturnValue(null);
    mentionAutocompleteCtl.isActive = true;
    renderInput();

    const popup = screen.getByTestId("mention-autocomplete-anchor");
    expect(popup.parentElement).toBe(screen.getByTestId("chat-input-main-area"));
    expect(screen.getByTestId("chat-input-main-area")).toHaveClass("relative");
    expect(screen.getByTestId("chat-input-text-row")).toHaveClass("overflow-hidden");
  });

  it("anchors slash-command results outside the clipped text row", async () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({
      isAuthenticated: true,
      canSend: true,
      commandAccess: { kind: "authenticated", platform: "twitch", role: "viewer" },
    });

    const editor = getEditor();
    fireEvent.focus(editor);
    typeInEditor(editor, "/");

    const popup = await screen.findByRole("listbox", { name: "Chat commands" });
    expect(popup.parentElement).toBe(screen.getByTestId("chat-input-main-area"));
    expect(screen.getByRole("option", { name: /\/block \[username\]/i })).toBeInTheDocument();
  });

  it("keeps Backspace state-driven while mention autocomplete is active", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();

    const editor = getEditor();
    typeInEditor(editor, "@alice");
    setCaretAtTextEnd(editor);
    mentionAutocompleteCtl.isActive = true;

    fireEvent.keyDown(editor, { key: "Backspace" });

    expect(editor.textContent).toBe("@alic");
    expect(window.getSelection()?.anchorOffset).toBe(5);
  });
});

// Guards: Enter sends once on both platforms, preserves newer drafts on failure, and Shift+Enter keeps editing.
// Guards: recognized slash commands use the provider command path and never fall through to ordinary chat sends.
// Guards: unknown and malformed slash commands retain the draft and never call provider or ordinary send paths.
describe("ChatInput — Enter / Shift+Enter", () => {
  // Guards: normal sends with slow mode disabled clear in the same interaction frame and do not wait for the network promise.
  it.each(["twitch", "kick"] as const)(
    "clears a %s draft before its deferred network send settles",
    async (platform) => {
      infoBannerImpl.mockReturnValue(null);
      let resolveSend!: () => void;
      const pendingSend = new Promise<void>((resolve) => {
        resolveSend = resolve;
      });
      if (platform === "twitch") {
        vi.mocked(twitchChatService.sendMessage).mockReturnValueOnce(pendingSend);
      } else {
        vi.mocked(kickChatService.sendMessage).mockReturnValueOnce(pendingSend);
      }
      renderInput({ platform, isAuthenticated: true, canSend: true });
      const editor = getEditor();
      typeInEditor(editor, "send now");

      fireEvent.keyDown(editor, { key: "Enter" });

      expect(editor).toBeEmptyDOMElement();
      expect(
        platform === "twitch" ? twitchChatService.sendMessage : kickChatService.sendMessage
      ).toHaveBeenCalledTimes(1);

      resolveSend();
      await act(async () => {
        await pendingSend;
      });
    }
  );

  // Guards: an in-flight normal send prevents duplicates but does not impose a post-send throttle when slow mode is off.
  it.each(["twitch", "kick"] as const)(
    "allows the next %s draft immediately after the pending send settles",
    async (platform) => {
      infoBannerImpl.mockReturnValue(null);
      let resolveSend!: () => void;
      const pendingSend = new Promise<void>((resolve) => {
        resolveSend = resolve;
      });
      const sendMessage =
        platform === "twitch" ? twitchChatService.sendMessage : kickChatService.sendMessage;
      vi.mocked(sendMessage).mockReturnValueOnce(pendingSend);
      renderInput({ platform, isAuthenticated: true, canSend: true });
      const editor = getEditor();
      typeInEditor(editor, "first");
      fireEvent.keyDown(editor, { key: "Enter" });
      typeInEditor(editor, "second");

      fireEvent.keyDown(editor, { key: "Enter" });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(editor).toHaveTextContent("second");

      resolveSend();
      await act(async () => {
        await pendingSend;
      });
      fireEvent.keyDown(editor, { key: "Enter" });

      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    }
  );

  // Guards: a failed send restores its submitted text only when the user has not already started another draft.
  it.each(["twitch", "kick"] as const)(
    "keeps a newer %s draft when the previous send fails",
    async (platform) => {
      infoBannerImpl.mockReturnValue(null);
      let rejectSend!: (error: Error) => void;
      const pendingSend = new Promise<void>((_resolve, reject) => {
        rejectSend = reject;
      });
      const sendMessage =
        platform === "twitch" ? twitchChatService.sendMessage : kickChatService.sendMessage;
      vi.mocked(sendMessage).mockReturnValueOnce(pendingSend);
      renderInput({ platform, isAuthenticated: true, canSend: true });
      const editor = getEditor();
      typeInEditor(editor, "first");
      fireEvent.keyDown(editor, { key: "Enter" });
      typeInEditor(editor, "new draft");

      await act(async () => {
        rejectSend(new Error("Network failed"));
        await pendingSend.catch(() => undefined);
      });

      expect(editor).toHaveTextContent("new draft");
      expect(screen.getByText("Network failed")).toBeInTheDocument();
    }
  );

  it("Enter sends the message on Twitch", async () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const editor = getEditor();
    typeInEditor(editor, "hello");
    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });
    // Third arg is the optimistic-echo localFragments (built from emote slots;
    // a plain text message produces a single text fragment).
    expect(twitchChatService.sendMessage).toHaveBeenCalledWith("ninja", "hello", [
      { type: "text", content: "hello" },
    ]);
  });

  it("Shift+Enter does NOT send", async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(twitchChatService.sendMessage).mockClear();
    renderInput();
    const editor = getEditor();
    typeInEditor(editor, "line1");
    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    });
    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
  });

  it("/me uses the Twitch provider command path", async () => {
    infoBannerImpl.mockReturnValue(null);
    const onProviderCommand = vi.fn(async () => {});
    renderInput({
      commandAccess: { kind: "authenticated", platform: "twitch", role: "viewer" },
      onProviderCommand,
    });
    const editor = getEditor();
    typeInEditor(editor, "/me waves");
    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });
    expect(onProviderCommand).toHaveBeenCalledWith(
      expect.objectContaining({ args: "waves", command: expect.objectContaining({ name: "me" }) })
    );
    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
  });

  it("selects a command with the keyboard without sending ordinary chat text", async () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({
      commandAccess: { kind: "authenticated", platform: "twitch", role: "viewer" },
      onProviderCommand: vi.fn(async () => {}),
    });
    const editor = getEditor();
    typeInEditor(editor, "/me");

    await screen.findByRole("option", { name: /\/me \[message\]/i });
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(editor.textContent).toBe("/me ");
    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
  });

  it("/me uses the Kick provider command path", async () => {
    infoBannerImpl.mockReturnValue(null);
    const onProviderCommand = vi.fn(async () => {});
    renderInput({
      platform: "kick",
      commandAccess: { kind: "authenticated", platform: "kick", role: "viewer" },
      onProviderCommand,
    });
    const editor = getEditor();
    typeInEditor(editor, "/me hi");
    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });
    expect(onProviderCommand).toHaveBeenCalledWith(
      expect.objectContaining({ args: "hi", command: expect.objectContaining({ name: "me" }) })
    );
    expect(kickChatService.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps unknown slash text in the editor and does not send it as chat", async () => {
    infoBannerImpl.mockReturnValue(null);
    const onProviderCommand = vi.fn(async () => {});
    renderInput({
      commandAccess: { kind: "authenticated", platform: "twitch", role: "viewer" },
      onProviderCommand,
    });
    const editor = getEditor();
    typeInEditor(editor, "/not-a-command");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(editor).toHaveTextContent("/not-a-command");
    expect(screen.getByText("Unknown or unavailable command: /not-a-command")).toBeInTheDocument();
    expect(onProviderCommand).not.toHaveBeenCalled();
    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps malformed slash commands in the editor and does not call the provider", async () => {
    infoBannerImpl.mockReturnValue(null);
    const onProviderCommand = vi.fn(async () => {});
    renderInput({
      commandAccess: { kind: "authenticated", platform: "twitch", role: "moderator" },
      onProviderCommand,
    });
    const editor = getEditor();
    typeInEditor(editor, "/ban ");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(editor).toHaveTextContent("/ban");
    expect(screen.getByText("/ban needs a username")).toBeInTheDocument();
    expect(onProviderCommand).not.toHaveBeenCalled();
  });

  it("restores a slash command when its provider execution fails", async () => {
    infoBannerImpl.mockReturnValue(null);
    const onProviderCommand = vi.fn(async () => {
      throw new Error("Twitch rejected the command");
    });
    renderInput({
      commandAccess: { kind: "authenticated", platform: "twitch", role: "moderator" },
      onProviderCommand,
    });
    const editor = getEditor();
    typeInEditor(editor, "/ban @viewer");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(editor).toHaveTextContent("/ban @viewer");
    expect(screen.getByText("Twitch rejected the command")).toBeInTheDocument();
    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
  });

  it("/help filters the visible command reference without calling the provider", async () => {
    infoBannerImpl.mockReturnValue(null);
    const onProviderCommand = vi.fn(async () => {});
    renderInput({
      commandAccess: { kind: "authenticated", platform: "twitch", role: "moderator" },
      onProviderCommand,
    });
    const editor = getEditor();
    typeInEditor(editor, "/help ban");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(screen.getByRole("option", { name: /\/ban \[username\]/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /\/block \[username\]/i })).toBeNull();
    expect(onProviderCommand).not.toHaveBeenCalled();
  });
});

// Guards: the counter reflects the remaining limit and blocks over-limit sends with actionable feedback.
describe("ChatInput — character counter", () => {
  it("renders countdown when typing; not when empty", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ maxLength: 100 });
    expect(screen.queryByText("100")).toBeNull();
    typeInEditor(getEditor(), "abc");
    expect(screen.getByText("97")).toBeInTheDocument();
  });

  it("styles the counter red when over the limit", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ maxLength: 5 });
    typeInEditor(getEditor(), "1234567");
    const counter = screen.getByText("-2");
    expect(counter).toHaveClass("text-red-500");
  });

  it("styles the counter yellow when within 50 of the limit", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ maxLength: 100 });
    // 60 chars → 40 remaining → yellow
    typeInEditor(getEditor(), "a".repeat(60));
    expect(screen.getByText("40")).toHaveClass("text-yellow-500");
  });
  it("shows a toast and does not send when the user tries an over-limit message", async () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ maxLength: 500 });
    const editor = getEditor();

    typeInEditor(editor, "a".repeat(501));
    const chatButton = screen.getByRole("button", { name: "Chat" });
    expect(chatButton).not.toBeDisabled();
    expect(chatButton).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(chatButton);
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Message is too long", {
      id: "chat-message-too-long",
      description: "Twitch and Kick messages can be up to 500 characters.",
    });
    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
  });
});

// Guards: imperative draft, mention, and reply actions update and focus the composer without sending.
describe("ChatInput — imperative handle", () => {
  // Guards: Copy message to chat replaces the editable draft on both platforms and never sends it automatically.
  it.each(["twitch", "kick"] as const)(
    "setDraft places exact plain text in the %s composer without sending",
    (platform) => {
      infoBannerImpl.mockReturnValue(null);
      const ref = createRef<ChatInputHandle>();
      renderWithTooltipProvider(
        <ChatInput ref={ref} channel="ninja" platform={platform} channelId="12345" />
      );
      const editor = getEditor();
      typeInEditor(editor, "old draft");

      act(() => ref.current?.setDraft("Hello Kappa @bob"));

      expect(editor.textContent).toBe("Hello Kappa @bob");
      expect(document.activeElement).toBe(editor);
      expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
      expect(kickChatService.sendMessage).not.toHaveBeenCalled();
    }
  );

  it("mentionUser prepends @username and focuses", () => {
    infoBannerImpl.mockReturnValue(null);
    const ref = createRef<ChatInputHandle>();
    renderWithTooltipProvider(
      <ChatInput ref={ref} channel="ninja" platform="twitch" channelId="12345" />
    );
    act(() => ref.current?.mentionUser("alice"));
    expect(getEditor().textContent).toBe("@alice ");
  });

  it("mentionUser focuses the rich editor synchronously", () => {
    infoBannerImpl.mockReturnValue(null);
    const ref = createRef<ChatInputHandle>();
    renderWithTooltipProvider(
      <ChatInput ref={ref} channel="ninja" platform="twitch" channelId="12345" />
    );
    act(() => ref.current?.mentionUser("alice"));
    const editor = getEditor();
    expect(editor.textContent).toBe("@alice ");
    expect(document.activeElement).toBe(editor);
  });

  it("replyTo sets the reply preview", () => {
    infoBannerImpl.mockReturnValue(null);
    const ref = createRef<ChatInputHandle>();
    renderWithTooltipProvider(
      <ChatInput ref={ref} channel="ninja" platform="twitch" channelId="12345" />
    );
    const msg: ChatMessage = {
      id: "m1",
      platform: "twitch",
      type: "message",
      channel: "ninja",
      userId: "u1",
      username: "alice",
      displayName: "Alice",
      color: "#fff",
      badges: [],
      content: [{ type: "text", content: "hello" }],
      rawContent: "hello there",
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };
    act(() => ref.current?.replyTo(msg));
    expect(screen.getByTestId("reply-preview")).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });
});

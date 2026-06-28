/**
 * ChatInput tests — U9 layout.
 *
 * The new ChatInput hosts InfoBanner + two emote buttons (each with its own
 * EmotePickerPopover), the quick settings gear, and the footer Chat button.
 * We mock InfoBanner and popovers at the module boundary to keep these tests
 * focused on the input shell + wiring; the real components have their own
 * test suites.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  isLoading: false,
  getProviderEmotes: () => [],
  getEmotesByProvider: () => new Map(),
  getAllEmotes: () => [],
  addRecentEmote: vi.fn(),
  toggleFavorite: vi.fn(),
  isFavorite: () => false,
}));

vi.mock("@/backend/services/chat/kick-chat", () => ({
  KickChatSendError: class KickChatSendError extends Error {
    kickSendResult: {
      ok: false;
      kind: string;
      message: string;
      retryAfterSeconds?: number;
    };

    constructor(result: {
      ok: false;
      kind: string;
      message: string;
      retryAfterSeconds?: number;
    }) {
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
vi.mock("@/backend/services/chat/twitch-chat", () => ({
  twitchChatService: {
    sendMessage: vi.fn(async () => true),
    sendAction: vi.fn(async () => true),
    sendReply: vi.fn(async () => true),
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
  return { useEmoteStore };
});

// Mock InfoBanner — we control its visibility per test via the impl.
const infoBannerImpl = vi.fn();
vi.mock("@/components/chat/InfoBanner", () => ({
  InfoBanner: (props: {
    platform: string;
    channelId: string | null;
    viewerSatisfiesFollowerOnly?: boolean;
  }) => infoBannerImpl(props) ?? null,
}));

// Mock EmotePickerPopover so we can assert open/closed state without pulling
// in the popover's portal positioning / shallow-zustand wiring.
vi.mock("@/components/chat/EmotePickerPopover", () => ({
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

vi.mock("@/components/chat/ChatQuickSettingsPopover", () => ({
  ChatQuickSettingsPopover: (props: {
    platform?: "kick" | "twitch";
    placement?: "bottom" | "top";
    triggerRef?: { current: HTMLElement | null };
  }) => {
    quickSettingsPopoverCalls.push(props);
    return <div data-testid="chat-quick-settings-popover" />;
  },
}));

vi.mock("@/components/chat/EmoteAutocomplete", () => {
  const ctl = {
    isActive: false,
    openAutocomplete: vi.fn(),
    closeAutocomplete: vi.fn(),
    deactivate: vi.fn(),
    checkTrigger: vi.fn(),
  };
  return {
    EmoteAutocomplete: () => null,
    useEmoteAutocomplete: () => ctl,
  };
});

// Both emote buttons now look up the channel avatar for the picker's
// channel-tab thumbnail. Stub the hook so we don't need a QueryClientProvider
// in this shell-focused suite.
vi.mock("@/hooks/queries/useChannels", () => ({
  useChannelByUsername: () => ({ data: undefined }),
}));

vi.mock("@/components/chat/MentionAutocomplete", () => {
  return {
    MentionAutocomplete: ({ isActive }: { isActive: boolean }) =>
      isActive ? <div data-testid="mention-autocomplete-anchor" /> : null,
    useMentionAutocomplete: () => mentionAutocompleteCtl,
  };
});

import { KickChatSendError, kickChatService } from "@/backend/services/chat/kick-chat";
import { twitchChatService } from "@/backend/services/chat/twitch-chat";
import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import type { Emote, EmoteProvider } from "@/backend/services/emotes/emote-types";
import { ChatInput, type ChatInputHandle } from "@/components/chat/ChatInput";
import { useFollowStore } from "@/store/follow-store";
import type { ChatMessage } from "@/shared/chat-types";
import { useRoomStateStore } from "@/store/room-state-store";

beforeEach(() => {
  emotePickerPopoverCalls.length = 0;
  quickSettingsPopoverCalls.length = 0;
  emoteStoreState.loadedGlobalPlatforms = new Set();
  emoteStoreState.loadedChannels = new Set();
  emoteStoreState.emoteRevision = 0;
  emoteStoreState.activeChannelId = null;
  emoteStoreState.favoriteEmotes = [];
  emoteStoreState.recentEmotes = [];
  emoteStoreState.getEmotesByProvider = () => new Map();
  emoteStoreState.getAllEmotes = () => [];
  emoteStoreState.addRecentEmote.mockClear();
  emoteStoreState.toggleFavorite.mockClear();
  vi.mocked(twitchChatService.sendMessage).mockClear();
  vi.mocked(twitchChatService.sendReply).mockClear();
  vi.mocked(twitchChatService.sendAction).mockClear();
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
});

function renderInput(overrides: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  return render(<ChatInput channel="ninja" platform="twitch" channelId="12345" {...overrides} />);
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

describe("ChatInput — basics", () => {
  it("renders a rich textbox with the default placeholder", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    expect(getEditor()).toBeInTheDocument();
    expect(screen.getByText("Send a message...")).toHaveClass(
      "flex",
      "items-center",
      "justify-start",
      "text-left"
    );
  });

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

  it("honors a custom placeholder", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ placeholder: "Type here..." });
    expect(getEditor("Type here...")).toBeInTheDocument();
    expect(screen.getByText("Type here...")).toBeInTheDocument();
  });

  it("updates input value as the user types", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const editor = getEditor();
    typeInEditor(editor, "hi");
    expect(editor).toHaveTextContent("hi");
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

  it("respects the disabled prop", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ disabled: true });
    expect(getEditor()).toHaveAttribute("aria-disabled", "true");
    expect(getEditor()).toHaveAttribute("contenteditable", "false");
  });

  it('shows "Log in to chat" placeholder when canSend=false', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ canSend: false });
    expect(getEditor(/log in to chat/i)).toBeInTheDocument();
    expect(screen.getByText("Log in to chat")).toBeInTheDocument();
  });

  it("lets signed-out Twitch viewers keep a draft and open auth from Enter", async () => {
    infoBannerImpl.mockReturnValue(null);
    const onAuthRequired = vi.fn(async () => {});
    renderInput({ canSend: false, isAuthenticated: false, onAuthRequired });
    const editor = getEditor(/log in to chat/i);

    expect(editor).toHaveAttribute("contenteditable", "true");

    act(() => {
      editor.focus();
      fireEvent.keyDown(editor, { key: "h" });
      fireEvent.keyDown(editor, { key: "i" });
    });

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(onAuthRequired).toHaveBeenCalledWith("twitch");
    expect(screen.getByTestId("chat-send-blocker")).toHaveTextContent("Log in to chat");
    expect(editor).toHaveTextContent("hi");
    expect(document.activeElement).toBe(editor);
  });

  it("lets signed-out Kick viewers keep a draft and open auth from Enter", async () => {
    infoBannerImpl.mockReturnValue(null);
    const onAuthRequired = vi.fn(async () => {});
    renderInput({ platform: "kick", canSend: false, isAuthenticated: false, onAuthRequired });
    const editor = getEditor(/sign in to chat/i);

    act(() => {
      editor.focus();
      fireEvent.keyDown(editor, { key: "y" });
      fireEvent.keyDown(editor, { key: "o" });
    });

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(onAuthRequired).toHaveBeenCalledWith("kick");
    expect(screen.getByTestId("chat-send-blocker")).toHaveTextContent("Sign in to chat");
    expect(editor).toHaveTextContent("yo");
    expect(document.activeElement).toBe(editor);
  });

  it("keeps reply state when auth blocks a send", async () => {
    infoBannerImpl.mockReturnValue(null);
    const onAuthRequired = vi.fn(async () => {});
    const ref = createRef<ChatInputHandle>();
    render(
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
    const editor = getEditor(/log in to chat/i);
    typeInEditor(editor, "reply draft");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(onAuthRequired).toHaveBeenCalledWith("twitch");
    expect(screen.getByTestId("reply-preview")).toBeInTheDocument();
    expect(editor).toHaveTextContent("reply draft");
  });
});

// Guards: room-state send blockers must preserve draft editing and reuse the existing InfoBanner surface.
describe("ChatInput — room-state send blockers", () => {
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
    render(
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
    renderInput({ isAuthenticated: true, canSend: true, checkSubscriberEligibility, onAuthRequired });
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
    renderInput({ platform: "kick", isAuthenticated: true, canSend: true, checkSubscriberEligibility });
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
    renderInput({ platform: "kick", isAuthenticated: true, canSend: true, checkSubscriberEligibility });
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
describe("ChatInput — send rejection blockers", () => {
  it("uses Twitch phone-verification copy when Twitch rejects the send", async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(twitchChatService.sendMessage).mockRejectedValueOnce(
      new Error("This room requires a verified phone number to chat")
    );
    const onOpenChannelPage = vi.fn(async () => {});
    renderInput({ isAuthenticated: true, canSend: true, onOpenChannelPage });
    const editor = getEditor();
    typeInEditor(editor, "phone gated");

    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    expect(screen.getByTestId("chat-send-blocker")).toHaveTextContent(
      "Add a phone number to chat on Twitch"
    );
    const blocker = screen.getByTestId("chat-send-blocker");
    expect(within(blocker).getByRole("button", { name: /open twitch/i })).toBeInTheDocument();
    expect(editor).toHaveTextContent("phone gated");
    expect(screen.queryByText("This room requires a verified phone number to chat")).toBeNull();

    await act(async () => {
      fireEvent.click(within(blocker).getByRole("button", { name: /open twitch/i }));
    });

    expect(onOpenChannelPage).toHaveBeenCalledWith("twitch", "ninja");
  });

  it("uses Twitch email-verification copy when Twitch rejects the send", async () => {
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

    expect(screen.getByTestId("chat-send-blocker")).toHaveTextContent(
      "Verify your email to chat on Twitch"
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

    expect(screen.getByTestId("chat-send-blocker")).toHaveTextContent(
      "Slow mode active. Wait 7s."
    );
    expect(editor).toHaveTextContent("too fast");
  });
});

// Guards: chat input footer keeps a platform-neutral white Chat submit button beside the white settings gear.
// Guards: footer Chat submit uses the same send path as Enter, so button-send and keyboard-send stay in sync.
// Guards: settings gear and Chat submit stay below the editor in a second row without moving emote pickers down.
// Guards: only the editor/emote row is outlined; footer actions stay outside the input box outline.
// Guards: quick settings popover anchors to the full footer row so it stays inside the chat width.
describe("ChatInput — footer actions", () => {
  it("renders the old white settings gear next to a neutral Chat button", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const settingsButton = screen.getByRole("button", { name: /chat settings/i });
    expect(settingsButton).toHaveClass("text-white");
    expect(settingsButton).toHaveClass("h-8", "w-8", "rounded-full", "hover:bg-[#232629]");
    expect(settingsButton.querySelector("svg")).toHaveStyle({ stroke: "currentColor" });
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

  it("opens quick settings upward from the footer gear", () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const settingsButton = screen.getByRole("button", { name: /chat settings/i });
    fireEvent.click(settingsButton);
    expect(screen.getByTestId("chat-quick-settings-popover")).toBeInTheDocument();
    expect(screen.getByTestId("chat-quick-settings-popover").parentElement).toBe(
      screen.getByTestId("chat-input-action-row")
    );
    expect(quickSettingsPopoverCalls.at(-1)?.placement).toBe("top");
    expect(quickSettingsPopoverCalls.at(-1)?.platform).toBe("twitch");
    expect(quickSettingsPopoverCalls.at(-1)?.triggerRef?.current).toBe(settingsButton);
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
    render(<ChatInput ref={ref} channel="ninja" platform="twitch" channelId="12345" />);
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
describe("ChatInput — quick emote action bar", () => {
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
    emoteStoreState.recentEmotes = [recentSevenTv];
    emoteStoreState.getEmotesByProvider = () =>
      new Map<EmoteProvider, Emote[]>([["twitch", [globalTwitch]]]);

    renderInput();

    expect(screen.getAllByTestId("quick-emote-button").map((button) => button.ariaLabel)).toEqual([
      "Use recentSTV",
      "Use Kappa",
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
    expect(emoteStoreState.addRecentEmote).toHaveBeenCalledWith(globalTwitch);
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
    expect(emoteStoreState.addRecentEmote).toHaveBeenCalledWith(kickEmote);
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

describe("ChatInput - mention editing", () => {
  it("anchors mention results to the full text row width", () => {
    infoBannerImpl.mockReturnValue(null);
    mentionAutocompleteCtl.isActive = true;
    renderInput();

    const popup = screen.getByTestId("mention-autocomplete-anchor");
    expect(popup.parentElement).toBe(screen.getByTestId("chat-input-text-row"));
    expect(screen.getByTestId("chat-input-text-row")).toHaveClass("relative");
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

describe("ChatInput — Enter / Shift+Enter", () => {
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

  it("/me routes to sendAction on Twitch", async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(twitchChatService.sendAction).mockClear();
    renderInput();
    const editor = getEditor();
    typeInEditor(editor, "/me waves");
    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });
    expect(twitchChatService.sendAction).toHaveBeenCalledWith("ninja", "waves");
  });

  it("/me on Kick wraps in asterisks via sendMessage", async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(kickChatService.sendMessage).mockClear();
    renderInput({ platform: "kick" });
    const editor = getEditor();
    typeInEditor(editor, "/me hi");
    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });
    // ChatInput passes `kickUser ?? undefined` as the third arg so Kick's
    // optimistic echo can stamp the local user's badges on outbound messages.
    expect(kickChatService.sendMessage).toHaveBeenCalledWith("ninja", "*hi*", undefined);
  });
});

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
});

describe("ChatInput — imperative handle", () => {
  it("mentionUser prepends @username and focuses", () => {
    infoBannerImpl.mockReturnValue(null);
    const ref = createRef<ChatInputHandle>();
    render(<ChatInput ref={ref} channel="ninja" platform="twitch" channelId="12345" />);
    act(() => ref.current?.mentionUser("alice"));
    expect(getEditor().textContent).toBe("@alice ");
  });

  it("mentionUser focuses the rich editor synchronously", () => {
    infoBannerImpl.mockReturnValue(null);
    const ref = createRef<ChatInputHandle>();
    render(<ChatInput ref={ref} channel="ninja" platform="twitch" channelId="12345" />);
    act(() => ref.current?.mentionUser("alice"));
    const editor = getEditor();
    expect(editor.textContent).toBe("@alice ");
    expect(document.activeElement).toBe(editor);
  });

  it("replyTo sets the reply preview", () => {
    infoBannerImpl.mockReturnValue(null);
    const ref = createRef<ChatInputHandle>();
    render(<ChatInput ref={ref} channel="ninja" platform="twitch" channelId="12345" />);
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

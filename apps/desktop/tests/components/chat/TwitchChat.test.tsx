import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatDisplayPreferences, DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@/shared/auth-types";
import type { ChatMessage, NormalizedPinnedMessage } from "@/shared/chat-types";
import { installElectronAPIMock, renderWithProviders as render } from "../../test-utils";

// U11 — capture the latest ChatMessageList props so tests can simulate a
// toolbar click without rendering the full message virtuoso.
const lastListProps: {
  channelKey?: string;
  onBan?: (m: unknown) => void;
  onTimeout?: (m: unknown) => void;
  onUnban?: (m: unknown) => void;
  onDelete?: (m: unknown) => void;
  onPin?: (m: unknown) => void;
  selfUserId?: string;
} = {};
// Helper mocks must be hoisted, but referenced module-locally in tests too.
const banUserMock = vi.fn();
const timeoutUserMock = vi.fn();
const unbanUserMock = vi.fn();
const deleteChatMessageMock = vi.fn();
const pinChatMessageMock = vi.fn();
const updatePinnedChatMessageMock = vi.fn();
const eventSubUnsubscribeMock = vi.fn();
const eventSubModerateHandlers: Array<(payload: unknown) => void> = [];

vi.mock("@/backend/api/platforms/twitch/twitch-gql-pin-mutations", () => ({
  pinChatMessage: (...args: unknown[]) => pinChatMessageMock(...args),
  updatePinnedChatMessage: (...args: unknown[]) => updatePinnedChatMessageMock(...args),
  unpinChatMessage: vi.fn(),
}));

vi.mock("@/backend/api/platforms/twitch/twitch-helix-moderation-mutations", () => ({
  banUser: (...args: unknown[]) => banUserMock(...args),
  timeoutUser: (...args: unknown[]) => timeoutUserMock(...args),
  unbanUser: (...args: unknown[]) => unbanUserMock(...args),
  deleteChatMessage: (...args: unknown[]) => deleteChatMessageMock(...args),
}));

vi.mock("@/backend/api/platforms/twitch/twitch-helix-moderation", () => ({
  getModeratedChannels: vi.fn(),
}));

vi.mock("@/backend/api/platforms/twitch/twitch-eventsub-client", () => ({
  getTwitchEventSubClient: vi.fn(() => ({
    subscribe: vi.fn((eventType: string, channelId: string, handler: (payload: unknown) => void) => {
      if (eventType === "channel.moderate" && channelId === "ninja-id") {
        eventSubModerateHandlers.push(handler);
      }
      return eventSubUnsubscribeMock;
    }),
  })),
}));

const promptReconnectMock = vi.fn();
const mockModScopes = { hasModScopes: true, loading: false };
vi.mock("@/hooks/useRequireModScopes", () => ({
  useRequireModScopes: () => ({
    hasModScopes: mockModScopes.hasModScopes,
    loading: mockModScopes.loading,
    promptReconnect: promptReconnectMock,
  }),
}));

// Mutable mod flag. Defaults to mod (most existing tests exercise the
// mod-action paths). The U7 viewer-path gear test flips it to false so
// ChatPanelTabs takes its single-tab (no-chrome) branch.
const mockIsTwitchMod = { value: true };
vi.mock("@/hooks/useIsTwitchMod", () => ({
  useIsTwitchMod: () => mockIsTwitchMod.value,
}));

// Mutable chatDisplay prefs the mocked auth store hands back. Tests flip
// individual U5 flags via setMockChatDisplay() before rendering. Reset in
// beforeEach so flags don't leak between tests.
const mockChatDisplay: { value: ChatDisplayPreferences } = {
  value: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES },
};
function setMockChatDisplay(overrides: Partial<ChatDisplayPreferences>) {
  mockChatDisplay.value = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...overrides };
}

vi.mock("@/store/auth-store", () => {
  // TwitchChat's `isAuthenticated` is a useAuthStore selector reading
  // `twitchConnected && !twitchReconnectRequired` (commit 9c4bbf7). The
  // mock has to expose those fields or the selector returns `undefined`
  // and `canSend` becomes `undefined && bool === undefined` — which masks
  // the booleanness the chat input gate depends on.
  //
  // `preferences.chatDisplay` is read both reactively (showPredictions
  // selector) and imperatively (handleUserNotice via getState()), so the
  // getter pulls from the mutable holder above on every access.
  const buildState = () => ({
    twitchUser: { id: "mod-1", login: "modder", displayName: "Modder" },
    twitchConnected: false,
    twitchReconnectRequired: false,
    kickConnected: false,
    kickReconnectRequired: false,
    preferences: { chatDisplay: mockChatDisplay.value },
  });
  const useAuthStore = (selector?: (s: ReturnType<typeof buildState>) => unknown) => {
    const state = buildState();
    return selector ? selector(state) : state;
  };
  (useAuthStore as unknown as { getState: () => ReturnType<typeof buildState> }).getState = () =>
    buildState();
  return { useAuthStore };
});

// Capture the chat-service event handlers so tests can fire userNotice /
// predictionUpdate without a real socket. Keyed by event name; `on` records,
// `off` clears.
const mockServiceHandlers: Record<string, ((arg: unknown) => void) | undefined> = {};
vi.mock("@/backend/services/chat/twitch-chat", () => ({
  twitchChatService: {
    connect: vi.fn(async () => true),
    disconnect: vi.fn(async () => true),
    subscribe: vi.fn(() => () => {}),
    acquire: vi.fn(() => undefined),
    release: vi.fn(() => undefined),
    isConnected: vi.fn(() => false),
    sendMessage: vi.fn(async () => true),
    on: vi.fn((event: string, handler: (arg: unknown) => void) => {
      mockServiceHandlers[event] = handler;
    }),
    off: vi.fn((event: string) => {
      mockServiceHandlers[event] = undefined;
    }),
    emit: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    onConnectionStateChange: vi.fn(() => () => {}),
    // Needed so the connect-effect doesn't short-circuit on an undefined
    // getConnectionStatus call. The platform-scoped loadGlobalEmotes assertion
    // below depends on the effect reaching past this check.
    getConnectionStatus: vi.fn(() => ({ state: "connected" })),
    loadChannelBadges: vi.fn(async () => true),
    joinChannel: vi.fn(async () => true),
  },
}));

vi.mock("@/backend/services/emotes", () => ({
  initializeTwitchEmotes: vi.fn(),
  initializeKickEmotes: vi.fn(),
}));

// The Hermes client opens a real WebSocket on start(); stub it so the unit
// test neither hits the network nor surfaces undici's async WS errors. U5's
// prediction path is exercised by firing the predictionUpdate service handler.
vi.mock("@/backend/services/chat/twitch-hermes-client", () => ({
  TwitchHermesClient: class {
    on() {}
    off() {}
    start() {}
    stop() {}
  },
}));

const storeState = {
  connectionStatus: {
    twitch: { platform: "twitch", state: "disconnected", channels: [], isAuthenticated: false },
    kick: { platform: "kick", state: "disconnected", channels: [], isAuthenticated: false },
  },
  messagesByChannel: {} as Record<string, ChatMessage[]>,
  clearMessages: vi.fn(),
  setPaused: vi.fn(),
  addMessage: vi.fn(),
  addMessageBatched: vi.fn(),
  flushBatch: vi.fn(),
  prependMessages: vi.fn(),
  updateConnectionStatus: vi.fn(),
  deleteMessage: vi.fn(),
  deleteMessagesByUser: vi.fn(),
  rehydrateChannelBadges: vi.fn(),
  cleanupBatching: vi.fn(),
};

vi.mock("@/store/chat-store", () => {
  const useChatStore = ((selector?: (s: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState) as ((
    selector?: (s: typeof storeState) => unknown
  ) => unknown) & {
    getState: () => typeof storeState;
  };
  useChatStore.getState = () => storeState;
  return {
    buildChannelKey: (platform: string, channel: string) => `${platform}:${channel}`,
    useChatStore,
  };
});

const loadGlobalEmotesMock = vi.fn();
const loadChannelEmotesMock = vi.fn();
vi.mock("@/store/emote-store", () => {
  const state = {
    loadedChannels: new Set(),
    setActiveChannel: vi.fn(),
    loadChannelEmotes: (...args: unknown[]) => loadChannelEmotesMock(...args),
    loadGlobalEmotes: (...args: unknown[]) => loadGlobalEmotesMock(...args),
    getEmoteNameMap: vi.fn(() => new Map()),
    unloadChannelEmotes: vi.fn(),
    applyProviderPrefs: vi.fn(),
  };
  const useEmoteStore = ((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state) as ((
    selector?: (s: typeof state) => unknown
  ) => unknown) & {
    getState: () => typeof state;
  };
  useEmoteStore.getState = () => state;
  return {
    useEmoteStore,
  };
});

const lastPinnedBannerProps: {
  onUpdateDuration?: (durationSeconds: number | null) => void | Promise<void>;
} = {};
vi.mock("@/components/chat/PinnedMessageBanner", () => ({
  PinnedMessageBanner: (props: typeof lastPinnedBannerProps) => {
    lastPinnedBannerProps.onUpdateDuration = props.onUpdateDuration;
    return <div data-testid="pinned-message-banner">pinned</div>;
  },
}));

vi.mock("@/components/chat/ChatMessageList", () => ({
  ChatMessageList: (props: typeof lastListProps) => {
    lastListProps.channelKey = props.channelKey;
    lastListProps.onBan = props.onBan;
    lastListProps.onTimeout = props.onTimeout;
    lastListProps.onUnban = props.onUnban;
    lastListProps.onDelete = props.onDelete;
    lastListProps.onPin = props.onPin;
    lastListProps.selfUserId = props.selfUserId;
    return <div data-testid="message-list">messages</div>;
  },
}));

const chatInputProps: { canSend?: boolean } = {};
vi.mock("@/components/chat/ChatInput", () => ({
  ChatInput: (props: { canSend?: boolean }) => {
    chatInputProps.canSend = props.canSend;
    return (
      <div data-testid="chat-input">
        input
        <button type="button" aria-label="Chat settings">
          settings
        </button>
      </div>
    );
  },
}));

// Stub the prediction banner to a marker so U5's showPredictions gate can be
// asserted without the real countdown / dismiss internals.
vi.mock("@/components/chat/PredictionBanner", () => ({
  PredictionBanner: () => <div data-testid="prediction-banner">prediction</div>,
}));

import { getModeratedChannels } from "@/backend/api/platforms/twitch/twitch-helix-moderation";
import { getTwitchEventSubClient } from "@/backend/api/platforms/twitch/twitch-eventsub-client";
import { twitchChatService } from "@/backend/services/chat/twitch-chat";
import { initializeTwitchEmotes } from "@/backend/services/emotes";
import { TwitchChat } from "@/components/chat/twitch/TwitchChat";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

const getModeratedChannelsMock = vi.mocked(getModeratedChannels);

// Minimal active prediction matching the channelId the multiview gate compares.
const fakePrediction = {
  id: "pred-1",
  platform: "twitch",
  channelId: "ninja-id",
  channelSlug: "ninja",
  title: "Who wins?",
  status: "ACTIVE",
  outcomes: [],
  winningOutcomeId: null,
  predictionWindowSeconds: 60,
  endedAt: null,
  viewerOutcomeId: null,
  viewerStake: null,
} as const;

// Guards: loading state — canSend stays false while Hermes is connecting and the IRC token is resolving (selector returns boolean primitive, not undefined)
// Guards: connecting state appears immediately before Twitch token/network setup finishes, so the chat panel never looks blank on slow joins
// Guards: error path — a missing-scopes Helix response triggers promptReconnect with the listed scopes, surfacing the ReconnectForModDialog rather than silently no-opping
// Guards: empty messages — message list still renders (see ChatMessageList tests); chat input + chat-settings gear render in viewer single-tab path (U7) so the chrome doesn't disappear under the tab-shell refactor
// Guards: U5 prefs — sub/raid notice + chat-cleared notice + prediction banner each suppress when their visibility pref is false. clearMessages('twitch:ninja') still runs even when its notice is suppressed (moderation action is real, only the notice text is hidden)
// Guards: U11 — Ban toolbar click opens ModActionConfirmDialog; confirm fires banUser with the broadcaster/moderator/user ids assembled from the page route
// Guards: Twitch chat loads badges with the watched channel id, not the signed-in user's id, so channel subscriber badges resolve for other broadcasters.
// Guards: Twitch singleton message events from a previous channel are ignored after route-switch so old channel badges/messages cannot leak into the new channel bucket.
// Guards: Twitch chat force-refreshes the active channel's badge catalog so custom subscriber badge updates appear without restarting the app.
// Guards: Twitch channel.moderate delete notifications attach the deleting moderator to retained deleted-message rows; IRC CLEARMSG alone cannot provide that actor.
describe("TwitchChat", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_TWITCH_CLIENT_ID", "test-client-id");
    const api = installElectronAPIMock();
    // Provide a Twitch token so the U11 onConfirm path doesn't early-out.
    api.auth.getToken = vi.fn(async () => ({ accessToken: "tok", scope: [] }));
    storeState.connectionStatus.kick.state = "disconnected";
    storeState.connectionStatus.twitch.state = "disconnected";
    storeState.messagesByChannel = {};
    chatInputProps.canSend = undefined;
    lastListProps.onBan = undefined;
    lastListProps.onTimeout = undefined;
    lastListProps.onUnban = undefined;
    lastListProps.onDelete = undefined;
    lastListProps.onPin = undefined;
    lastListProps.selfUserId = undefined;
    lastListProps.channelKey = undefined;
    banUserMock.mockReset();
    timeoutUserMock.mockReset();
    unbanUserMock.mockReset();
    deleteChatMessageMock.mockReset();
    pinChatMessageMock.mockReset();
    updatePinnedChatMessageMock.mockReset();
    eventSubUnsubscribeMock.mockReset();
    eventSubModerateHandlers.length = 0;
    lastPinnedBannerProps.onUpdateDuration = undefined;
    mockModScopes.hasModScopes = true;
    mockModScopes.loading = false;
    promptReconnectMock.mockReset();
    vi.mocked(twitchChatService.connect).mockClear();
    vi.mocked(twitchChatService.loadChannelBadges).mockClear();
    vi.mocked(twitchChatService.joinChannel).mockClear();
    vi.mocked(getTwitchEventSubClient).mockClear();
    loadGlobalEmotesMock.mockReset();
    loadChannelEmotesMock.mockReset();
    vi.mocked(initializeTwitchEmotes).mockReset();
    getModeratedChannelsMock.mockReset();
    storeState.addMessage = vi.fn();
    storeState.addMessageBatched = vi.fn();
    storeState.clearMessages = vi.fn();
    storeState.deleteMessagesByUser = vi.fn();
    storeState.rehydrateChannelBadges = vi.fn();
    setMockChatDisplay({});
    mockIsTwitchMod.value = true;
    useModeratedChannelsStore.getState().clear();
    for (const k of Object.keys(mockServiceHandlers)) delete mockServiceHandlers[k];
  });

  it("renders message list and chat input", () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });

  it("passes the per-channel key to ChatMessageList", () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    expect(lastListProps.channelKey).toBe("twitch:ninja");
  });

  it("loads Twitch channel badges with the watched channel id", async () => {
    const api = installElectronAPIMock();
    api.auth.getValidTwitchToken = vi.fn(async () => "tok");
    api.auth.getTwitchUser = vi.fn(async () => ({
      id: "mod-1",
      login: "modder",
      displayName: "Modder",
    }));
    api.chat.getTwitchHistory = vi.fn(async () => ({ success: true, data: { rawMessages: [] } }));

    render(<TwitchChat channel="ninja" channelId="ninja-id" />);

    await waitFor(() => expect(twitchChatService.loadChannelBadges).toHaveBeenCalled());
    expect(twitchChatService.loadChannelBadges).toHaveBeenCalledWith("ninja", "ninja-id");
    expect(twitchChatService.loadChannelBadges).not.toHaveBeenCalledWith("ninja", "mod-1");
  });

  it("force-refreshes active Twitch channel badges on an interval", () => {
    vi.useFakeTimers();
    try {
      render(<TwitchChat channel="ninja" channelId="ninja-id" />);

      expect(twitchChatService.loadChannelBadges).toHaveBeenCalledWith("ninja", "ninja-id", {
        forceRefresh: true,
      });
      const callsBeforeInterval = vi.mocked(twitchChatService.loadChannelBadges).mock.calls.length;

      act(() => {
        vi.advanceTimersByTime(5 * 60 * 1000);
      });

      expect(vi.mocked(twitchChatService.loadChannelBadges).mock.calls.length).toBeGreaterThan(
        callsBeforeInterval
      );
      expect(twitchChatService.loadChannelBadges).toHaveBeenLastCalledWith("ninja", "ninja-id", {
        forceRefresh: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rehydrates retained messages after an interval badge refresh succeeds", async () => {
    vi.useFakeTimers();
    try {
      render(<TwitchChat channel="ninja" channelId="ninja-id" />);
      await act(async () => {
        await Promise.resolve();
      });
      vi.mocked(storeState.rehydrateChannelBadges).mockClear();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });

      expect(storeState.rehydrateChannelBadges).toHaveBeenCalledWith(
        "twitch:ninja",
        expect.any(Function)
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores Twitch messages from another channel after switching routes", () => {
    render(<TwitchChat channel="cinna" channelId="cinna-id" />);
    expect(mockServiceHandlers.message).toBeTypeOf("function");

    const makeMessage = (messageChannel: string): ChatMessage => ({
      id: `msg-${messageChannel}`,
      platform: "twitch",
      type: "message",
      channel: messageChannel,
      userId: "user-1",
      username: "viewer",
      displayName: "Viewer",
      color: "#9146ff",
      badges: [{ setId: "subscriber", version: "3", imageUrl: "badge.png", title: "Subscriber" }],
      content: [{ type: "text", content: "hello" }],
      rawContent: "hello",
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    });

    act(() => {
      mockServiceHandlers.message?.(makeMessage("extraemily"));
    });
    expect(storeState.addMessageBatched).not.toHaveBeenCalled();

    act(() => {
      mockServiceHandlers.message?.(makeMessage("cinna"));
    });
    expect(storeState.addMessageBatched).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "cinna" }),
      "twitch:cinna"
    );
  });

  it("shows the connecting row before Twitch token/network setup resolves", async () => {
    const api = installElectronAPIMock();
    api.auth.getValidTwitchToken = vi.fn(() => new Promise<never>(() => {}));

    render(<TwitchChat channel="ninja" channelId="ninja-id" />);

    await waitFor(() => {
      const addedTexts = (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (call: unknown[]) => {
          const msg = call[0] as { rawContent?: string } | undefined;
          return msg?.rawContent;
        }
      );
      expect(addedTexts).toContain("Connecting to channel...");
    });
    expect(twitchChatService.connect).not.toHaveBeenCalled();
  });

  // U7 — the chat-settings gear lives in the panel header chrome OUTSIDE
  // ChatPanelTabs, so it must survive the single-tab (viewer) path that strips
  // tab chrome. Lock it with a POSITIVE render assertion per the
  // chat-header-banner-lost-in-tab-shell-refactor learning.
  it("renders the chat-settings gear in the single-tab viewer path", () => {
    mockIsTwitchMod.value = false; // viewer → ChatPanelTabs single-tab branch
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    // No tab strip is rendered for a viewer...
    expect(screen.queryByRole("tablist")).toBeNull();
    // ...but the gear (header chrome, sibling of ChatPanelTabs) is still there.
    expect(screen.getByRole("button", { name: /chat settings/i })).toBeInTheDocument();
  });

  it("applies live moderatorState events to the moderated-channel store", () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    expect(mockServiceHandlers.moderatorState).toBeTypeOf("function");

    act(() => {
      mockServiceHandlers.moderatorState?.({
        platform: "twitch",
        channel: "ninja",
        channelId: "ninja-id",
        isModerator: true,
        reason: "ws",
      });
    });
    expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("ninja-id")).toBe(
      true
    );

    act(() => {
      mockServiceHandlers.moderatorState?.({
        platform: "twitch",
        channel: "ninja",
        channelId: "ninja-id",
        isModerator: false,
        reason: "ws",
      });
    });
    expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("ninja-id")).toBe(
      false
    );
  });

  it("hydrates Twitch moderated channels on direct chat mount", async () => {
    vi.stubEnv("VITE_TWITCH_CLIENT_ID", "test-client-id");
    getModeratedChannelsMock.mockResolvedValue([
      { broadcaster_id: "ninja-id", broadcaster_login: "ninja", broadcaster_name: "Ninja" },
    ]);

    try {
      render(<TwitchChat channel="ninja" channelId="ninja-id" />);

      await waitFor(() =>
        expect(getModeratedChannelsMock).toHaveBeenCalledWith("mod-1", "tok", "test-client-id")
      );
      expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("ninja-id")).toBe(
        true
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("loads global emotes scoped to 'twitch' after auth/connect", async () => {
    // The branch that calls loadGlobalEmotes('twitch') is gated on
    // `if (twitchClientId)`. Stub the env so the gate opens for this test.
    vi.stubEnv("VITE_TWITCH_CLIENT_ID", "test-client-id");
    try {
      render(<TwitchChat channel="ninja" channelId="ninja-id" />);
      // The connect effect is async — wait until the platform-scoped call lands
      // before asserting the argument so we don't race the resolve.
      await waitFor(() => expect(loadGlobalEmotesMock).toHaveBeenCalled());
      expect(loadGlobalEmotesMock).toHaveBeenCalledWith("twitch", { force: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("initializes Twitch native emotes before loading channel emotes", async () => {
    vi.stubEnv("VITE_TWITCH_CLIENT_ID", "test-client-id");
    const api = installElectronAPIMock();
    api.auth.getValidTwitchToken = vi.fn(async () => "fresh-token");
    try {
      render(<TwitchChat channel="ninja" channelId="ninja-id" />);

      await waitFor(() => expect(loadChannelEmotesMock).toHaveBeenCalled());
      expect(initializeTwitchEmotes).toHaveBeenCalledWith("test-client-id", "fresh-token");
      expect(loadChannelEmotesMock).toHaveBeenCalledWith("ninja-id", "ninja", "twitch");

      const initializeOrder = vi.mocked(initializeTwitchEmotes).mock.invocationCallOrder[0];
      const channelLoadOrder = loadChannelEmotesMock.mock.invocationCallOrder[0];
      expect(initializeOrder).toBeLessThan(channelLoadOrder);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("canSend reflects the narrowed connection-state selector", () => {
    storeState.connectionStatus.twitch.state = "disconnected";
    const { rerender, unmount } = render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    expect(chatInputProps.canSend).toBe(false);

    storeState.connectionStatus.twitch.state = "connected";
    rerender(<TwitchChat channel="ninja" channelId="ninja-id" />);
    // Still false because isAuthenticated is local state behind the async
    // token resolution. The selector returned a fresh boolean primitive on
    // the re-render, which is the regression we want to catch.
    expect(chatInputProps.canSend).toBe(false);

    unmount();
  });

  // ---------- U11 — mod-action mutation wiring ----------
  const fakeMessage = {
    id: "msg-42",
    username: "baduser",
    userId: "user-99",
    rawContent: "spam spam spam",
  } as const;

  it("Ban toolbar click opens the ModActionConfirmDialog", () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    expect(lastListProps.onBan).toBeTypeOf("function");
    act(() => {
      lastListProps.onBan?.(fakeMessage);
    });
    expect(screen.getByRole("heading", { name: /^Ban user$/ })).toBeInTheDocument();
  });

  it("Confirming the Ban dialog calls banUser with the correct args", async () => {
    banUserMock.mockResolvedValue({ ok: true, payload: {} });
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      lastListProps.onBan?.(fakeMessage);
    });
    fireEvent.click(screen.getByRole("button", { name: /^Ban user$/ }));
    await waitFor(() => expect(banUserMock).toHaveBeenCalledTimes(1));
    expect(banUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "tok",
        broadcasterId: "ninja-id",
        moderatorId: "mod-1",
        userId: "user-99",
        clientId: expect.any(String),
      })
    );
  });

  it("A missing-scopes result fires promptReconnect with the listed scopes", async () => {
    banUserMock.mockResolvedValue({
      ok: false,
      kind: "missing-scopes",
      message: "Missing scope: moderator:manage:banned_users",
      missingScopes: ["moderator:manage:banned_users"],
    });
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      lastListProps.onBan?.(fakeMessage);
    });
    fireEvent.click(screen.getByRole("button", { name: /^Ban user$/ }));
    await waitFor(() => expect(promptReconnectMock).toHaveBeenCalledTimes(1));
    expect(promptReconnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        missingScopes: ["moderator:manage:banned_users"],
      })
    );
  });

  // ---------- U5 — event/notice visibility + prediction widget ----------
  it("Pin toolbar click opens the Twitch duration dialog and confirms the Helix pin payload", async () => {
    vi.stubEnv("VITE_TWITCH_CLIENT_ID", "test-client-id");
    try {
      pinChatMessageMock.mockResolvedValue({ ok: true });
      render(<TwitchChat channel="ninja" channelId="ninja-id" />);

      act(() => {
        lastListProps.onPin?.(fakeMessage);
      });
      expect(screen.getByRole("heading", { name: /^Pin message$/ })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /^Pin message$/ }));

      await waitFor(() => expect(pinChatMessageMock).toHaveBeenCalledTimes(1));
      expect(pinChatMessageMock).toHaveBeenCalledWith(
        "ninja-id",
        "mod-1",
        "msg-42",
        1800,
        "tok",
        "test-client-id"
      );
      await waitFor(() =>
        expect(screen.queryByRole("heading", { name: /^Pin message$/ })).toBeNull()
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("pins immediately when the Twitch pin duration dialog setting is off", async () => {
    vi.stubEnv("VITE_TWITCH_CLIENT_ID", "test-client-id");
    try {
      setMockChatDisplay({ showTwitchPinDurationDialog: false });
      pinChatMessageMock.mockResolvedValue({ ok: true });
      render(<TwitchChat channel="ninja" channelId="ninja-id" />);

      await act(async () => {
        await lastListProps.onPin?.(fakeMessage);
      });

      expect(screen.queryByRole("heading", { name: /^Pin message$/ })).toBeNull();
      await waitFor(() => expect(pinChatMessageMock).toHaveBeenCalledTimes(1));
      expect(pinChatMessageMock).toHaveBeenCalledWith(
        "ninja-id",
        "mod-1",
        "msg-42",
        30 * 60,
        "tok",
        "test-client-id"
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("updates an existing Twitch pin duration with PATCH instead of pinning again", async () => {
    vi.stubEnv("VITE_TWITCH_CLIENT_ID", "test-client-id");
    try {
      updatePinnedChatMessageMock.mockResolvedValue({ ok: true });
      render(<TwitchChat channel="ninja" channelId="ninja-id" />);

      const pinnedMessage: NormalizedPinnedMessage = {
        platform: "twitch",
        messageId: "msg-42",
        pinRecordId: null,
        author: {
          username: "baduser",
          displayName: "BadUser",
          color: "#9146ff",
          badges: [],
        },
        content: [{ type: "text", content: "spam spam spam" }],
        pinnedBy: null,
        pinnedAt: new Date("2026-06-29T15:00:00.000Z").toISOString(),
        sentAt: null,
        expiresAt: new Date("2026-06-29T15:30:00.000Z").toISOString(),
      };

      act(() => {
        mockServiceHandlers.pinnedMessage?.(pinnedMessage);
      });
      expect(screen.getByTestId("pinned-message-banner")).toBeInTheDocument();

      await act(async () => {
        await lastPinnedBannerProps.onUpdateDuration?.(60);
      });

      await waitFor(() => expect(updatePinnedChatMessageMock).toHaveBeenCalledTimes(1));
      expect(updatePinnedChatMessageMock).toHaveBeenCalledWith(
        "ninja-id",
        "mod-1",
        "msg-42",
        60,
        "tok",
        "test-client-id"
      );
      expect(pinChatMessageMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not block Twitch pinning while the scope check is still loading", () => {
    mockModScopes.hasModScopes = false;
    mockModScopes.loading = true;

    render(<TwitchChat channel="ninja" channelId="ninja-id" />);

    act(() => {
      lastListProps.onPin?.(fakeMessage);
    });

    expect(screen.getByRole("heading", { name: /^Pin message$/ })).toBeInTheDocument();
    expect(promptReconnectMock).not.toHaveBeenCalled();
  });

  it("Delete toolbar click deletes immediately without opening a confirmation dialog", async () => {
    vi.stubEnv("VITE_TWITCH_CLIENT_ID", "test-client-id");
    try {
      deleteChatMessageMock.mockResolvedValue({ ok: true, payload: {} });
      render(<TwitchChat channel="ninja" channelId="ninja-id" />);

      await act(async () => {
        await lastListProps.onDelete?.(fakeMessage);
      });

      await waitFor(() => expect(deleteChatMessageMock).toHaveBeenCalledTimes(1));
      expect(deleteChatMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "tok",
          clientId: "test-client-id",
          broadcasterId: "ninja-id",
          moderatorId: "mod-1",
          messageId: "msg-42",
        })
      );
      expect(screen.queryByRole("heading", { name: /^Delete message$/ })).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  const fakeNotice = {
    id: "notice-1",
    platform: "twitch" as const,
    channel: "ninja",
    type: "sub" as const,
    userId: "u-sub",
    username: "subber",
    displayName: "Subber",
    color: "#c084fc",
    systemMessage: "Subber subscribed!",
    timestamp: new Date(),
  };

  // The async connect-flow also calls addMessage ("Connecting…"), so assert on
  // the message CONTENT rather than the call count — this isolates the
  // notice/clear lines from connect-flow noise. The handler binds to the
  // render-time addMessage mock, so the mock must stay stable (no reassign).
  const addedMessageWithText = (text: string) =>
    (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls
      .map((call: unknown[]) => call[0] as { content?: Array<{ content?: string }> })
      .find((msg) => msg?.content?.[0]?.content === text);

  const addMessageCalledWithText = (text: string): boolean => Boolean(addedMessageWithText(text));

  it("adds a sub/raid notice to the store by default (showUserNotices true)", () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    expect(mockServiceHandlers.userNotice).toBeTypeOf("function");
    act(() => {
      mockServiceHandlers.userNotice?.(fakeNotice);
    });
    expect(addedMessageWithText("Subber subscribed!")).toEqual(
      expect.objectContaining({
        username: "subber",
        displayName: "Subber",
        color: "#c084fc",
        highlightKind: "subscription",
      })
    );
  });

  it("suppresses sub/raid notices when showUserNotices is false", () => {
    setMockChatDisplay({ showUserNotices: false });
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      mockServiceHandlers.userNotice?.(fakeNotice);
    });
    expect(addMessageCalledWithText("Subber subscribed!")).toBe(false);
  });

  it("still clears messages but suppresses the clear notice when showClearChat is false", () => {
    setMockChatDisplay({ showClearChat: false });
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      mockServiceHandlers.clearChat?.({
        platform: "twitch",
        channel: "ninja",
        isClearAll: true,
        timestamp: new Date(),
      });
    });
    // The moderation effect runs (chat is cleared for this channel)...
    expect(storeState.clearMessages).toHaveBeenCalledWith("twitch:ninja");
    // ...but the "Chat was cleared" system line is not added.
    expect(addMessageCalledWithText("Chat was cleared")).toBe(false);
  });

  it('adds the "Chat was cleared" notice by default (showClearChat true)', () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      mockServiceHandlers.clearChat?.({
        platform: "twitch",
        channel: "ninja",
        isClearAll: true,
        timestamp: new Date(),
      });
    });
    expect(storeState.clearMessages).toHaveBeenCalledWith("twitch:ninja");
    expect(addMessageCalledWithText("Chat was cleared")).toBe(true);
  });

  it("passes all retained Twitch timeout/ban-deleted message bodies into the ban notice", () => {
    const deletedAt = new Date("2026-06-29T17:45:00");
    storeState.messagesByChannel["twitch:ninja"] = [
      {
        id: "t-msg-1",
        platform: "twitch",
        type: "message",
        channel: "ninja",
        userId: "u1",
        username: "spammer",
        displayName: "Spammer",
        color: "#fff",
        badges: [],
        content: [{ type: "text", content: "first twitch message" }],
        rawContent: "first twitch message",
        timestamp: deletedAt,
        isDeleted: false,
        isHighlighted: false,
        isAction: false,
      },
      {
        id: "t-msg-2",
        platform: "twitch",
        type: "message",
        channel: "ninja",
        userId: "u1",
        username: "spammer",
        displayName: "Spammer",
        color: "#5B9BD5",
        badges: [
          {
            setId: "vip",
            version: "1",
            imageUrl: "https://example.com/vip.png",
            title: "VIP",
          },
        ],
        content: [{ type: "text", content: "second twitch message" }],
        rawContent: "second twitch message",
        timestamp: deletedAt,
        isDeleted: false,
        isHighlighted: false,
        isAction: false,
      },
      {
        id: "t-mod-msg",
        platform: "twitch",
        type: "message",
        channel: "ninja",
        userId: "mod-1",
        username: "mod",
        displayName: "Mod",
        color: "#70AD47",
        badges: [
          {
            setId: "moderator",
            version: "1",
            imageUrl: "https://example.com/mod.png",
            title: "Moderator",
          },
        ],
        content: [{ type: "text", content: "keep it clean" }],
        rawContent: "keep it clean",
        timestamp: deletedAt,
        isDeleted: false,
        isHighlighted: false,
        isAction: false,
      },
    ];
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);

    act(() => {
      mockServiceHandlers.clearChat?.({
        platform: "twitch",
        channel: "ninja",
        targetUserId: "u1",
        targetUsername: "spammer",
        bannedByUsername: "mod",
        duration: 600,
        isClearAll: false,
        timestamp: deletedAt,
      });
    });

    expect(storeState.deleteMessagesByUser).toHaveBeenCalledWith("twitch:ninja", "u1", {
      deletedAt,
      deletedByUser: {
        userId: "mod-1",
        username: "mod",
        displayName: "Mod",
        color: "#70AD47",
        badges: [
          {
            setId: "moderator",
            version: "1",
            imageUrl: "https://example.com/mod.png",
            title: "Moderator",
          },
        ],
      },
      deletedByUsername: "mod",
    });
    expect(storeState.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        banInfo: expect.objectContaining({
          bannedUser: {
            userId: "u1",
            username: "spammer",
            displayName: "Spammer",
            color: "#5B9BD5",
            badges: [
              {
                setId: "vip",
                version: "1",
                imageUrl: "https://example.com/vip.png",
                title: "VIP",
              },
            ],
          },
          bannedByUser: {
            userId: "mod-1",
            username: "mod",
            displayName: "Mod",
            color: "#70AD47",
            badges: [
              {
                setId: "moderator",
                version: "1",
                imageUrl: "https://example.com/mod.png",
                title: "Moderator",
              },
            ],
          },
          lastMessage: "second twitch message",
          deletedMessages: ["first twitch message", "second twitch message"],
        }),
      })
    );
  });

  it("passes Twitch message deletion timestamps into the retained deleted row", () => {
    const deletedAt = new Date("2026-06-29T17:45:00");
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);

    act(() => {
      mockServiceHandlers.messageDeleted?.({
        platform: "twitch",
        channel: "ninja",
        messageId: "msg-1",
        timestamp: deletedAt,
      });
    });

    expect(storeState.deleteMessage).toHaveBeenCalledWith("twitch:ninja", "msg-1", {
      deletedAt,
    });
  });

  it("marks Twitch EventSub delete notifications with the deleting moderator", async () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);

    await waitFor(() => expect(eventSubModerateHandlers).toHaveLength(1));
    act(() => {
      eventSubModerateHandlers[0]?.({
        subscription: {
          id: "sub-1",
          type: "channel.moderate",
          version: "2",
          status: "enabled",
          cost: 0,
          condition: { broadcaster_user_id: "ninja-id", moderator_user_id: "mod-1" },
          transport: { method: "websocket", session_id: "session-1" },
          created_at: "2026-07-02T23:00:00Z",
        },
        event: {
          broadcaster_user_id: "ninja-id",
          broadcaster_user_login: "ninja",
          broadcaster_user_name: "Ninja",
          moderator_user_id: "mod-2",
          moderator_user_login: "OtherMod",
          moderator_user_name: "OtherMod",
          action: "delete",
          delete: {
            user_id: "target-1",
            user_login: "spammer",
            user_name: "Spammer",
            message_id: "msg-1",
            message_body: "bad message",
          },
        },
      });
    });

    expect(storeState.deleteMessage).toHaveBeenCalledWith(
      "twitch:ninja",
      "msg-1",
      expect.objectContaining({
        deletedByUsername: "OtherMod",
        deletedByUser: expect.objectContaining({
          userId: "mod-2",
          username: "OtherMod",
          displayName: "OtherMod",
        }),
      })
    );
  });

  it("creates Twitch EventSub subscriptions with a fresh token and a refresh callback", async () => {
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: "stored-token", scope: [] }));
    api.auth.getValidTwitchToken = vi.fn(async () => "fresh-eventsub-token");
    vi.stubEnv("VITE_TWITCH_CLIENT_ID", "configured-eventsub-client");

    render(<TwitchChat channel="ninja" channelId="ninja-id" />);

    await waitFor(() =>
      expect(getTwitchEventSubClient).toHaveBeenCalledWith(
        "fresh-eventsub-token",
        "mod-1",
        expect.objectContaining({
          clientId: "configured-eventsub-client",
          tokenFetcher: expect.any(Function),
        })
      )
    );
  });

  it("does not create channel.moderate EventSub subscriptions for non-mod viewers", async () => {
    mockIsTwitchMod.value = false;

    render(<TwitchChat channel="ninja" channelId="ninja-id" />);

    await waitFor(() => expect(twitchChatService.loadChannelBadges).toHaveBeenCalled());
    expect(getTwitchEventSubClient).not.toHaveBeenCalled();
    expect(eventSubModerateHandlers).toHaveLength(0);
  });

  it("renders the prediction banner when a prediction arrives (showPredictions true)", () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      mockServiceHandlers.predictionUpdate?.(fakePrediction);
    });
    expect(screen.getByTestId("prediction-banner")).toBeInTheDocument();
  });

  it("hides the prediction banner when showPredictions is false", () => {
    setMockChatDisplay({ showPredictions: false });
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      mockServiceHandlers.predictionUpdate?.(fakePrediction);
    });
    expect(screen.queryByTestId("prediction-banner")).toBeNull();
  });
});

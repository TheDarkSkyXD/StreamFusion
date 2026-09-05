import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatDisplayPreferences, DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@shared/auth-types";
import type { ChatKnownUser, ChatMessage } from "@shared/chat-types";
import type { ChatInputProps } from "@/features/chat/components/chat/ChatInput";
import { getCommandsForAccess } from "@/features/chat/utils/chat-command-registry";
import { installElectronAPIMock, renderWithProviders } from "../../test-utils";

// U11 — capture ChatMessageList callbacks so tests can simulate toolbar clicks.
const lastListProps: {
  channelKey?: string;
  onBan?: (m: unknown) => void;
  onTimeout?: (m: unknown) => void;
  onUnban?: (m: unknown) => void;
  onDelete?: (m: unknown) => void;
  onPin?: (m: unknown) => void;
  selfUserId?: string;
} = {};
const banKickUserMock = vi.fn();
const timeoutKickUserMock = vi.fn();
const unbanKickUserMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const toastInfoMock = vi.fn();
const setKickChatModeMock = vi.fn();
const openExternalMock = vi.fn(async () => {});
const recordModActionMock = vi.fn(async (_input: unknown) => 1);
const primePersistedChatHistoryIntentAsyncMock = vi.fn(async (_intent: unknown) => false);
const savePersistedChatHistoryMock = vi.fn(
  async (_platform: unknown, _channel: unknown, _channelId: unknown, _messages: unknown) =>
    undefined
);

vi.mock("@/store/persisted-chat-history", () => ({
  primePersistedChatHistoryIntentAsync: (intent: unknown) =>
    primePersistedChatHistoryIntentAsyncMock(intent),
  savePersistedChatHistory: (
    platform: unknown,
    channel: unknown,
    channelId: unknown,
    messages: unknown
  ) => savePersistedChatHistoryMock(platform, channel, channelId, messages),
}));

vi.mock("@backend/api/platforms/kick/kick-mod-mutations", () => ({
  banKickUserOfficial: (...args: unknown[]) => banKickUserMock(...args),
  timeoutKickUserOfficial: (...args: unknown[]) => timeoutKickUserMock(...args),
  unbanKickUserOfficial: (...args: unknown[]) => unbanKickUserMock(...args),
  setKickChatMode: (...args: unknown[]) => setKickChatModeMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    info: (...args: unknown[]) => toastInfoMock(...args),
  },
}));

vi.mock("@backend/services/mod-log-writer", () => ({
  modLogWriter: {
    record: (input: unknown) => recordModActionMock(input),
  },
}));

// Mutable mod flag. Defaults to mod (most existing tests exercise the
// mod-action paths). The U7 viewer-path gear test flips it to false so
// ChatPanelTabs takes its single-tab (no-chrome) branch.
const mockIsKickMod = { value: true };
vi.mock("@/features/moderation/data/useIsKickMod", () => ({
  useIsKickMod: () => mockIsKickMod.value,
}));

// Mutable chatDisplay prefs the mocked auth store hands back. Tests flip
// individual U5 flags via setMockChatDisplay() before rendering.
const mockChatDisplay: { value: ChatDisplayPreferences } = {
  value: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES },
};
function setMockChatDisplay(overrides: Partial<ChatDisplayPreferences>) {
  mockChatDisplay.value = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...overrides };
}

const mockAuthState = {
  kickUser: { id: 42, username: "modder", slug: "modder" },
  kickConnected: false,
};

vi.mock("@/store/auth-store", () => {
  // KickChat's `isAuthenticated` is a useAuthStore selector reading
  // `kickConnected && !kickReconnectRequired` (commit 9c4bbf7). Without
  // these fields the selector returns `undefined` and `canSend` collapses
  // to `undefined` instead of a boolean.
  //
  // `preferences.chatDisplay` is read reactively (showPolls/showPredictions
  // selectors) and imperatively (handleUserNotice via getState()), so the
  // getter pulls from the mutable holder above on every access.
  const buildState = () => ({
    ...mockAuthState,
    kickReconnectRequired: false,
    twitchConnected: false,
    twitchReconnectRequired: false,
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

// Capture chat-service event handlers so tests can fire userNotice /
// pollUpdate / predictionUpdate without a real Pusher connection.
const mockServiceHandlers: Record<string, ((arg: unknown) => void) | undefined> = {};
vi.mock("@backend/services/chat/kick-chat", () => ({
  kickChatService: {
    connect: vi.fn(async () => true),
    disconnect: vi.fn(async () => true),
    subscribe: vi.fn(() => () => {}),
    acquire: vi.fn(() => undefined),
    release: vi.fn(() => undefined),
    getActiveUserCount: vi.fn(() => 1),
    isConnected: vi.fn(() => false),
    sendMessage: vi.fn(async () => true),
    joinChannel: vi.fn(async () => true),
    acquireSendWindowRetention: vi.fn(),
    releaseSendWindowRetention: vi.fn(),
    setChannelBadges: vi.fn(),
    setModeratorState: vi.fn(),
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (arg: unknown) => void) => {
      mockServiceHandlers[event] = handler;
    }),
    off: vi.fn((event: string) => {
      mockServiceHandlers[event] = undefined;
    }),
    onMessage: vi.fn(() => () => {}),
    onConnectionStateChange: vi.fn(() => () => {}),
  },
}));

// Predictions service acquires a Pusher channel on mount; stub it so the unit
// test stays offline. U5's prediction path is driven via the predictionUpdate
// handler, not the real service.
vi.mock("@backend/services/chat/kick-predictions-service", () => ({
  kickPredictionsService: {
    acquire: vi.fn(async () => undefined),
    release: vi.fn(() => undefined),
  },
}));

vi.mock("@backend/services/emotes", () => ({
  initializeTwitchEmotes: vi.fn(),
  initializeKickEmotes: vi.fn(),
}));

// Stub the prediction banner to a marker so U5's showPredictions gate can be
// asserted without the real countdown / dismiss internals.
vi.mock("@/features/chat/components/chat/PredictionBanner", () => ({
  PredictionBanner: () => <div data-testid="prediction-banner">prediction</div>,
}));

vi.mock("@/features/chat/components/chat/mod/tabs/ModLogTab", () => ({
  ModLogTab: () => <div data-testid="mod-log-tab">modlog</div>,
}));

const storeState = {
  connectionStatus: {
    twitch: { platform: "twitch", state: "disconnected", channels: [], isAuthenticated: false },
    kick: { platform: "kick", state: "disconnected", channels: [], isAuthenticated: false },
  },
  messagesByChannel: {} as Record<string, ChatMessage[]>,
  usersByChannel: {} as Record<string, Record<string, ChatKnownUser>>,
  chatterCountByChannel: {} as Record<string, number>,
  clearMessages: vi.fn(),
  setPaused: vi.fn(),
  addMessage: vi.fn(),
  addMessageBatched: vi.fn(),
  flushBatch: vi.fn(),
  prependMessages: vi.fn(),
  updateConnectionStatus: vi.fn(),
  deleteMessage: vi.fn(),
  deleteMessagesByUser: vi.fn(),
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
    buildChannelKey: (platform: string, channel: string) =>
      `${platform}:${channel.trim().replace(/^#/, "").toLowerCase()}`,
    useChatStore,
  };
});

const loadGlobalEmotesMock = vi.fn();
vi.mock("@/store/emote-store", () => {
  const state = {
    loadedChannels: new Set(),
    setActiveChannel: vi.fn(),
    loadChannelEmotes: vi.fn(),
    loadGlobalEmotes: (...args: unknown[]) => loadGlobalEmotesMock(...args),
    unloadChannelEmotes: vi.fn(),
    applyProviderPrefs: vi.fn(),
    getEmoteNameMap: vi.fn(() => new Map()),
  };
  const useEmoteStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useEmoteStore.getState = () => state;
  return {
    useEmoteStore,
  };
});

vi.mock("@/features/chat/components/chat/ChatMessageList", () => ({
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

const chatInputProps: Partial<
  Pick<ChatInputProps, "canSend" | "viewerUserId" | "commandAccess" | "onProviderCommand">
> = {};
vi.mock("@/features/chat/components/chat/ChatInput", () => ({
  ChatInput: (
    props: Pick<ChatInputProps, "canSend" | "viewerUserId" | "commandAccess" | "onProviderCommand">
  ) => {
    chatInputProps.canSend = props.canSend;
    chatInputProps.viewerUserId = props.viewerUserId;
    chatInputProps.commandAccess = props.commandAccess;
    chatInputProps.onProviderCommand = props.onProviderCommand;
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

import { kickChatService } from "@backend/services/chat/kick-chat";
import { kickPredictionsService } from "@backend/services/chat/kick-predictions-service";
import { KickChat } from "@/features/chat/components/chat/kick/KickChat";
import { useModeratedChannelsStore } from "@/features/moderation/data/moderated-channels-store";

function renderKickChat(ui: ReactElement, queryClient?: QueryClient) {
  return renderWithProviders(ui, { queryClient });
}

// Guards: loading state — canSend stays false while the Pusher connection is in 'disconnected' state and the kick token is still resolving, so the chat input doesn't accept input bound for the void
// Guards: connecting state appears immediately before Kick token/network setup finishes, so the chat panel never looks blank on slow joins
// Guards: error/reconnect path — canSend remains false even after the connection flips to 'connected' until isAuthenticated catches up, so the input gates correctly on Pusher drop / reconnect cycles
// Guards: empty messages — message list still renders the virtuoso shell (see ChatMessageList tests); chat input still renders, gear chrome still visible in viewer single-tab path (U7)
// Guards: U5 prefs — sub notices / polls / prediction banner each suppress when their visibility pref is false, surface when true. Silent drops here look like "Kick subs aren't firing" — a high-blast UX failure
// Guards: U11 mod actions — Timeout uses typed state-aware IPC and never retries the legacy Kick web session.
// Guards: Kick pin actions use the original chat message sender, surface auth/API failures, and keep retryable failures visible instead of silently leaving the dialog stuck
// Guards: final-view cleanup skips prediction unsubscribe frames before closing the shared chat Pusher socket, preventing pusher-js "WebSocket is already in CLOSING or CLOSED state" console errors on unmount
// Guards: the full-width composer footer paints above the message scroller so chat text cannot show behind its quick-emote row or padding.
// Guards: Kick recent history is inserted before live chat joins or announces its connection.
// Guards: persisted Kick history restoration finishes before connection markers or remote history can mutate the channel bucket.
// Guards: history that resolves after a channel switch cannot mutate the prior channel's messages, pin, or moderator state.
// Guards: unavailable recent history cannot disconnect or withhold live Kick chat.
// Guards: Kick auth changes update composer identity without resetting the public chat socket or its rooms.
// Guards: viewers still observe ban UI without writing moderator-only history records.
// Guards: Kick slash commands keep official moderation execution and local-only notices wired through the composer.
describe("KickChat", () => {
  beforeEach(() => {
    const api = installElectronAPIMock();
    api.openExternal = openExternalMock;
    api.auth.getToken = vi.fn(async () => ({ accessToken: "kick-tok" }));
    api.userProfiles.resolveKickChannel = vi.fn(async () => ({
      state: "known" as const,
      value: { id: "456", username: "viewer", displayName: "Viewer" },
      source: "official" as const,
    }));
    api.chat.getKickHistory = vi.fn(async () => ({ success: false }));
    api.kickChat.banUser = vi.fn(async () => ({ ok: true as const, status: 200, body: "{}" }));
    api.kickChat.timeoutUser = vi.fn(async () => ({ ok: true as const, status: 200, body: "{}" }));
    api.kickChat.unbanUser = vi.fn(async () => ({ ok: true as const, status: 200, body: "{}" }));
    api.kickChat.deleteMessage = vi.fn(async () => ({ ok: true as const, status: 204, body: "" }));
    api.kickChat.getViewerRole = vi.fn(async () => ({
      ok: true as const,
      isModerator: null,
      status: 200,
    }));
    api.kickChat.pinMessage = vi.fn(async () => ({ ok: true as const }));
    api.kickChat.unpinMessage = vi.fn(async () => ({ ok: true as const }));
    storeState.connectionStatus.kick.state = "disconnected";
    storeState.connectionStatus.twitch.state = "disconnected";
    mockAuthState.kickConnected = false;
    storeState.messagesByChannel = {};
    storeState.usersByChannel = {};
    chatInputProps.canSend = undefined;
    chatInputProps.viewerUserId = undefined;
    chatInputProps.commandAccess = undefined;
    chatInputProps.onProviderCommand = undefined;
    lastListProps.onBan = undefined;
    lastListProps.onTimeout = undefined;
    lastListProps.onUnban = undefined;
    lastListProps.onDelete = undefined;
    lastListProps.onPin = undefined;
    lastListProps.selfUserId = undefined;
    lastListProps.channelKey = undefined;
    banKickUserMock.mockReset();
    banKickUserMock.mockResolvedValue({ ok: true });
    timeoutKickUserMock.mockReset();
    timeoutKickUserMock.mockResolvedValue({ ok: true });
    unbanKickUserMock.mockReset();
    unbanKickUserMock.mockResolvedValue({ ok: true });
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    toastInfoMock.mockReset();
    setKickChatModeMock.mockReset();
    setKickChatModeMock.mockResolvedValue({ ok: true });
    openExternalMock.mockReset();
    openExternalMock.mockResolvedValue(undefined);
    recordModActionMock.mockReset();
    recordModActionMock.mockResolvedValue(1);
    primePersistedChatHistoryIntentAsyncMock.mockClear();
    primePersistedChatHistoryIntentAsyncMock.mockResolvedValue(false);
    savePersistedChatHistoryMock.mockClear();
    vi.mocked(kickChatService.connect).mockClear();
    vi.mocked(kickChatService.disconnect).mockClear();
    vi.mocked(kickChatService.joinChannel).mockClear();
    vi.mocked(kickChatService.acquireSendWindowRetention).mockClear();
    vi.mocked(kickChatService.releaseSendWindowRetention).mockClear();
    vi.mocked(kickChatService.acquire).mockClear();
    vi.mocked(kickChatService.release).mockClear();
    vi.mocked(kickChatService.getActiveUserCount).mockClear();
    vi.mocked(kickChatService.getActiveUserCount).mockReturnValue(1);
    vi.mocked(kickChatService.setModeratorState).mockClear();
    vi.mocked(kickChatService.emit).mockClear();
    vi.mocked(kickPredictionsService.acquire).mockClear();
    vi.mocked(kickPredictionsService.release).mockClear();
    loadGlobalEmotesMock.mockReset();
    storeState.addMessage = vi.fn();
    storeState.addMessageBatched = vi.fn();
    storeState.prependMessages = vi.fn();
    storeState.deleteMessage = vi.fn();
    storeState.deleteMessagesByUser = vi.fn();
    useModeratedChannelsStore.getState().clear();
    setMockChatDisplay({});
    mockIsKickMod.value = true;
    for (const k of Object.keys(mockServiceHandlers)) delete mockServiceHandlers[k];
  });

  it("renders message list and chat input", () => {
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });

  it("does not reset public Kick chat when auth changes", async () => {
    const view = renderKickChat(
      <KickChat channel="xqc" channelId="411439" kickChannelId="668" chatroomId={12345} />
    );
    await waitFor(() =>
      expect(kickChatService.joinChannel).toHaveBeenCalledWith("xqc", 12345, 411439)
    );
    vi.mocked(kickChatService.connect).mockClear();
    vi.mocked(kickChatService.disconnect).mockClear();
    vi.mocked(kickChatService.joinChannel).mockClear();

    await act(async () => {
      mockAuthState.kickConnected = true;
      view.rerender(
        <KickChat channel="xqc" channelId="411439" kickChannelId="668" chatroomId={12345} />
      );
      await Promise.resolve();
    });
    await act(async () => {
      mockAuthState.kickConnected = false;
      view.rerender(
        <KickChat channel="xqc" channelId="411439" kickChannelId="668" chatroomId={12345} />
      );
      await Promise.resolve();
    });

    expect(kickChatService.disconnect).not.toHaveBeenCalled();
    expect(kickChatService.connect).not.toHaveBeenCalled();
    expect(kickChatService.joinChannel).not.toHaveBeenCalled();
  });

  it("exposes Partner commands only to the signed-in owner of a Partner channel", () => {
    mockAuthState.kickConnected = true;
    renderKickChat(<KickChat channel="modder" chatroomId={12345} isPartnerChannel={true} />);

    if (!chatInputProps.commandAccess) throw new Error("Kick command access missing");
    expect(
      getCommandsForAccess(chatInputProps.commandAccess).map((command) => command.name)
    ).toEqual(expect.arrayContaining(["multi", "kpp"]));
  });

  it("shows a local notice for a platform-owned chat-mode command", async () => {
    mockAuthState.kickConnected = true;
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    const slow = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "moderator",
    }).find((command) => command.name === "slow");
    if (!slow || !chatInputProps.onProviderCommand) throw new Error("Kick command wiring missing");

    let outcome: unknown;
    await act(async () => {
      outcome = await chatInputProps.onProviderCommand?.({
        command: slow,
        args: "on 30",
        text: "/slow on 30",
      });
    });

    expect(toastInfoMock).not.toHaveBeenCalled();
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "local-result",
      result: {
        tone: "info",
        title: "/slow",
        body: "Kick exposes slow-mode controls only in its first-party channel chat.",
      },
    });
    expect(setKickChatModeMock).not.toHaveBeenCalled();
  });

  it("executes a Kick ban through the official moderation API", async () => {
    mockAuthState.kickConnected = true;
    renderKickChat(<KickChat channel="xqc" channelId="123" chatroomId={12345} />);
    const ban = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "moderator",
    }).find((command) => command.name === "ban");
    if (!ban || !chatInputProps.onProviderCommand) throw new Error("Kick command wiring missing");

    await act(() =>
      chatInputProps.onProviderCommand?.({
        command: ban,
        args: "viewer spam",
        text: "/ban viewer spam",
      })
    );

    expect(banKickUserMock).toHaveBeenCalledWith({
      accessToken: "kick-tok",
      broadcasterUserId: 123,
      userId: 456,
      reason: "spam",
    });
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it("shows a local notice for a command without a public mutation", async () => {
    mockAuthState.kickConnected = true;
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    const title = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "moderator",
    }).find((command) => command.name === "title");
    if (!title || !chatInputProps.onProviderCommand) throw new Error("Kick command wiring missing");

    let outcome: unknown;
    await act(async () => {
      outcome = await chatInputProps.onProviderCommand?.({
        command: title,
        args: "New title",
        text: "/title New title",
      });
    });

    expect(toastInfoMock).not.toHaveBeenCalled();
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "local-result",
      result: {
        tone: "info",
        title: "/title",
        body: "Kick only documents programmatic title changes for the channel owner's token.",
      },
    });
  });

  it("does not retain the Kick send window for read-only chat", () => {
    mockAuthState.kickConnected = true;

    renderKickChat(<KickChat channel="xqc" chatroomId={12345} showComposer={false} />);

    expect(kickChatService.acquireSendWindowRetention).not.toHaveBeenCalled();
    expect(kickChatService.releaseSendWindowRetention).not.toHaveBeenCalled();
    expect(screen.queryByTestId("chat-input")).toBeNull();
  });

  it("retains the Kick send window only while an authenticated composer is mounted", () => {
    mockAuthState.kickConnected = true;

    const { unmount } = renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);

    expect(kickChatService.acquireSendWindowRetention).toHaveBeenCalledTimes(1);
    expect(kickChatService.releaseSendWindowRetention).not.toHaveBeenCalled();

    unmount();

    expect(kickChatService.releaseSendWindowRetention).toHaveBeenCalledTimes(1);
  });

  it("opens Active Chatters over the live chat without unmounting it", () => {
    storeState.usersByChannel = {
      "kick:xqc": {
        chatter: {
          userId: "1",
          username: "chatter",
          displayName: "Chatter",
          color: "#53fc18",
          role: "viewer",
          badges: [],
          lastSeen: new Date(),
        },
      },
    };
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);

    fireEvent.click(screen.getByRole("button", { name: "Show active chatters" }));

    expect(screen.getByRole("heading", { name: "Active Chatters" })).toBeInTheDocument();
    expect(screen.getByText("Chatter")).toBeInTheDocument();
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
  });

  it("occludes the message scroller behind the full composer footer", () => {
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);

    const footer = screen.getByTestId("chat-composer-footer");
    expect(footer).toHaveClass("relative", "z-10", "w-full", "shrink-0", "bg-[#191919]");
    expect(footer).toContainElement(screen.getByTestId("chat-input"));
  });

  it("passes the per-channel key to ChatMessageList", () => {
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    expect(lastListProps.channelKey).toBe("kick:xqc");
  });

  it("syncs live Kick moderator state from the signed-in user's own badges", async () => {
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    await waitFor(() => expect(mockServiceHandlers.message).toBeTypeOf("function"));

    const ownModeratorMessage: ChatMessage = {
      id: "msg-1",
      platform: "kick",
      type: "message",
      channel: "XQC",
      userId: "42",
      username: "modder",
      displayName: "modder",
      color: "#ffffff",
      badges: [{ setId: "moderator", version: "1", imageUrl: "", title: "Moderator" }],
      content: [{ type: "text", content: "hi" }],
      rawContent: "hi",
      timestamp: new Date("2026-06-28T00:00:00Z"),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };

    act(() => {
      mockServiceHandlers.message?.(ownModeratorMessage);
    });

    expect(useModeratedChannelsStore.getState().kickModeratedChannelSlugs.has("xqc")).toBe(true);
    expect(kickChatService.setModeratorState).toHaveBeenCalledWith("xqc", true);

    act(() => {
      mockServiceHandlers.message?.({ ...ownModeratorMessage, id: "msg-2", badges: [] });
    });

    expect(useModeratedChannelsStore.getState().kickModeratedChannelSlugs.has("xqc")).toBe(false);
    expect(kickChatService.setModeratorState).toHaveBeenLastCalledWith("xqc", false);
  });

  it("ignores messages emitted for another Kick channel", async () => {
    renderKickChat(<KickChat channel="xqc" channelId="411439" chatroomId={12345} />);
    await waitFor(() => expect(mockServiceHandlers.message).toBeTypeOf("function"));

    const otherChannelMessage: ChatMessage = {
      id: "other-channel-message",
      platform: "kick",
      type: "message",
      channel: "another-channel",
      userId: "7",
      username: "viewer",
      displayName: "Viewer",
      color: "#ffffff",
      badges: [],
      content: [{ type: "text", content: "wrong room" }],
      rawContent: "wrong room",
      timestamp: new Date("2026-08-31T00:00:00Z"),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };

    act(() => {
      mockServiceHandlers.message?.(otherChannelMessage);
    });

    expect(storeState.addMessageBatched).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "other-channel-message" }),
      expect.anything()
    );
  });

  it("seeds Kick moderator state immediately when the signed-in user is the broadcaster", async () => {
    renderKickChat(
      <KickChat channel="xqc" channelId="411439" chatroomId={12345} kickUserId="42" />
    );

    await waitFor(() =>
      expect(useModeratedChannelsStore.getState().kickModeratedChannelSlugs.has("xqc")).toBe(true)
    );
    expect(kickChatService.setModeratorState).toHaveBeenCalledWith("xqc", true);
  });

  it("seeds Kick moderator state from the signed-in user's recent history badges", async () => {
    window.electronAPI.chat.getKickHistory = vi.fn(async () => ({
      success: true,
      data: {
        pinnedMessage: null,
        messages: [
          {
            id: "hist-1",
            chatroom_id: 12345,
            content: "already here",
            type: "message",
            created_at: "2026-06-28T00:00:00Z",
            metadata: null,
            sender: {
              id: 42,
              username: "modder",
              slug: "modder",
              identity: {
                color: "#ffffff",
                badges: [{ type: "moderator", text: "Moderator" }],
              },
            },
          },
        ],
      },
    }));

    renderKickChat(
      <KickChat channel="xqc" channelId="411439" kickChannelId="668" chatroomId={12345} />
    );

    await waitFor(() =>
      expect(useModeratedChannelsStore.getState().kickModeratedChannelSlugs.has("xqc")).toBe(true)
    );
    expect(kickChatService.setModeratorState).toHaveBeenCalledWith("xqc", true);
  });

  it("seeds Kick moderator state from the load-time channel viewer role", async () => {
    window.electronAPI.kickChat.getViewerRole = vi.fn(async () => ({
      ok: true as const,
      isModerator: true,
      status: 200,
    }));

    renderKickChat(
      <KickChat channel="xqc" channelId="411439" kickChannelId="668" chatroomId={12345} />
    );

    await waitFor(() =>
      expect(useModeratedChannelsStore.getState().kickModeratedChannelSlugs.has("xqc")).toBe(true)
    );
    expect(window.electronAPI.kickChat.getViewerRole).toHaveBeenCalledWith("xqc");
    expect(kickChatService.setModeratorState).toHaveBeenCalledWith("xqc", true);
  });

  it("clears Kick moderator state from a load-time non-mod viewer role", async () => {
    useModeratedChannelsStore.getState().setKickChannelModState("xqc", true);
    window.electronAPI.kickChat.getViewerRole = vi.fn(async () => ({
      ok: true as const,
      isModerator: false,
      status: 200,
    }));

    renderKickChat(<KickChat channel="xqc" channelId="411439" chatroomId={12345} />);

    await waitFor(() =>
      expect(useModeratedChannelsStore.getState().kickModeratedChannelSlugs.has("xqc")).toBe(false)
    );
    expect(kickChatService.setModeratorState).toHaveBeenCalledWith("xqc", false);
  });

  it("does not show the connecting row before Kick token/network setup resolves", async () => {
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(() => new Promise<never>(() => {}));

    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);

    await waitFor(() => expect(api.auth.getToken).toHaveBeenCalled());
    const addedTexts = (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => {
        const msg = call[0] as { rawContent?: string } | undefined;
        return msg?.rawContent;
      }
    );
    expect(addedTexts).not.toContain("Connecting to channel...");
    expect(kickChatService.connect).not.toHaveBeenCalled();
  });

  it("joins live chat while recent history loads and announces connected after preparation", async () => {
    type KickHistoryResult = Awaited<ReturnType<typeof window.electronAPI.chat.getKickHistory>>;
    let resolveHistory!: (result: KickHistoryResult) => void;
    window.electronAPI.chat.getKickHistory = vi.fn(
      () =>
        new Promise<KickHistoryResult>((resolve) => {
          resolveHistory = resolve;
        })
    );

    renderKickChat(
      <KickChat channel="xqc" channelId="411439" kickChannelId="668" chatroomId={12345} />
    );

    await waitFor(() => expect(window.electronAPI.chat.getKickHistory).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Loading recent messages…")).not.toBeInTheDocument();
    expect(kickChatService.joinChannel).toHaveBeenCalledWith("xqc", 12345, 411439);
    expect(
      (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls.some(
        ([message]) => (message as ChatMessage).rawContent === "Connected to the channel"
      )
    ).toBe(false);
    expect(storeState.prependMessages).not.toHaveBeenCalled();

    await act(async () => {
      resolveHistory({
        success: true,
        data: {
          messages: [
            {
              id: "recent-message",
              chatroom_id: 12345,
              content: "before live chat",
              type: "message",
              created_at: "2026-08-05T00:00:00Z",
              metadata: null,
              sender: {
                id: 42,
                username: "viewer",
                slug: "viewer",
                identity: { color: "#ffffff", badges: [] },
              },
            },
          ],
          pinnedMessage: null,
        },
      });
    });

    await waitFor(() =>
      expect(kickChatService.joinChannel).toHaveBeenCalledWith("xqc", 12345, 411439)
    );
    await waitFor(() =>
      expect(
        (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls.some(
          ([message]) => (message as ChatMessage).rawContent === "Connected to the channel"
        )
      ).toBe(true)
    );
    expect(storeState.prependMessages).toHaveBeenCalledWith(
      "kick:xqc",
      expect.arrayContaining([expect.objectContaining({ id: "recent-message" })])
    );
    expect(vi.mocked(kickChatService.joinChannel).mock.invocationCallOrder[0]).toBeLessThan(
      storeState.prependMessages.mock.invocationCallOrder[0]
    );
  });

  it("shows connecting and joins before remote Kick history settles", async () => {
    type KickHistoryResult = Awaited<ReturnType<typeof window.electronAPI.chat.getKickHistory>>;
    let resolveHistory!: (result: KickHistoryResult) => void;
    window.electronAPI.chat.getKickHistory = vi.fn(
      () =>
        new Promise<KickHistoryResult>((resolve) => {
          resolveHistory = resolve;
        })
    );

    renderKickChat(
      <KickChat channel="xqc" channelId="411439" kickChannelId="668" chatroomId={12345} />
    );

    await waitFor(() =>
      expect(window.electronAPI.chat.getKickHistory).toHaveBeenCalledWith({
        channelId: "668",
        channelSlug: "xqc",
      })
    );
    expect(kickChatService.joinChannel).toHaveBeenCalledWith("xqc", 12345, 411439);
    expect(
      (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls.some(
        ([message]) => (message as ChatMessage).rawContent === "Connecting to channel..."
      )
    ).toBe(true);

    await act(async () => {
      resolveHistory({ success: true, data: { messages: [], pinnedMessage: null } });
    });

    await waitFor(() =>
      expect(kickChatService.joinChannel).toHaveBeenCalledWith("xqc", 12345, 411439)
    );
    expect(
      (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls.some(
        ([message]) => (message as ChatMessage).rawContent === "Connecting to channel..."
      )
    ).toBe(true);
  });

  it("restores persisted history before adding connection state or requesting remote history", async () => {
    let resolvePersistedHistory!: (restored: boolean) => void;
    primePersistedChatHistoryIntentAsyncMock.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePersistedHistory = resolve;
        })
    );

    renderKickChat(
      <KickChat channel="xqc" channelId="411439" kickChannelId="668" chatroomId={12345} />
    );

    await waitFor(() => expect(primePersistedChatHistoryIntentAsyncMock).toHaveBeenCalledTimes(1));
    expect(window.electronAPI.chat.getKickHistory).not.toHaveBeenCalled();
    expect(
      (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls.some(
        ([message]) => (message as ChatMessage).rawContent === "Connecting to channel..."
      )
    ).toBe(false);

    await act(async () => {
      resolvePersistedHistory(false);
    });

    await waitFor(() => expect(window.electronAPI.chat.getKickHistory).toHaveBeenCalledTimes(1));
    expect(
      (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls.some(
        ([message]) => (message as ChatMessage).rawContent === "Connecting to channel..."
      )
    ).toBe(true);
  });

  it("ignores history from a channel that resolves after switching channels", async () => {
    type KickHistoryResult = Awaited<ReturnType<typeof window.electronAPI.chat.getKickHistory>>;
    let resolveAlphaHistory!: (result: KickHistoryResult) => void;
    window.electronAPI.chat.getKickHistory = vi.fn(({ channelId }): Promise<KickHistoryResult> => {
      if (channelId !== "111") return Promise.resolve({ success: false });
      return new Promise<KickHistoryResult>((resolve) => {
        resolveAlphaHistory = resolve;
      });
    });

    const { rerender } = renderKickChat(
      <KickChat channel="alpha" channelId="111" kickChannelId="111" chatroomId={1001} />
    );
    await waitFor(() =>
      expect(window.electronAPI.chat.getKickHistory).toHaveBeenCalledWith({
        channelId: "111",
        channelSlug: "alpha",
      })
    );

    rerender(<KickChat channel="beta" channelId="222" kickChannelId="222" chatroomId={2002} />);
    await waitFor(() =>
      expect(kickChatService.joinChannel).toHaveBeenCalledWith("beta", 2002, 222)
    );
    expect(kickChatService.joinChannel).toHaveBeenCalledWith("alpha", 1001, 111);

    await act(async () => {
      resolveAlphaHistory({
        success: true,
        data: {
          messages: [
            {
              id: "alpha-history",
              chatroom_id: 1001,
              content: "stale alpha history",
              type: "message",
              created_at: "2026-08-05T00:00:00Z",
              metadata: null,
              sender: {
                id: 42,
                username: "modder",
                slug: "modder",
                identity: {
                  color: "#ffffff",
                  badges: [{ type: "moderator", text: "Moderator" }],
                },
              },
            },
          ],
          pinnedMessage: { id: "stale-alpha-pin" },
        },
      });
    });

    expect(storeState.prependMessages).not.toHaveBeenCalledWith("kick:alpha", expect.anything());
    expect(kickChatService.emit).not.toHaveBeenCalledWith("pinnedMessage", expect.anything());
    expect(kickChatService.setModeratorState).not.toHaveBeenCalledWith("alpha", true);
  });

  it("keeps live chat connected without an alarming banner when recent history rejects", async () => {
    window.electronAPI.chat.getKickHistory = vi.fn(async () => {
      throw new Error("history unavailable");
    });

    renderKickChat(
      <KickChat channel="xqc" channelId="411439" kickChannelId="668" chatroomId={12345} />
    );

    await waitFor(() =>
      expect(kickChatService.joinChannel).toHaveBeenCalledWith("xqc", 12345, 411439)
    );
    await waitFor(() =>
      expect(
        (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls.some(
          ([message]) => (message as ChatMessage).rawContent === "Connected to the channel"
        )
      ).toBe(true)
    );
    expect(storeState.prependMessages).not.toHaveBeenCalled();
    expect(kickChatService.emit).not.toHaveBeenCalledWith("pinnedMessage", expect.anything());
    expect(
      screen.queryByText("Kick history unavailable; showing session messages")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });

  it("restores and saves bounded history for the exact Kick channel identity", async () => {
    const observed = [
      {
        id: "observed-live",
        platform: "kick",
        type: "message",
        channel: "xqc",
      } as ChatMessage,
    ];
    storeState.messagesByChannel["kick:xqc"] = observed;

    const { unmount } = renderKickChat(
      <KickChat channel="xqc" channelId="411439" chatroomId={12345} />
    );

    await waitFor(() =>
      expect(primePersistedChatHistoryIntentAsyncMock).toHaveBeenCalledWith({
        platform: "kick",
        normalizedChannel: "xqc",
        channelId: "411439",
        limit: DEFAULT_CHAT_DISPLAY_PREFERENCES.recentMessagesLimit,
      })
    );
    unmount();

    expect(savePersistedChatHistoryMock).toHaveBeenCalledWith("kick", "xqc", "411439", observed);
    expect(kickChatService.release).toHaveBeenCalledWith("xqc");
    expect(savePersistedChatHistoryMock.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(kickChatService.release).mock.invocationCallOrder.at(-1) ?? Number.MAX_SAFE_INTEGER
    );
  });

  it("releases predictions without socket frames before releasing the final shared Kick chat socket", () => {
    mockIsKickMod.value = false;
    const { unmount } = renderKickChat(
      <KickChat channel="xqc" channelId="12345" chatroomId={12345} />
    );

    unmount();

    expect(kickPredictionsService.release).toHaveBeenCalledWith({
      channelId: "12345",
      skipPusherUnsubscribe: true,
    });
    expect(kickChatService.release).toHaveBeenCalledWith("xqc");
    expect(vi.mocked(kickPredictionsService.release).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(kickChatService.release).mock.invocationCallOrder[0]
    );
  });

  // U7 — the chat-settings gear lives in the panel header chrome OUTSIDE
  // ChatPanelTabs, so it must survive the single-tab (viewer) path that strips
  // tab chrome. Lock it with a POSITIVE render assertion per the
  // chat-header-banner-lost-in-tab-shell-refactor learning.
  it("renders the chat-settings gear in the single-tab viewer path", () => {
    mockIsKickMod.value = false; // viewer → ChatPanelTabs single-tab branch
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("button", { name: /chat settings/i })).toBeInTheDocument();
  });

  it("loads global emotes scoped to 'kick' after connect", async () => {
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    // The connect effect is async — wait until the platform-scoped call lands
    // before asserting the argument so we don't race the resolve.
    await waitFor(() => expect(loadGlobalEmotesMock).toHaveBeenCalled());
    expect(loadGlobalEmotesMock).toHaveBeenCalledWith("kick", { force: true });
  });

  it("canSend reflects the narrowed connection-state selector", () => {
    storeState.connectionStatus.kick.state = "disconnected";
    const { rerender, unmount } = renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    // !isAuthenticated && disconnected → false
    expect(chatInputProps.canSend).toBe(false);

    // Flip the mock state to 'connected' and re-render. The selector returns
    // a boolean primitive now, so a re-render should observe the new value.
    storeState.connectionStatus.kick.state = "connected";
    rerender(<KickChat channel="xqc" chatroomId={12345} />);
    // Still false because isAuthenticated is local state pending the async
    // token resolution that the mocked electronAPI returns empty for. The
    // important thing is the selector ran, returned the correct primitive,
    // and the && fall-through still evaluates correctly.
    expect(chatInputProps.canSend).toBe(false);

    unmount();
  });

  it("scopes quick emotes to authenticated Kick identity, not chat connectivity", () => {
    mockAuthState.kickConnected = true;
    storeState.connectionStatus.kick.state = "disconnected";
    const { rerender } = renderKickChat(
      <KickChat channel="xqc" channelId="411439" chatroomId={12345} />
    );

    expect(chatInputProps.viewerUserId).toBe("42");

    mockAuthState.kickConnected = false;
    rerender(<KickChat channel="xqc" channelId="411439" chatroomId={12345} />);
    expect(chatInputProps.viewerUserId).toBeUndefined();
  });

  // ---------- U11 — Kick mod-action seconds→minutes conversion ----------
  const fakeMessage = {
    id: "k-msg-1",
    username: "baduser",
    userId: "kuser-9",
    rawContent: "kspam",
  } as const;

  const fakePinMessage = {
    id: "k-pin-1",
    username: "viewer-slug",
    displayName: "Viewer Display",
    userId: "77",
    rawContent: "pin this",
  } as const;

  it("routes timeout confirmation through the typed state-aware IPC boundary", async () => {
    const availableSnapshot = {
      state: "available" as const,
      snapshotId: "kick-snapshot",
      verifiedAt: Date.now(),
      actorRole: "moderator" as const,
      policy: {
        durationUnit: "minutes" as const,
        minDuration: 1,
        maxDuration: 10_080,
        supportsReason: true,
        maxReasonLength: 100,
      },
    };
    let finishTargetRefresh!: () => void;
    window.electronAPI.moderation.createTimeoutSnapshot = vi
      .fn()
      .mockResolvedValueOnce(availableSnapshot)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishTargetRefresh = () => resolve(availableSnapshot);
        })
      );
    window.electronAPI.moderation.submitTimeout = vi.fn(async () => ({
      state: "success" as const,
      attemptId: "attempt-1",
    }));
    let finishHistoryRefresh!: () => void;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(
      new Promise<void>((resolve) => {
        finishHistoryRefresh = resolve;
      })
    );
    renderKickChat(
      <KickChat channel="xqc" channelId="channel-123" chatroomId={12345} />,
      queryClient
    );
    act(() => {
      lastListProps.onTimeout?.(fakeMessage);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Time out$/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^Time out$/ }));
    await waitFor(() =>
      expect(window.electronAPI.moderation.submitTimeout).toHaveBeenCalledWith({
        snapshotId: "kick-snapshot",
        duration: 10,
      })
    );
    expect(window.electronAPI.moderation.createTimeoutSnapshot).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "channel-123",
      channelSlug: "xqc",
      targetUserId: "kuser-9",
      targetUsername: "baduser",
      selectedMessageId: "k-msg-1",
      action: "timeout",
    });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing moderation history");

    await act(async () => {
      finishTargetRefresh();
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing moderation history");

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["modLog", "kick", "channel-123"],
    });
    await act(async () => {
      finishHistoryRefresh();
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("history refreshed");
    expect(window.electronAPI.kickChat.timeoutUser).not.toHaveBeenCalled();
    expect(timeoutKickUserMock).not.toHaveBeenCalled();
    expect(recordModActionMock).not.toHaveBeenCalled();
  });

  it("uses Kick's minute policy and never renders the unsupported 10s preset", async () => {
    window.electronAPI.moderation.createTimeoutSnapshot = vi.fn(async () => ({
      state: "available" as const,
      snapshotId: "kick-snapshot",
      verifiedAt: Date.now(),
      actorRole: "moderator" as const,
      policy: {
        durationUnit: "minutes" as const,
        minDuration: 1,
        maxDuration: 10_080,
        supportsReason: true,
        maxReasonLength: 100,
      },
    }));
    renderKickChat(<KickChat channel="xqc" channelId="channel-123" chatroomId={12345} />);
    act(() => {
      lastListProps.onTimeout?.(fakeMessage);
    });
    await screen.findByRole("heading", { name: /^Time out user$/ });
    expect(screen.queryByRole("button", { name: /^10s$/ })).toBeNull();
  });

  it("Delete toolbar click deletes immediately without opening a confirmation dialog", async () => {
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);

    await act(async () => {
      await lastListProps.onDelete?.(fakeMessage);
    });

    await waitFor(() => expect(window.electronAPI.kickChat.deleteMessage).toHaveBeenCalledTimes(1));
    expect(window.electronAPI.kickChat.deleteMessage).toHaveBeenCalledWith(12345, "k-msg-1");
    expect(screen.queryByRole("heading", { name: /^Delete message$/ })).toBeNull();
  });

  it("records a Kick delete only after the platform confirms the exact message deletion", async () => {
    renderKickChat(<KickChat channel="xqc" channelId="channel-123" chatroomId={12345} />);

    await act(async () => {
      await lastListProps.onDelete?.(fakeMessage);
    });

    expect(recordModActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "kick",
        channelId: "channel-123",
        channelSlug: "xqc",
        action: "delete",
        targetUserId: "kuser-9",
        targetUsername: "baduser",
        moderatorUserId: "42",
        moderatorUsername: "modder",
        reason: "kspam",
        source: "local",
      })
    );
  });

  it("asks the user to reconnect Kick when delete lacks the chat moderation scope", async () => {
    window.electronAPI.kickChat.deleteMessage = vi.fn(async () => ({
      ok: false as const,
      kind: "auth-expired" as const,
      status: 401,
      body: "",
      message: "401",
    }));
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);

    await act(async () => {
      await lastListProps.onDelete?.(fakeMessage);
    });

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Reconnect Kick to delete messages", {
        description: "Kick needs the chat moderation permission.",
      })
    );
  });

  it("pinning a Kick message immediately uses the original message sender", async () => {
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);

    await act(async () => {
      await lastListProps.onPin?.(fakePinMessage);
    });

    await waitFor(() => expect(window.electronAPI.kickChat.pinMessage).toHaveBeenCalledTimes(1));
    expect(window.electronAPI.kickChat.pinMessage).toHaveBeenCalledWith({
      channelSlug: "xqc",
      messageId: "k-pin-1",
      chatroomId: 12345,
      content: "pin this",
      sender: {
        id: 77,
        username: "Viewer Display",
        slug: "viewer-slug",
      },
      durationSeconds: null,
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Pinned message");
    expect(screen.queryByRole("heading", { name: /^Pin message$/ })).toBeNull();
    expect(screen.queryByText("Duration")).toBeNull();
  });

  it("surfaces Kick pin API failures without opening a dialog", async () => {
    window.electronAPI.kickChat.pinMessage = vi.fn(async () => ({
      ok: false as const,
      kind: "forbidden" as const,
      message: "403",
    }));
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);

    await act(async () => {
      await lastListProps.onPin?.(fakePinMessage);
    });

    await waitFor(() => expect(window.electronAPI.kickChat.pinMessage).toHaveBeenCalledTimes(1));
    expect(toastErrorMock).toHaveBeenCalledWith("Couldn't pin message", {
      description: "403",
    });
    expect(screen.queryByRole("heading", { name: /^Pin message$/ })).toBeNull();
    expect(screen.queryByText("Duration")).toBeNull();
  });

  it("surfaces expired Kick web auth instead of silently returning", async () => {
    window.electronAPI.kickChat.pinMessage = vi.fn(async () => ({
      ok: false as const,
      kind: "unauthenticated" as const,
      message: "401",
    }));
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);

    await act(async () => {
      await lastListProps.onPin?.(fakePinMessage);
    });

    await waitFor(() => expect(window.electronAPI.kickChat.pinMessage).toHaveBeenCalledTimes(1));
    expect(toastErrorMock).toHaveBeenCalledWith("Couldn't pin message", {
      description: "401",
    });
  });

  // ---------- U5 — event/notice visibility + poll/prediction widgets ----------
  const addedMessageWithText = (text: string) =>
    (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls
      .map((call: unknown[]) => call[0] as { content?: Array<{ content?: string }> })
      .find((msg) => msg?.content?.[0]?.content === text);

  const addMessageCalledWithText = (text: string): boolean => Boolean(addedMessageWithText(text));

  const fakeNotice = {
    id: "k-notice-1",
    platform: "kick" as const,
    channel: "xqc",
    type: "sub" as const,
    userId: "k-sub",
    username: "subber",
    displayName: "Subber",
    systemMessage: "subber just subscribed",
    timestamp: new Date(),
  };

  const fakePoll = {
    title: "Best emote?",
    options: [
      { id: 1, label: "A", votes: 3 },
      { id: 2, label: "B", votes: 5 },
    ],
    remaining: 30,
    duration: 60,
  };

  const fakePrediction = {
    id: "k-pred-1",
    platform: "kick",
    channelId: "12345",
    channelSlug: "xqc",
    title: "Win or lose?",
    status: "ACTIVE",
    outcomes: [],
    winningOutcomeId: null,
    predictionWindowSeconds: 60,
    endedAt: null,
    viewerOutcomeId: null,
    viewerStake: null,
  } as const;

  it("adds a sub notice to the store by default (showUserNotices true)", () => {
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    expect(mockServiceHandlers.userNotice).toBeTypeOf("function");
    act(() => {
      mockServiceHandlers.userNotice?.(fakeNotice);
    });
    expect(addedMessageWithText("subber just subscribed")).toEqual(
      expect.objectContaining({
        username: "subber",
        displayName: "Subber",
        highlightKind: "subscription",
      })
    );
  });

  it("suppresses sub notices when showUserNotices is false", () => {
    setMockChatDisplay({ showUserNotices: false });
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    act(() => {
      mockServiceHandlers.userNotice?.(fakeNotice);
    });
    expect(addMessageCalledWithText("subber just subscribed")).toBe(false);
  });

  it("renders the poll widget when a poll arrives (showPolls true)", () => {
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    act(() => {
      mockServiceHandlers.pollUpdate?.(fakePoll);
    });
    expect(screen.getByText("Best emote?")).toBeInTheDocument();
  });

  it("hides the poll widget when showPolls is false", () => {
    setMockChatDisplay({ showPolls: false });
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    act(() => {
      mockServiceHandlers.pollUpdate?.(fakePoll);
    });
    expect(screen.queryByText("Best emote?")).toBeNull();
  });

  it("renders the prediction banner when a prediction arrives (showPredictions true)", () => {
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    act(() => {
      mockServiceHandlers.predictionUpdate?.(fakePrediction);
    });
    expect(screen.getByTestId("prediction-banner")).toBeInTheDocument();
  });

  it("hides the prediction banner when showPredictions is false", () => {
    setMockChatDisplay({ showPredictions: false });
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    act(() => {
      mockServiceHandlers.predictionUpdate?.(fakePrediction);
    });
    expect(screen.queryByTestId("prediction-banner")).toBeNull();
  });

  it("passes Kick timeout/ban deletion metadata with moderator attribution into retained rows", () => {
    const deletedAt = new Date("2026-06-29T17:45:00");
    storeState.messagesByChannel["kick:xqc"] = [
      {
        id: "k-msg-1",
        platform: "kick",
        type: "message",
        channel: "xqc",
        userId: "u1",
        username: "spammer",
        displayName: "Spammer",
        color: "#fff",
        badges: [],
        content: [{ type: "text", content: "last words" }],
        rawContent: "last words",
        timestamp: deletedAt,
        isDeleted: false,
        isHighlighted: false,
        isAction: false,
      },
      {
        id: "k-msg-2",
        platform: "kick",
        type: "message",
        channel: "xqc",
        userId: "u1",
        username: "spammer",
        displayName: "Spammer",
        color: "#70AD47",
        badges: [
          {
            setId: "subscriber",
            version: "1",
            imageUrl: "https://example.com/sub.png",
            title: "Subscriber",
          },
        ],
        content: [{ type: "text", content: "more last words" }],
        rawContent: "more last words",
        timestamp: deletedAt,
        isDeleted: false,
        isHighlighted: false,
        isAction: false,
      },
      {
        id: "k-mod-msg",
        platform: "kick",
        type: "message",
        channel: "xqc",
        userId: "mod-1",
        username: "kickmod",
        displayName: "KickMod",
        color: "#5B9BD5",
        badges: [
          {
            setId: "moderator",
            version: "1",
            imageUrl: "https://example.com/mod.png",
            title: "Moderator",
          },
        ],
        content: [{ type: "text", content: "rules" }],
        rawContent: "rules",
        timestamp: deletedAt,
        isDeleted: false,
        isHighlighted: false,
        isAction: false,
      },
    ];
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);

    act(() => {
      mockServiceHandlers.clearChat?.({
        platform: "kick",
        channel: "xqc",
        targetUserId: "u1",
        targetUsername: "spammer",
        bannedByUsername: "KickMod",
        duration: 600,
        isClearAll: false,
        timestamp: deletedAt,
      });
    });

    expect(storeState.deleteMessagesByUser).toHaveBeenCalledWith("kick:xqc", "u1", {
      deletedAt,
      deletedByUser: {
        userId: "mod-1",
        username: "kickmod",
        displayName: "KickMod",
        color: "#5B9BD5",
        badges: [
          {
            setId: "moderator",
            version: "1",
            imageUrl: "https://example.com/mod.png",
            title: "Moderator",
          },
        ],
      },
      deletedByUsername: "KickMod",
    });
    expect(storeState.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        banInfo: expect.objectContaining({
          bannedByUsername: "KickMod",
          bannedUser: {
            userId: "u1",
            username: "spammer",
            displayName: "Spammer",
            color: "#70AD47",
            badges: [
              {
                setId: "subscriber",
                version: "1",
                imageUrl: "https://example.com/sub.png",
                title: "Subscriber",
              },
            ],
          },
          bannedByUser: {
            userId: "mod-1",
            username: "kickmod",
            displayName: "KickMod",
            color: "#5B9BD5",
            badges: [
              {
                setId: "moderator",
                version: "1",
                imageUrl: "https://example.com/mod.png",
                title: "Moderator",
              },
            ],
          },
          lastMessage: "more last words",
          deletedMessages: ["last words", "more last words"],
        }),
      })
    );
  });

  it("passes Kick single-message delete actor attribution into retained rows", () => {
    const deletedAt = new Date("2026-06-29T18:10:00");
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);

    act(() => {
      mockServiceHandlers.messageDeleted?.({
        platform: "kick",
        channel: "xqc",
        messageId: "k-msg-automod",
        deletedByUsername: "AutoMod",
        timestamp: deletedAt,
      });
    });

    expect(storeState.deleteMessage).toHaveBeenCalledWith("kick:xqc", "k-msg-automod", {
      deletedAt,
      deletedByUsername: "AutoMod",
    });
  });

  it("keeps observed ban UI for viewers without attempting moderator-only history persistence", () => {
    const occurredAt = new Date("2026-06-29T17:40:00Z");
    mockIsKickMod.value = false;
    renderKickChat(<KickChat channel="xqc" channelId="channel-123" chatroomId={12345} />);

    act(() => {
      mockServiceHandlers.clearChat?.({
        platform: "kick",
        channel: "xqc",
        targetUserId: "u1",
        targetUsername: "spammer",
        bannedByUsername: "KickMod",
        duration: 600,
        isClearAll: false,
        timestamp: occurredAt,
      });
    });

    expect(storeState.deleteMessagesByUser).toHaveBeenCalledWith(
      "kick:xqc",
      "u1",
      expect.objectContaining({ deletedAt: occurredAt })
    );
    expect(storeState.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ban", channel: "xqc" })
    );
    expect(recordModActionMock).not.toHaveBeenCalled();
  });

  it("records an observed Kick timeout from the platform event without claiming archive coverage", () => {
    const occurredAt = new Date("2026-06-29T17:45:00Z");
    storeState.messagesByChannel["kick:xqc"] = [
      {
        id: "k-mod-msg",
        platform: "kick",
        type: "message",
        channel: "xqc",
        userId: "mod-1",
        username: "kickmod",
        displayName: "KickMod",
        color: "#5B9BD5",
        badges: [],
        content: [{ type: "text", content: "rules" }],
        rawContent: "rules",
        timestamp: occurredAt,
        isDeleted: false,
        isHighlighted: false,
        isAction: false,
      },
    ];
    renderKickChat(<KickChat channel="xqc" channelId="channel-123" chatroomId={12345} />);

    act(() => {
      mockServiceHandlers.clearChat?.({
        platform: "kick",
        channel: "xqc",
        targetUserId: "u1",
        targetUsername: "spammer",
        bannedByUsername: "KickMod",
        duration: 600,
        isClearAll: false,
        timestamp: occurredAt,
      });
    });

    expect(recordModActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "kick",
        channelId: "channel-123",
        channelSlug: "xqc",
        action: "timeout",
        targetUserId: "u1",
        targetUsername: "spammer",
        moderatorUserId: "mod-1",
        moderatorUsername: "kickmod",
        durationSeconds: 600,
        occurredAt: occurredAt.getTime(),
        source: "pusher",
      })
    );
  });
});

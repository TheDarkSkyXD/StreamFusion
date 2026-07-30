import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock } from "../../test-utils";
import { type ChatDisplayPreferences, DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@/shared/auth-types";
import type { ChatMessage } from "@/shared/chat-types";

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
const recordModActionMock = vi.fn(async (_input: unknown) => 1);

vi.mock("@/backend/api/platforms/kick/kick-mod-mutations", () => ({
  banKickUser: (...args: unknown[]) => banKickUserMock(...args),
  timeoutKickUser: (...args: unknown[]) => timeoutKickUserMock(...args),
  unbanKickUser: (...args: unknown[]) => unbanKickUserMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/backend/services/mod-log-writer", () => ({
  modLogWriter: {
    record: (input: unknown) => recordModActionMock(input),
  },
}));

// Mutable mod flag. Defaults to mod (most existing tests exercise the
// mod-action paths). The U7 viewer-path gear test flips it to false so
// ChatPanelTabs takes its single-tab (no-chrome) branch.
const mockIsKickMod = { value: true };
vi.mock("@/hooks/useIsKickMod", () => ({
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
    kickUser: { id: 42, username: "modder", slug: "modder" },
    kickConnected: false,
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
vi.mock("@/backend/services/chat/kick-chat", () => ({
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
vi.mock("@/backend/services/chat/kick-predictions-service", () => ({
  kickPredictionsService: {
    acquire: vi.fn(async () => undefined),
    release: vi.fn(() => undefined),
  },
}));

vi.mock("@/backend/services/emotes", () => ({
  initializeTwitchEmotes: vi.fn(),
  initializeKickEmotes: vi.fn(),
}));

// Stub the prediction banner to a marker so U5's showPredictions gate can be
// asserted without the real countdown / dismiss internals.
vi.mock("@/components/chat/PredictionBanner", () => ({
  PredictionBanner: () => <div data-testid="prediction-banner">prediction</div>,
}));

vi.mock("@/components/chat/mod/tabs/ModLogTab", () => ({
  ModLogTab: () => <div data-testid="mod-log-tab">modlog</div>,
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

import { KickChat } from "@/components/chat/kick/KickChat";
import { TooltipProvider } from "@/components/ui/tooltip";
import { kickChatService } from "@/backend/services/chat/kick-chat";
import { kickPredictionsService } from "@/backend/services/chat/kick-predictions-service";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

function renderKickChat(ui: ReactElement) {
  return render(ui, { wrapper: TooltipProvider });
}

// Guards: loading state — canSend stays false while the Pusher connection is in 'disconnected' state and the kick token is still resolving, so the chat input doesn't accept input bound for the void
// Guards: connecting state appears immediately before Kick token/network setup finishes, so the chat panel never looks blank on slow joins
// Guards: error/reconnect path — canSend remains false even after the connection flips to 'connected' until isAuthenticated catches up, so the input gates correctly on Pusher drop / reconnect cycles
// Guards: empty messages — message list still renders the virtuoso shell (see ChatMessageList tests); chat input still renders, gear chrome still visible in viewer single-tab path (U7)
// Guards: U5 prefs — sub notices / polls / prediction banner each suppress when their visibility pref is false, surface when true. Silent drops here look like "Kick subs aren't firing" — a high-blast UX failure
// Guards: U11 mod actions — Timeout routes through the Electron Kick web session and keeps the seconds→minutes clamp so a 10s preset doesn't round to 0 minutes.
// Guards: Kick pin actions use the original chat message sender, surface auth/API failures, and keep retryable failures visible instead of silently leaving the dialog stuck
// Guards: final-view cleanup skips prediction unsubscribe frames before closing the shared chat Pusher socket, preventing pusher-js "WebSocket is already in CLOSING or CLOSED state" console errors on unmount
describe("KickChat", () => {
  beforeEach(() => {
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: "kick-tok" }));
    api.chat.getKickHistory = vi.fn(async () => ({ success: false }));
    api.kickChat.banUser = vi.fn(async () => ({ ok: true, status: 200, body: "{}" }));
    api.kickChat.timeoutUser = vi.fn(async () => ({ ok: true, status: 200, body: "{}" }));
    api.kickChat.unbanUser = vi.fn(async () => ({ ok: true, status: 200, body: "{}" }));
    api.kickChat.deleteMessage = vi.fn(async () => ({ ok: true, status: 204, body: "" }));
    api.kickChat.getViewerRole = vi.fn(async () => ({
      ok: true,
      isModerator: null,
      status: 200,
    }));
    api.kickChat.pinMessage = vi.fn(async () => ({ ok: true }));
    api.kickChat.unpinMessage = vi.fn(async () => ({ ok: true }));
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
    banKickUserMock.mockReset();
    timeoutKickUserMock.mockReset();
    unbanKickUserMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    recordModActionMock.mockReset();
    recordModActionMock.mockResolvedValue(1);
    vi.mocked(kickChatService.connect).mockClear();
    vi.mocked(kickChatService.acquire).mockClear();
    vi.mocked(kickChatService.release).mockClear();
    vi.mocked(kickChatService.getActiveUserCount).mockClear();
    vi.mocked(kickChatService.getActiveUserCount).mockReturnValue(1);
    vi.mocked(kickChatService.setModeratorState).mockClear();
    vi.mocked(kickPredictionsService.acquire).mockClear();
    vi.mocked(kickPredictionsService.release).mockClear();
    loadGlobalEmotesMock.mockReset();
    storeState.addMessage = vi.fn();
    storeState.addMessageBatched = vi.fn();
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

  it("seeds Kick moderator state immediately when the signed-in user is the broadcaster", async () => {
    renderKickChat(<KickChat channel="xqc" channelId="411439" chatroomId={12345} kickUserId="42" />);

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

    renderKickChat(<KickChat channel="xqc" channelId="411439" chatroomId={12345} />);

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

    renderKickChat(<KickChat channel="xqc" channelId="411439" chatroomId={12345} />);

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

  it("shows the connecting row before Kick token/network setup resolves", async () => {
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(() => new Promise<never>(() => {}));

    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);

    await waitFor(() => {
      const addedTexts = (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (call: unknown[]) => {
          const msg = call[0] as { rawContent?: string } | undefined;
          return msg?.rawContent;
        }
      );
      expect(addedTexts).toContain("Connecting to channel...");
    });
    expect(kickChatService.connect).not.toHaveBeenCalled();
  });

  it("releases predictions without socket frames before releasing the final shared Kick chat socket", () => {
    mockIsKickMod.value = false;
    const { unmount } = renderKickChat(<KickChat channel="xqc" channelId="12345" chatroomId={12345} />);

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

  it("Confirming a Timeout dialog calls the Electron Kick web session with duration in minutes", async () => {
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    act(() => {
      lastListProps.onTimeout?.(fakeMessage);
    });
    // TimeoutDurationPicker defaults to 10 minutes (600s) → 10 minutes after
    // the seconds→minutes conversion in KickChat.
    fireEvent.click(screen.getByRole("button", { name: /^Time out$/ }));
    await waitFor(() => expect(window.electronAPI.kickChat.timeoutUser).toHaveBeenCalledTimes(1));
    expect(window.electronAPI.kickChat.timeoutUser).toHaveBeenCalledWith("xqc", "baduser", 10);
    expect(timeoutKickUserMock).not.toHaveBeenCalled();
  });

  it("records a Kick timeout only after the platform confirms the action", async () => {
    renderKickChat(<KickChat channel="xqc" channelId="channel-123" chatroomId={12345} />);
    act(() => {
      lastListProps.onTimeout?.(fakeMessage);
    });
    fireEvent.click(screen.getByRole("button", { name: /^Time out$/ }));

    await waitFor(() =>
      expect(recordModActionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: "kick",
          channelId: "channel-123",
          channelSlug: "xqc",
          action: "timeout",
          targetUserId: "kuser-9",
          targetUsername: "baduser",
          moderatorUserId: "42",
          moderatorUsername: "modder",
          durationSeconds: 600,
          source: "local",
        })
      )
    );
  });

  it("The 10s preset is clamped to 1 minute before calling Kick (sub-minute not supported)", async () => {
    renderKickChat(<KickChat channel="xqc" chatroomId={12345} />);
    act(() => {
      lastListProps.onTimeout?.(fakeMessage);
    });
    // Click the "10s" chip — the dialog's TimeoutDurationPicker renders 6 chips.
    fireEvent.click(screen.getByRole("button", { name: /^10s$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Time out$/ }));
    await waitFor(() => expect(window.electronAPI.kickChat.timeoutUser).toHaveBeenCalledTimes(1));
    // 10 seconds / 60 → 0 minutes; Math.max(1, …) clamps to 1.
    expect(window.electronAPI.kickChat.timeoutUser).toHaveBeenCalledWith("xqc", "baduser", 1);
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

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installElectronAPIMock, renderWithProviders as render } from '../../test-utils';
import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
} from '@/shared/auth-types';

// U11 — capture the latest ChatMessageList props so tests can simulate a
// toolbar click without rendering the full message virtuoso.
const lastListProps: {
  channelKey?: string;
  onBan?: (m: unknown) => void;
  onTimeout?: (m: unknown) => void;
  onUnban?: (m: unknown) => void;
  onDelete?: (m: unknown) => void;
  selfUserId?: string;
} = {};
// Helper mocks must be hoisted, but referenced module-locally in tests too.
const banUserMock = vi.fn();
const timeoutUserMock = vi.fn();
const unbanUserMock = vi.fn();
const deleteChatMessageMock = vi.fn();

vi.mock('@/backend/api/platforms/twitch/twitch-helix-moderation-mutations', () => ({
  banUser: (...args: unknown[]) => banUserMock(...args),
  timeoutUser: (...args: unknown[]) => timeoutUserMock(...args),
  unbanUser: (...args: unknown[]) => unbanUserMock(...args),
  deleteChatMessage: (...args: unknown[]) => deleteChatMessageMock(...args),
}));

const promptReconnectMock = vi.fn();
vi.mock('@/hooks/useRequireModScopes', () => ({
  useRequireModScopes: () => ({
    hasModScopes: true,
    loading: false,
    promptReconnect: promptReconnectMock,
  }),
}));

// Mutable mod flag. Defaults to mod (most existing tests exercise the
// mod-action paths). The U7 viewer-path gear test flips it to false so
// ChatPanelTabs takes its single-tab (no-chrome) branch.
const mockIsTwitchMod = { value: true };
vi.mock('@/hooks/useIsTwitchMod', () => ({
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

vi.mock('@/store/auth-store', () => {
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
    twitchUser: { id: 'mod-1', login: 'modder', displayName: 'Modder' },
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
  (useAuthStore as unknown as { getState: () => ReturnType<typeof buildState> }).getState =
    () => buildState();
  return { useAuthStore };
});

// Capture the chat-service event handlers so tests can fire userNotice /
// predictionUpdate without a real socket. Keyed by event name; `on` records,
// `off` clears.
const mockServiceHandlers: Record<string, ((arg: unknown) => void) | undefined> = {};
vi.mock('@/backend/services/chat/twitch-chat', () => ({
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
    getConnectionStatus: vi.fn(() => ({ state: 'connected' })),
    joinChannel: vi.fn(async () => true),
  },
}));

vi.mock('@/backend/services/emotes', () => ({
  initializeTwitchEmotes: vi.fn(),
  initializeKickEmotes: vi.fn(),
}));

// The Hermes client opens a real WebSocket on start(); stub it so the unit
// test neither hits the network nor surfaces undici's async WS errors. U5's
// prediction path is exercised by firing the predictionUpdate service handler.
vi.mock('@/backend/services/chat/twitch-hermes-client', () => ({
  TwitchHermesClient: class {
    on() {}
    off() {}
    start() {}
    stop() {}
  },
}));

const storeState = {
  connectionStatus: {
    twitch: { platform: 'twitch', state: 'disconnected', channels: [], isAuthenticated: false },
    kick: { platform: 'kick', state: 'disconnected', channels: [], isAuthenticated: false },
  },
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

vi.mock('@/store/chat-store', () => {
  const useChatStore = ((selector?: (s: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState) as ((selector?: (s: typeof storeState) => unknown) => unknown) & {
    getState: () => typeof storeState;
  };
  useChatStore.getState = () => storeState;
  return {
    buildChannelKey: (platform: string, channel: string) => `${platform}:${channel}`,
    useChatStore,
  };
});

const loadGlobalEmotesMock = vi.fn();
vi.mock('@/store/emote-store', () => {
  const state = {
    loadedChannels: new Set(),
    setActiveChannel: vi.fn(),
    loadChannelEmotes: vi.fn(),
    loadGlobalEmotes: (...args: unknown[]) => loadGlobalEmotesMock(...args),
    unloadChannelEmotes: vi.fn(),
    applyProviderPrefs: vi.fn(),
  };
  return {
    useEmoteStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/components/chat/ChatMessageList', () => ({
  ChatMessageList: (props: typeof lastListProps) => {
    lastListProps.channelKey = props.channelKey;
    lastListProps.onBan = props.onBan;
    lastListProps.onTimeout = props.onTimeout;
    lastListProps.onUnban = props.onUnban;
    lastListProps.onDelete = props.onDelete;
    lastListProps.selfUserId = props.selfUserId;
    return <div data-testid="message-list">messages</div>;
  },
}));

const chatInputProps: { canSend?: boolean } = {};
vi.mock('@/components/chat/ChatInput', () => ({
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
vi.mock('@/components/chat/PredictionBanner', () => ({
  PredictionBanner: () => <div data-testid="prediction-banner">prediction</div>,
}));

import { twitchChatService } from '@/backend/services/chat/twitch-chat';
import { TwitchChat } from '@/components/chat/twitch/TwitchChat';

// Minimal active prediction matching the channelId the multiview gate compares.
const fakePrediction = {
  id: 'pred-1',
  platform: 'twitch',
  channelId: 'ninja-id',
  channelSlug: 'ninja',
  title: 'Who wins?',
  status: 'ACTIVE',
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
describe('TwitchChat', () => {
  beforeEach(() => {
    const api = installElectronAPIMock();
    // Provide a Twitch token so the U11 onConfirm path doesn't early-out.
    api.auth.getToken = vi.fn(async () => ({ accessToken: 'tok', scope: [] }));
    storeState.connectionStatus.kick.state = 'disconnected';
    storeState.connectionStatus.twitch.state = 'disconnected';
    chatInputProps.canSend = undefined;
    lastListProps.onBan = undefined;
    lastListProps.onTimeout = undefined;
    lastListProps.onUnban = undefined;
    lastListProps.onDelete = undefined;
    lastListProps.selfUserId = undefined;
    lastListProps.channelKey = undefined;
    banUserMock.mockReset();
    timeoutUserMock.mockReset();
    unbanUserMock.mockReset();
    deleteChatMessageMock.mockReset();
    promptReconnectMock.mockReset();
    vi.mocked(twitchChatService.connect).mockClear();
    loadGlobalEmotesMock.mockReset();
    storeState.addMessage = vi.fn();
    storeState.clearMessages = vi.fn();
    setMockChatDisplay({});
    mockIsTwitchMod.value = true;
    for (const k of Object.keys(mockServiceHandlers)) delete mockServiceHandlers[k];
  });

  it('renders message list and chat input', () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    expect(screen.getByTestId('message-list')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  it('passes the per-channel key to ChatMessageList', () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    expect(lastListProps.channelKey).toBe('twitch:ninja');
  });

  it('shows the connecting row before Twitch token/network setup resolves', async () => {
    const api = installElectronAPIMock();
    api.auth.getValidTwitchToken = vi.fn(() => new Promise<never>(() => {}));

    render(<TwitchChat channel="ninja" channelId="ninja-id" />);

    await waitFor(() => {
      const addedTexts = (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (call: unknown[]) => {
          const msg = call[0] as { rawContent?: string } | undefined;
          return msg?.rawContent;
        },
      );
      expect(addedTexts).toContain('Connecting to channel...');
    });
    expect(twitchChatService.connect).not.toHaveBeenCalled();
  });

  // U7 — the chat-settings gear lives in the panel header chrome OUTSIDE
  // ChatPanelTabs, so it must survive the single-tab (viewer) path that strips
  // tab chrome. Lock it with a POSITIVE render assertion per the
  // chat-header-banner-lost-in-tab-shell-refactor learning.
  it('renders the chat-settings gear in the single-tab viewer path', () => {
    mockIsTwitchMod.value = false; // viewer → ChatPanelTabs single-tab branch
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    // No tab strip is rendered for a viewer...
    expect(screen.queryByRole('tablist')).toBeNull();
    // ...but the gear (header chrome, sibling of ChatPanelTabs) is still there.
    expect(screen.getByRole('button', { name: /chat settings/i })).toBeInTheDocument();
  });

  it("loads global emotes scoped to 'twitch' after auth/connect", async () => {
    // The branch that calls loadGlobalEmotes('twitch') is gated on
    // `if (twitchClientId)`. Stub the env so the gate opens for this test.
    vi.stubEnv('VITE_TWITCH_CLIENT_ID', 'test-client-id');
    try {
      render(<TwitchChat channel="ninja" channelId="ninja-id" />);
      // The connect effect is async — wait until the platform-scoped call lands
      // before asserting the argument so we don't race the resolve.
      await waitFor(() => expect(loadGlobalEmotesMock).toHaveBeenCalled());
      expect(loadGlobalEmotesMock).toHaveBeenCalledWith('twitch');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('canSend reflects the narrowed connection-state selector', () => {
    storeState.connectionStatus.twitch.state = 'disconnected';
    const { rerender, unmount } = render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    expect(chatInputProps.canSend).toBe(false);

    storeState.connectionStatus.twitch.state = 'connected';
    rerender(<TwitchChat channel="ninja" channelId="ninja-id" />);
    // Still false because isAuthenticated is local state behind the async
    // token resolution. The selector returned a fresh boolean primitive on
    // the re-render, which is the regression we want to catch.
    expect(chatInputProps.canSend).toBe(false);

    unmount();
  });

  // ---------- U11 — mod-action mutation wiring ----------
  const fakeMessage = {
    id: 'msg-42',
    username: 'baduser',
    userId: 'user-99',
    rawContent: 'spam spam spam',
  } as const;

  it('Ban toolbar click opens the ModActionConfirmDialog', () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    expect(lastListProps.onBan).toBeTypeOf('function');
    act(() => {
      lastListProps.onBan?.(fakeMessage);
    });
    expect(screen.getByRole('heading', { name: /^Ban user$/ })).toBeInTheDocument();
  });

  it('Confirming the Ban dialog calls banUser with the correct args', async () => {
    banUserMock.mockResolvedValue({ ok: true, payload: {} });
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      lastListProps.onBan?.(fakeMessage);
    });
    fireEvent.click(screen.getByRole('button', { name: /^Ban user$/ }));
    await waitFor(() => expect(banUserMock).toHaveBeenCalledTimes(1));
    expect(banUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'tok',
        broadcasterId: 'ninja-id',
        moderatorId: 'mod-1',
        userId: 'user-99',
        clientId: expect.any(String),
      }),
    );
  });

  it('A missing-scopes result fires promptReconnect with the listed scopes', async () => {
    banUserMock.mockResolvedValue({
      ok: false,
      kind: 'missing-scopes',
      message: 'Missing scope: moderator:manage:banned_users',
      missingScopes: ['moderator:manage:banned_users'],
    });
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      lastListProps.onBan?.(fakeMessage);
    });
    fireEvent.click(screen.getByRole('button', { name: /^Ban user$/ }));
    await waitFor(() => expect(promptReconnectMock).toHaveBeenCalledTimes(1));
    expect(promptReconnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        missingScopes: ['moderator:manage:banned_users'],
      }),
    );
  });

  // ---------- U5 — event/notice visibility + prediction widget ----------
  const fakeNotice = {
    id: 'notice-1',
    platform: 'twitch' as const,
    channel: 'ninja',
    type: 'sub' as const,
    userId: 'u-sub',
    username: 'subber',
    displayName: 'Subber',
    systemMessage: 'Subber subscribed!',
    timestamp: new Date(),
  };

  // The async connect-flow also calls addMessage ("Connecting…"), so assert on
  // the message CONTENT rather than the call count — this isolates the
  // notice/clear lines from connect-flow noise. The handler binds to the
  // render-time addMessage mock, so the mock must stay stable (no reassign).
  const addMessageCalledWithText = (text: string): boolean =>
    (storeState.addMessage as ReturnType<typeof vi.fn>).mock.calls.some(
      (call: unknown[]) => {
        const msg = call[0] as { content?: Array<{ content?: string }> } | undefined;
        return msg?.content?.[0]?.content === text;
      },
    );

  it('adds a sub/raid notice to the store by default (showUserNotices true)', () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    expect(mockServiceHandlers.userNotice).toBeTypeOf('function');
    act(() => {
      mockServiceHandlers.userNotice?.(fakeNotice);
    });
    expect(addMessageCalledWithText('Subber subscribed!')).toBe(true);
  });

  it('suppresses sub/raid notices when showUserNotices is false', () => {
    setMockChatDisplay({ showUserNotices: false });
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      mockServiceHandlers.userNotice?.(fakeNotice);
    });
    expect(addMessageCalledWithText('Subber subscribed!')).toBe(false);
  });

  it('still clears messages but suppresses the clear notice when showClearChat is false', () => {
    setMockChatDisplay({ showClearChat: false });
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      mockServiceHandlers.clearChat?.({
        platform: 'twitch',
        channel: 'ninja',
        isClearAll: true,
        timestamp: new Date(),
      });
    });
    // The moderation effect runs (chat is cleared for this channel)...
    expect(storeState.clearMessages).toHaveBeenCalledWith('twitch:ninja');
    // ...but the "Chat was cleared" system line is not added.
    expect(addMessageCalledWithText('Chat was cleared')).toBe(false);
  });

  it('adds the "Chat was cleared" notice by default (showClearChat true)', () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      mockServiceHandlers.clearChat?.({
        platform: 'twitch',
        channel: 'ninja',
        isClearAll: true,
        timestamp: new Date(),
      });
    });
    expect(storeState.clearMessages).toHaveBeenCalledWith('twitch:ninja');
    expect(addMessageCalledWithText('Chat was cleared')).toBe(true);
  });

  it('renders the prediction banner when a prediction arrives (showPredictions true)', () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      mockServiceHandlers.predictionUpdate?.(fakePrediction);
    });
    expect(screen.getByTestId('prediction-banner')).toBeInTheDocument();
  });

  it('hides the prediction banner when showPredictions is false', () => {
    setMockChatDisplay({ showPredictions: false });
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    act(() => {
      mockServiceHandlers.predictionUpdate?.(fakePrediction);
    });
    expect(screen.queryByTestId('prediction-banner')).toBeNull();
  });
});

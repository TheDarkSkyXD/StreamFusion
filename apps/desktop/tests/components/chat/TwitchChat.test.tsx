import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installElectronAPIMock } from '../../test-utils';

// U11 — capture the latest ChatMessageList props so tests can simulate a
// toolbar click without rendering the full message virtuoso.
const lastListProps: {
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

vi.mock('@/hooks/useIsTwitchMod', () => ({
  useIsTwitchMod: () => true,
}));

vi.mock('@/store/auth-store', () => {
  const state = {
    twitchUser: { id: 'mod-1', login: 'modder', displayName: 'Modder' },
  };
  const useAuthStore = (selector?: (s: unknown) => unknown) => {
    return selector ? selector(state) : state;
  };
  // useTwitchEventSub (mounted via mod tabs) calls
  // useAuthStore.getState() — provide a static version so the new mod tabs
  // don't crash the existing TwitchChat tests.
  (useAuthStore as unknown as { getState: () => unknown }).getState = () =>
    state;
  return { useAuthStore };
});

vi.mock('@/backend/services/chat/twitch-chat', () => ({
  twitchChatService: {
    connect: vi.fn(async () => true),
    disconnect: vi.fn(async () => true),
    subscribe: vi.fn(() => () => {}),
    acquire: vi.fn(() => undefined),
    release: vi.fn(() => undefined),
    isConnected: vi.fn(() => false),
    sendMessage: vi.fn(async () => true),
    on: vi.fn(),
    off: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    onConnectionStateChange: vi.fn(() => () => {}),
  },
}));

vi.mock('@/backend/services/emotes', () => ({
  initializeTwitchEmotes: vi.fn(),
  initializeKickEmotes: vi.fn(),
}));

const storeState = {
  messages: [],
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
  return { useChatStore };
});

vi.mock('@/store/emote-store', () => {
  const state = {
    loadedChannels: new Set(),
    setActiveChannel: vi.fn(),
    loadChannelEmotes: vi.fn(),
    loadGlobalEmotes: vi.fn(),
    unloadChannelEmotes: vi.fn(),
  };
  return {
    useEmoteStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/components/chat/ChatMessageList', () => ({
  ChatMessageList: (props: typeof lastListProps) => {
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
    return <div data-testid="chat-input">input</div>;
  },
}));

import { TwitchChat } from '@/components/chat/twitch/TwitchChat';

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
    banUserMock.mockReset();
    timeoutUserMock.mockReset();
    unbanUserMock.mockReset();
    deleteChatMessageMock.mockReset();
    promptReconnectMock.mockReset();
  });

  it('renders message list and chat input', () => {
    render(<TwitchChat channel="ninja" channelId="ninja-id" />);
    expect(screen.getByTestId('message-list')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
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
    expect(banUserMock).toHaveBeenCalledWith({
      accessToken: 'tok',
      broadcasterId: 'ninja-id',
      moderatorId: 'mod-1',
      userId: 'user-99',
    });
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
});

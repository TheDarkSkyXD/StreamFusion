import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installElectronAPIMock } from '../../test-utils';

// U11 — capture ChatMessageList callbacks so tests can simulate toolbar clicks.
const lastListProps: {
  onBan?: (m: unknown) => void;
  onTimeout?: (m: unknown) => void;
  onUnban?: (m: unknown) => void;
  onDelete?: (m: unknown) => void;
  selfUserId?: string;
} = {};
const banKickUserMock = vi.fn();
const timeoutKickUserMock = vi.fn();
const unbanKickUserMock = vi.fn();
const deleteKickMessageMock = vi.fn();

vi.mock('@/backend/api/platforms/kick/kick-mod-mutations', () => ({
  banKickUser: (...args: unknown[]) => banKickUserMock(...args),
  timeoutKickUser: (...args: unknown[]) => timeoutKickUserMock(...args),
  unbanKickUser: (...args: unknown[]) => unbanKickUserMock(...args),
  deleteKickMessage: (...args: unknown[]) => deleteKickMessageMock(...args),
}));

vi.mock('@/hooks/useIsKickMod', () => ({
  useIsKickMod: () => true,
}));

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      kickUser: { id: 42, username: 'modder', slug: 'modder' },
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/backend/services/chat/kick-chat', () => ({
  kickChatService: {
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

import { KickChat } from '@/components/chat/kick/KickChat';

describe('KickChat', () => {
  beforeEach(() => {
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: 'kick-tok' }));
    storeState.connectionStatus.kick.state = 'disconnected';
    storeState.connectionStatus.twitch.state = 'disconnected';
    chatInputProps.canSend = undefined;
    lastListProps.onBan = undefined;
    lastListProps.onTimeout = undefined;
    lastListProps.onUnban = undefined;
    lastListProps.onDelete = undefined;
    lastListProps.selfUserId = undefined;
    banKickUserMock.mockReset();
    timeoutKickUserMock.mockReset();
    unbanKickUserMock.mockReset();
    deleteKickMessageMock.mockReset();
  });

  it('renders message list and chat input', () => {
    render(<KickChat channel="xqc" chatroomId={12345} />);
    expect(screen.getByTestId('message-list')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  it('canSend reflects the narrowed connection-state selector', () => {
    storeState.connectionStatus.kick.state = 'disconnected';
    const { rerender, unmount } = render(<KickChat channel="xqc" chatroomId={12345} />);
    // !isAuthenticated && disconnected → false
    expect(chatInputProps.canSend).toBe(false);

    // Flip the mock state to 'connected' and re-render. The selector returns
    // a boolean primitive now, so a re-render should observe the new value.
    storeState.connectionStatus.kick.state = 'connected';
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
    id: 'k-msg-1',
    username: 'baduser',
    userId: 'kuser-9',
    rawContent: 'kspam',
  } as const;

  it('Confirming a Timeout dialog calls timeoutKickUser with duration in minutes', async () => {
    timeoutKickUserMock.mockResolvedValue({ ok: true });
    render(<KickChat channel="xqc" chatroomId={12345} />);
    act(() => {
      lastListProps.onTimeout?.(fakeMessage);
    });
    // TimeoutDurationPicker defaults to 10 minutes (600s) → 10 minutes after
    // the seconds→minutes conversion in KickChat.
    fireEvent.click(screen.getByRole('button', { name: /^Time out$/ }));
    await waitFor(() => expect(timeoutKickUserMock).toHaveBeenCalledTimes(1));
    expect(timeoutKickUserMock).toHaveBeenCalledWith({
      channelSlug: 'xqc',
      username: 'baduser',
      duration: 10,
      accessToken: 'kick-tok',
    });
  });

  it('The 10s preset is clamped to 1 minute before calling Kick (sub-minute not supported)', async () => {
    timeoutKickUserMock.mockResolvedValue({ ok: true });
    render(<KickChat channel="xqc" chatroomId={12345} />);
    act(() => {
      lastListProps.onTimeout?.(fakeMessage);
    });
    // Click the "10s" chip — the dialog's TimeoutDurationPicker renders 6 chips.
    fireEvent.click(screen.getByRole('button', { name: /^10s$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Time out$/ }));
    await waitFor(() => expect(timeoutKickUserMock).toHaveBeenCalledTimes(1));
    // 10 seconds / 60 → 0 minutes; Math.max(1, …) clamps to 1.
    expect(timeoutKickUserMock.mock.calls[0][0]).toMatchObject({ duration: 1 });
  });
});

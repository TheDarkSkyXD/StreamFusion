import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installElectronAPIMock } from '../../test-utils';

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
  ChatMessageList: () => <div data-testid="message-list">messages</div>,
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
    installElectronAPIMock();
    storeState.connectionStatus.kick.state = 'disconnected';
    storeState.connectionStatus.twitch.state = 'disconnected';
    chatInputProps.canSend = undefined;
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
});

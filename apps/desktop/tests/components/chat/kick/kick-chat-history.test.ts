import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installElectronAPIMock } from '../../../test-utils';

// kickPinToNormalized is imported from kick-chat (heavy module). Stub it so the
// seed test stays focused on U5's gate + cap logic.
vi.mock('@/backend/services/chat/kick-chat', () => ({
  kickPinToNormalized: (pin: unknown) => ({ normalized: true, pin }),
}));

vi.mock('@/backend/services/chat/kick-parser', () => ({
  parseKickChatMessage: (event: { id: string; content: string }) => ({
    id: event.id,
    platform: 'kick',
    type: 'message',
    channel: 'xqc',
    userId: 'u1',
    username: 'someone',
    displayName: 'Someone',
    color: '#fff',
    badges: [],
    content: [{ type: 'text', content: event.content }],
    rawContent: event.content,
    timestamp: new Date(),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  }),
}));

import { seedKickChatHistory } from '@/components/chat/kick/kick-chat-history';
import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
} from '@/shared/auth-types';
import { useAuthStore } from '@/store/auth-store';
import { buildChannelKey, useChatStore } from '@/store/chat-store';
import type { ChatMessage } from '@/shared/chat-types';

function setChatDisplay(overrides: Partial<ChatDisplayPreferences>) {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...overrides },
    } as typeof s.preferences,
  }));
}

// v2 returns newest-first; index 0 is the newest.
function makeRawMessages(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `k${i}`,
    chatroom_id: 1,
    content: `c${i}`,
    type: 'message',
    created_at: '2026-05-24T00:00:00Z',
    sender: { id: 1, username: 'someone', slug: 'someone' },
    metadata: undefined,
  }));
}

function makeStoredMessage(id: string, channel: string, rawContent: string): ChatMessage {
  return {
    id,
    platform: 'kick',
    type: 'message',
    channel,
    userId: 'u1',
    username: 'someone',
    displayName: 'Someone',
    color: '#fff',
    badges: [],
    content: [{ type: 'text', content: rawContent }],
    rawContent,
    timestamp: new Date(),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  };
}

const baseParams = {
  channelId: 'chan-1',
  channel: 'xqc',
  isMounted: () => true,
  subscriberBadges: undefined,
} as const;

describe('seedKickChatHistory (U5 recent-messages-on-join)', () => {
  // biome-ignore lint/suspicious/noExplicitAny: test IPC surface.
  let api: any;
  beforeEach(() => {
    api = installElectronAPIMock();
    setChatDisplay({});
    useChatStore.setState({
      messagesByChannel: {},
      pausedChannels: new Set(),
    });
  });

  it('seeds history by default', async () => {
    api.chat.getKickHistory = vi.fn(async () => ({
      success: true,
      data: { messages: makeRawMessages(4), pinnedMessage: null },
    }));
    const prepend = vi.fn();
    const onPinned = vi.fn();
    await seedKickChatHistory({ ...baseParams, prependMessages: prepend, onPinnedMessage: onPinned });
    expect(prepend).toHaveBeenCalledTimes(1);
    expect(prepend.mock.calls[0][0]).toBe(buildChannelKey('kick', 'xqc'));
    expect(prepend.mock.calls[0][1]).toHaveLength(4);
  });

  it('does not seed recent messages when recentMessagesOnJoin is false', async () => {
    setChatDisplay({ recentMessagesOnJoin: false });
    api.chat.getKickHistory = vi.fn(async () => ({
      success: true,
      data: { messages: makeRawMessages(4), pinnedMessage: null },
    }));
    const prepend = vi.fn();
    const onPinned = vi.fn();
    await seedKickChatHistory({ ...baseParams, prependMessages: prepend, onPinnedMessage: onPinned });
    expect(prepend).not.toHaveBeenCalled();
  });

  it('still restores the pinned message when recent-messages seeding is off', async () => {
    setChatDisplay({ recentMessagesOnJoin: false });
    api.chat.getKickHistory = vi.fn(async () => ({
      success: true,
      data: { messages: makeRawMessages(4), pinnedMessage: { message: { id: 'p1' } } },
    }));
    const prepend = vi.fn();
    const onPinned = vi.fn();
    await seedKickChatHistory({ ...baseParams, prependMessages: prepend, onPinnedMessage: onPinned });
    expect(prepend).not.toHaveBeenCalled();
    expect(onPinned).toHaveBeenCalledTimes(1);
  });

  it('caps the seeded messages to recentMessagesLimit (keeps the newest)', async () => {
    setChatDisplay({ recentMessagesLimit: 3 });
    api.chat.getKickHistory = vi.fn(async () => ({
      success: true,
      data: { messages: makeRawMessages(10), pinnedMessage: null },
    }));
    const prepend = vi.fn();
    const onPinned = vi.fn();
    await seedKickChatHistory({ ...baseParams, prependMessages: prepend, onPinnedMessage: onPinned });
    expect(prepend.mock.calls[0][0]).toBe(buildChannelKey('kick', 'xqc'));
    const seeded = prepend.mock.calls[0][1] as Array<{ rawContent: string }>;
    expect(seeded).toHaveLength(3);
    // newest-first input [c0..c9]; the 3 newest are c0,c1,c2, prepended in
    // chronological order (oldest-of-kept first) → c2, c1, c0.
    expect(seeded.map((m) => m.rawContent)).toEqual(['c2', 'c1', 'c0']);
  });

  it('after eviction, re-opening seeds fresh history without stale scrollback', async () => {
    const channelKey = buildChannelKey('kick', 'xqc');
    const stale = makeStoredMessage('stale', 'xqc', 'stale scrollback');
    useChatStore.setState({
      messagesByChannel: { [channelKey]: [stale] },
      pausedChannels: new Set([channelKey]),
    });
    useChatStore.getState().dropChannel(channelKey);
    api.chat.getKickHistory = vi.fn(async () => ({
      success: true,
      data: { messages: makeRawMessages(2), pinnedMessage: null },
    }));

    await seedKickChatHistory({
      ...baseParams,
      prependMessages: useChatStore.getState().prependMessages,
      onPinnedMessage: vi.fn(),
    });

    const bucket = useChatStore.getState().messagesByChannel[channelKey] ?? [];
    expect(api.chat.getKickHistory).toHaveBeenCalledTimes(1);
    expect(bucket.map((m) => m.rawContent)).toEqual(['c1', 'c0']);
    expect(bucket.map((m) => m.rawContent)).not.toContain('stale scrollback');
    expect(useChatStore.getState().pausedChannels.has(channelKey)).toBe(false);
  });
});

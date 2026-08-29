import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installElectronAPIMock } from '../../../test-utils';

// Control the IRC parser so the seed test exercises only U5's gate + cap logic,
// not the real tag parsing. Each "raw" line maps 1:1 to a PRIVMSG.
vi.mock('@backend/services/chat/twitch-irc-parser', () => ({
  parseRawTwitchIrcLine: (raw: string) => ({
    command: 'PRIVMSG',
    channel: 'ninja',
    tags: { 'tmi-sent-ts': '1700000000000' },
    message: raw,
  }),
}));

vi.mock('@backend/services/chat/twitch-parser', () => ({
  parseTwitchMessage: (_channel: string, _tags: unknown, message: string) => ({
    id: `id-${message}`,
    platform: 'twitch',
    type: 'message',
    channel: 'ninja',
    userId: 'u1',
    username: 'ninja',
    displayName: 'Ninja',
    color: '#fff',
    badges: [],
    content: [{ type: 'text', content: message }],
    rawContent: message,
    timestamp: new Date(),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  }),
}));

import { seedTwitchChatHistory } from '@/features/chat/components/chat/twitch/twitch-chat-history';
import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
} from '@shared/auth-types';
import { useAuthStore } from '@/store/auth-store';
import { buildChannelKey, useChatStore } from '@/store/chat-store';
import type { ChatMessage } from '@shared/chat-types';

function setChatDisplay(overrides: Partial<ChatDisplayPreferences>) {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...overrides },
    } as typeof s.preferences,
  }));
}

function setLegacyChatDisplay(chatDisplay: Partial<ChatDisplayPreferences>) {
  useAuthStore.setState((state) => ({
    ...state,
    preferences: {
      ...(state.preferences ?? {}),
      chatDisplay,
    } as typeof state.preferences,
  }));
}

function makeStoredMessage(id: string, channel: string, rawContent: string): ChatMessage {
  return {
    id,
    platform: 'twitch',
    type: 'message',
    channel,
    userId: 'u1',
    username: 'ninja',
    displayName: 'Ninja',
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

// Guards: legacy partial chat preferences still default recent-message history on before live Twitch chat joins.
describe('seedTwitchChatHistory (U5 recent-messages-on-join)', () => {
  let api: ReturnType<typeof installElectronAPIMock>;
  beforeEach(() => {
    api = installElectronAPIMock();
    setChatDisplay({}); // defaults: recentMessagesOnJoin true, limit 100
    useChatStore.setState({
      messagesByChannel: {},
      pausedChannels: new Set(),
    });
  });

  function makeRawMessages(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `m${i}`);
  }

  it('seeds history by default', async () => {
    api.chat.getTwitchHistory = vi.fn(async () => ({
      success: true,
      data: { rawMessages: makeRawMessages(5) },
    }));
    const prepend = vi.fn();
    await seedTwitchChatHistory({ channel: 'ninja', isMounted: () => true, prependMessages: prepend });
    expect(api.chat.getTwitchHistory).toHaveBeenCalledTimes(1);
    expect(prepend).toHaveBeenCalledTimes(1);
    expect(prepend.mock.calls[0][0]).toBe(buildChannelKey('twitch', 'ninja'));
    expect(prepend.mock.calls[0][1]).toHaveLength(5);
  });

  it('seeds history when legacy saved preferences omit the recent-messages toggle', async () => {
    setLegacyChatDisplay({ timestamps: true });
    api.chat.getTwitchHistory = vi.fn(async () => ({
      success: true,
      data: { rawMessages: makeRawMessages(2) },
    }));
    const prepend = vi.fn();

    await seedTwitchChatHistory({
      channel: 'ninja',
      isMounted: () => true,
      prependMessages: prepend,
    });

    expect(api.chat.getTwitchHistory).toHaveBeenCalledTimes(1);
    expect(prepend.mock.calls[0][1]).toHaveLength(2);
  });

  it('does not fetch or seed when recentMessagesOnJoin is false', async () => {
    setChatDisplay({ recentMessagesOnJoin: false });
    api.chat.getTwitchHistory = vi.fn(async () => ({
      success: true,
      data: { rawMessages: makeRawMessages(5) },
    }));
    const prepend = vi.fn();
    await seedTwitchChatHistory({ channel: 'ninja', isMounted: () => true, prependMessages: prepend });
    expect(api.chat.getTwitchHistory).not.toHaveBeenCalled();
    expect(prepend).not.toHaveBeenCalled();
  });

  it('caps the seeded messages to recentMessagesLimit (keeps the newest tail)', async () => {
    setChatDisplay({ recentMessagesLimit: 3 });
    api.chat.getTwitchHistory = vi.fn(async () => ({
      success: true,
      data: { rawMessages: makeRawMessages(10) },
    }));
    const prepend = vi.fn();
    await seedTwitchChatHistory({ channel: 'ninja', isMounted: () => true, prependMessages: prepend });
    expect(prepend.mock.calls[0][0]).toBe(buildChannelKey('twitch', 'ninja'));
    const seeded = prepend.mock.calls[0][1] as Array<{ rawContent: string }>;
    expect(seeded).toHaveLength(3);
    // rawMessages are oldest-first (m0..m9); the kept tail is the newest 3.
    expect(seeded.map((m) => m.rawContent)).toEqual(['m7', 'm8', 'm9']);
  });

  it('after eviction, re-opening seeds fresh history without stale scrollback', async () => {
    const channelKey = buildChannelKey('twitch', 'ninja');
    const stale = makeStoredMessage('stale', 'ninja', 'stale scrollback');
    useChatStore.setState({
      messagesByChannel: { [channelKey]: [stale] },
      pausedChannels: new Set([channelKey]),
    });
    useChatStore.getState().dropChannel(channelKey);
    api.chat.getTwitchHistory = vi.fn(async () => ({
      success: true,
      data: { rawMessages: makeRawMessages(2) },
    }));

    await seedTwitchChatHistory({
      channel: 'ninja',
      isMounted: () => true,
      prependMessages: useChatStore.getState().prependMessages,
    });

    const bucket = useChatStore.getState().messagesByChannel[channelKey] ?? [];
    expect(api.chat.getTwitchHistory).toHaveBeenCalledTimes(1);
    expect(bucket.map((m) => m.rawContent)).toEqual(['m0', 'm1']);
    expect(bucket.map((m) => m.rawContent)).not.toContain('stale scrollback');
    expect(useChatStore.getState().pausedChannels.has(channelKey)).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installElectronAPIMock } from '../../../test-utils';

// Control the IRC parser so the seed test exercises only U5's gate + cap logic,
// not the real tag parsing. Each "raw" line maps 1:1 to a PRIVMSG.
vi.mock('@/backend/services/chat/twitch-irc-parser', () => ({
  parseRawTwitchIrcLine: (raw: string) => ({
    command: 'PRIVMSG',
    channel: 'ninja',
    tags: { 'tmi-sent-ts': '1700000000000' },
    message: raw,
  }),
}));

vi.mock('@/backend/services/chat/twitch-parser', () => ({
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

import { seedTwitchChatHistory } from '@/components/chat/twitch/twitch-chat-history';
import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
} from '@/shared/auth-types';
import { useAuthStore } from '@/store/auth-store';

function setChatDisplay(overrides: Partial<ChatDisplayPreferences>) {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...overrides },
    } as typeof s.preferences,
  }));
}

describe('seedTwitchChatHistory (U5 recent-messages-on-join)', () => {
  // biome-ignore lint/suspicious/noExplicitAny: test IPC surface.
  let api: any;
  beforeEach(() => {
    api = installElectronAPIMock();
    setChatDisplay({}); // defaults: recentMessagesOnJoin true, limit 100
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
    expect(prepend.mock.calls[0][0]).toHaveLength(5);
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
    const seeded = prepend.mock.calls[0][0] as Array<{ rawContent: string }>;
    expect(seeded).toHaveLength(3);
    // rawMessages are oldest-first (m0..m9); the kept tail is the newest 3.
    expect(seeded.map((m) => m.rawContent)).toEqual(['m7', 'm8', 'm9']);
  });
});

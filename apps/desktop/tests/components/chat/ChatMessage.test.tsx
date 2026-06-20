import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatMessage } from '@/components/chat/ChatMessage';
import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
} from '@/shared/auth-types';
import type { ChatBadge, ChatMessage as ChatMessageType } from '@/shared/chat-types';
import { useAuthStore } from '@/store/auth-store';

// Seed the chatDisplay prefs the renderer reads. Leaving the store at its
// natural null default (the afterEach reset) gives DEFAULT_CHAT_DISPLAY_PREFERENCES.
function setChatDisplay(overrides: Partial<ChatDisplayPreferences>) {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...overrides },
    } as typeof s.preferences,
  }));
}

beforeEach(() => {
  // Reset chatDisplay to defaults before each render so the existing tests see
  // the shipped defaults (timestamps off) and new-test overrides don't leak.
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES },
    } as typeof s.preferences,
  }));
});

function badge(setId: string): ChatBadge {
  return { setId, version: '1', imageUrl: 'https://example.com/b.png', title: setId };
}

function baseMessage(overrides: Partial<ChatMessageType> = {}): ChatMessageType {
  return {
    id: 'm1',
    platform: 'twitch',
    timestamp: Date.now(),
    type: 'message',
    userId: 'u1',
    username: 'ninja',
    displayName: 'Ninja',
    color: '#ff0000',
    badges: [],
    content: [{ type: 'text', content: 'hello world' }],
    isAction: false,
    ...overrides,
  } as ChatMessageType;
}

// Guards: inline chat images reserve dimensions and load eagerly so virtualized fast chat does not flicker from row remeasurement
describe('ChatMessage', () => {
  it('renders username and text fragment', () => {
    render(<ChatMessage message={baseMessage()} />);
    expect(screen.getByText('Ninja')).toBeInTheDocument();
    expect(screen.getByText(/hello world/)).toBeInTheDocument();
  });

  it('renders deleted-message placeholder when isDeleted', () => {
    render(<ChatMessage message={baseMessage({ isDeleted: true })} />);
    expect(screen.getByText(/message deleted/i)).toBeInTheDocument();
  });

  it('renders ban info for ban-type messages', () => {
    render(
      <ChatMessage
        message={baseMessage({
          type: 'ban',
          banInfo: {
            bannedUsername: 'spammer',
            bannedByUsername: 'mod',
            duration: 600,
            lastMessage: 'lol',
          },
        }) as ChatMessageType}
      />
    );
    expect(screen.getByText('spammer')).toBeInTheDocument();
    expect(screen.getByText(/timed out for 10m/)).toBeInTheDocument();
  });

  it('renders Kick gifted badge before subscriber badge with Kick-style spacing', () => {
    render(
      <ChatMessage
        message={baseMessage({
          platform: 'kick',
          badges: [
            {
              setId: 'subscriber',
              version: '17',
              imageUrl: 'https://example.com/sub.png',
              title: '17-Month Subscriber',
            },
            {
              setId: 'sub_gifter',
              version: '63',
              imageUrl: 'https://example.com/gift.png',
              title: 'Gifted 63 subs',
            },
          ],
        })}
      />
    );

    const badgeImages = screen.getAllByRole('img');
    expect(badgeImages.map((img) => img.getAttribute('alt'))).toEqual([
      'Gifted 63 subs',
      '17-Month Subscriber',
    ]);
    expect(badgeImages[0].parentElement?.className).toContain('gap-1');
  });
});

describe('ChatMessage chatDisplay appearance (U2)', () => {
  // 2026-05-24T14:05:00 local — distinguishes 12h (2:05 PM) from 24h (14:05).
  const FIXED_TS = new Date(2026, 4, 24, 14, 5, 0).getTime();

  it('hides the timestamp when timestamps is false (default)', () => {
    render(<ChatMessage message={baseMessage({ timestamp: FIXED_TS as unknown as Date })} />);
    expect(screen.queryByText(/14:05|2:05/)).toBeNull();
  });

  it('shows a 24-hour timestamp when format is HH:mm', () => {
    setChatDisplay({ timestamps: true, timestampFormat: 'HH:mm' });
    render(<ChatMessage message={baseMessage({ timestamp: FIXED_TS as unknown as Date })} />);
    expect(screen.getByText('14:05')).toBeInTheDocument();
  });

  it('shows a 12-hour timestamp when format is h:mm a', () => {
    setChatDisplay({ timestamps: true, timestampFormat: 'h:mm a' });
    render(<ChatMessage message={baseMessage({ timestamp: FIXED_TS as unknown as Date })} />);
    // jsdom renders e.g. "2:05 PM"; match the 12-hour shape, not the 24-hour one.
    expect(screen.getByText(/\b2:05\s?PM/i)).toBeInTheDocument();
    expect(screen.queryByText('14:05')).toBeNull();
  });

  it('applies fontSizePx to the message row as an inline style', () => {
    setChatDisplay({ fontSizePx: 18 });
    const { container } = render(<ChatMessage message={baseMessage()} />);
    const row = container.querySelector('.group') as HTMLElement;
    expect(row.style.fontSize).toBe('18px');
  });

  it('uses cozy padding/line-height by default', () => {
    const { container } = render(<ChatMessage message={baseMessage()} />);
    const row = container.querySelector('.group') as HTMLElement;
    expect(row.className).toContain('py-1');
    expect(row.className).toContain('leading-[1.4]');
  });

  it('uses tighter padding/line-height when density is compact', () => {
    setChatDisplay({ density: 'compact' });
    const { container } = render(<ChatMessage message={baseMessage()} />);
    const row = container.querySelector('.group') as HTMLElement;
    expect(row.className).toContain('py-0.5');
    expect(row.className).toContain('leading-[1.2]');
    expect(row.className).not.toContain('leading-[1.4]');
  });

  it('applies emoteSizePx to rendered emote images', () => {
    setChatDisplay({ emoteSizePx: 40 });
    const msg = baseMessage({
      content: [
        { type: 'emote', id: 'e1', name: 'Kappa', url: 'https://example.com/kappa.png' },
      ],
    });
    render(<ChatMessage message={msg} />);
    const img = screen.getByAltText('Kappa') as HTMLImageElement;
    expect(img.style.height).toBe('40px');
    expect(img.style.width).toBe('40px');
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.className).not.toContain('transition-transform');
    expect(img.className).not.toContain('hover:scale');
  });

  it('renders chat badges eagerly with reserved dimensions to avoid row remeasurement flicker', () => {
    render(
      <ChatMessage
        message={baseMessage({
          badges: [
            {
              setId: 'moderator',
              version: '1',
              imageUrl: 'https://example.com/mod.png',
              title: 'Badge',
            },
          ],
        })}
      />
    );

    const img = screen.getByAltText('Badge') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('decoding')).toBe('auto');
    expect(img.className).toContain('w-4');
    expect(img.className).toContain('h-4');
  });

  it('preserves truncation-safe wrapping at min font size with a long username + message', () => {
    // Regression guard for the truncation-trio learning: a very long username +
    // message at the smallest font must not strip the break-words wrapper.
    setChatDisplay({ fontSizePx: 10 });
    const longName = 'a'.repeat(40);
    const longText = 'lorem ipsum '.repeat(20).trim();
    const { container } = render(
      <ChatMessage
        message={baseMessage({
          username: longName,
          displayName: longName,
          content: [{ type: 'text', content: longText }],
        })}
      />
    );
    // The content wrapper keeps break-words so long tokens wrap instead of overflow.
    expect(container.querySelector('.break-words')).not.toBeNull();
    expect(screen.getByText(longName)).toBeInTheDocument();
  });

  it('clamps hostile message content so it cannot create horizontal chat scroll', () => {
    const longToken = 'x'.repeat(180);
    const { container } = render(
      <ChatMessage
        message={baseMessage({
          content: [
            { type: 'text', content: longToken },
            {
              type: 'emote',
              id: 'wide',
              name: 'WideEmote',
              url: 'https://example.com/wide.png',
            },
            {
              type: 'link',
              text: `https://example.com/${longToken}`,
              url: `https://example.com/${longToken}`,
            },
          ],
        })}
      />
    );

    const row = container.querySelector('.group') as HTMLElement;
    expect(row.className).toContain('overflow-x-hidden');

    const content = row.querySelector('[data-testid="chat-message-content"]') as HTMLElement;
    expect(content.className).toContain('max-w-full');
    expect(content.className).toContain('[overflow-wrap:anywhere]');

    const emote = screen.getByAltText('WideEmote') as HTMLImageElement;
    expect(emote.style.maxWidth).toBe('100%');
  });
});

describe('ChatMessage event/notice visibility (U5)', () => {
  function banMessage(): ChatMessageType {
    return baseMessage({
      type: 'ban',
      banInfo: {
        bannedUsername: 'spammer',
        bannedByUsername: 'mod',
        duration: 600,
        lastMessage: 'lol',
      },
    }) as ChatMessageType;
  }

  it('renders the ban/timeout notice by default (showClearChat true)', () => {
    render(<ChatMessage message={banMessage()} />);
    expect(screen.getByText('spammer')).toBeInTheDocument();
  });

  it('hides the ban/timeout notice when showClearChat is false', () => {
    setChatDisplay({ showClearChat: false });
    const { container } = render(<ChatMessage message={banMessage()} />);
    expect(screen.queryByText('spammer')).toBeNull();
    // The whole row is suppressed, not just the text.
    expect(container.firstChild).toBeNull();
  });

  it('renders the "Message deleted" tombstone by default (showClearMsg true)', () => {
    render(<ChatMessage message={baseMessage({ isDeleted: true })} />);
    expect(screen.getByText(/message deleted/i)).toBeInTheDocument();
  });

  it('hides the deletion tombstone when showClearMsg is false', () => {
    setChatDisplay({ showClearMsg: false });
    const { container } = render(<ChatMessage message={baseMessage({ isDeleted: true })} />);
    expect(screen.queryByText(/message deleted/i)).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('applies the first-message highlight on a highlighted chat message by default', () => {
    const { container } = render(
      <ChatMessage message={baseMessage({ isHighlighted: true })} />
    );
    const row = container.querySelector('.group') as HTMLElement;
    expect(row.className).toContain('border-purple-500');
  });

  it('removes the highlight on a chat message when firstMsgHighlight is false', () => {
    setChatDisplay({ firstMsgHighlight: false });
    const { container } = render(
      <ChatMessage message={baseMessage({ isHighlighted: true })} />
    );
    const row = container.querySelector('.group') as HTMLElement;
    expect(row.className).not.toContain('border-purple-500');
  });

  it('keeps the highlight on system lines even when firstMsgHighlight is false', () => {
    // System / connection / notice lines set isHighlighted for their own
    // styling; the viewer toggle only governs real chat messages.
    setChatDisplay({ firstMsgHighlight: false });
    const { container } = render(
      <ChatMessage
        message={baseMessage({
          type: 'system',
          isHighlighted: true,
          content: [{ type: 'text', content: 'Connected to the channel' }],
        })}
      />
    );
    const row = container.querySelector('.group') as HTMLElement;
    expect(row.className).toContain('border-purple-500');
  });

  it('renders emotes in a system message as text when systemMessageEmotes is false', () => {
    setChatDisplay({ systemMessageEmotes: false });
    render(
      <ChatMessage
        message={baseMessage({
          type: 'system',
          content: [
            { type: 'text', content: 'new sub! ' },
            { type: 'emote', id: 'e1', name: 'PogChamp', url: 'https://example.com/pog.png' },
          ],
        })}
      />
    );
    // The emote name shows as text; no <img> is rendered for it.
    expect(screen.getByText('PogChamp')).toBeInTheDocument();
    expect(screen.queryByAltText('PogChamp')).toBeNull();
  });

  it('renders emotes in a system message as images when systemMessageEmotes is true (default)', () => {
    render(
      <ChatMessage
        message={baseMessage({
          type: 'system',
          content: [
            { type: 'emote', id: 'e1', name: 'PogChamp', url: 'https://example.com/pog.png' },
          ],
        })}
      />
    );
    expect(screen.getByAltText('PogChamp')).toBeInTheDocument();
  });

  it('renders emotes normally in a regular chat message regardless of systemMessageEmotes', () => {
    setChatDisplay({ systemMessageEmotes: false });
    render(
      <ChatMessage
        message={baseMessage({
          content: [
            { type: 'emote', id: 'e1', name: 'Kappa', url: 'https://example.com/kappa.png' },
          ],
        })}
      />
    );
    expect(screen.getByAltText('Kappa')).toBeInTheDocument();
  });
});

describe('ChatMessage mod toolbar (U10)', () => {
  const allCallbacks = () => ({
    onTimeout: vi.fn(),
    onBan: vi.fn(),
    onUnban: vi.fn(),
    onDelete: vi.fn(),
    onPin: vi.fn(),
  });

  it('renders all 5 mod toolbar buttons when all callbacks are passed', () => {
    const cbs = allCallbacks();
    render(<ChatMessage message={baseMessage()} {...cbs} />);
    expect(screen.getByRole('button', { name: /timeout user/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ban user$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unban user/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete message/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pin message/i })).toBeInTheDocument();
  });

  it('renders only the Pin button when only onPin is passed', () => {
    render(<ChatMessage message={baseMessage()} onPin={vi.fn()} />);
    expect(screen.getByRole('button', { name: /pin message/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /timeout user/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /unban user/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete message/i })).toBeNull();
  });

  it('renders no toolbar buttons when no callbacks are passed', () => {
    render(<ChatMessage message={baseMessage()} />);
    expect(screen.queryByRole('button', { name: /pin message/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /timeout user/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /unban user/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete message/i })).toBeNull();
  });

  it('hides toolbar entirely when sender has broadcaster badge (AE1)', () => {
    const cbs = allCallbacks();
    render(
      <ChatMessage
        message={baseMessage({ badges: [badge('broadcaster')] })}
        {...cbs}
      />
    );
    expect(screen.queryByRole('button', { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /timeout user/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete message/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pin message/i })).toBeNull();
  });

  it('shows toolbar on own message even when sender has moderator badge (AE2)', () => {
    const cbs = allCallbacks();
    render(
      <ChatMessage
        message={baseMessage({ userId: 'self', badges: [badge('moderator')] })}
        selfUserId="self"
        {...cbs}
      />
    );
    expect(screen.getByRole('button', { name: /timeout user/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ban user$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unban user/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete message/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pin message/i })).toBeInTheDocument();
  });

  it('hides toolbar when sender has moderator badge and is not the signed-in user', () => {
    const cbs = allCallbacks();
    render(
      <ChatMessage
        message={baseMessage({ userId: 'other', badges: [badge('moderator')] })}
        selfUserId="self"
        {...cbs}
      />
    );
    expect(screen.queryByRole('button', { name: /^ban user$/i })).toBeNull();
  });

  it.each(['staff', 'admin', 'global_mod'])(
    'hides toolbar when sender has %s badge',
    (setId) => {
      const cbs = allCallbacks();
      render(
        <ChatMessage
          message={baseMessage({ badges: [badge(setId)] })}
          {...cbs}
        />
      );
      expect(screen.queryByRole('button', { name: /^ban user$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /timeout user/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /delete message/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /pin message/i })).toBeNull();
    }
  );

  it('fires onTimeout with the message when timeout button is clicked', () => {
    const cbs = allCallbacks();
    const msg = baseMessage();
    render(<ChatMessage message={msg} {...cbs} />);
    fireEvent.click(screen.getByRole('button', { name: /timeout user/i }));
    expect(cbs.onTimeout).toHaveBeenCalledTimes(1);
    expect(cbs.onTimeout).toHaveBeenCalledWith(msg);
  });

  it('fires onBan with the message when ban button is clicked', () => {
    const cbs = allCallbacks();
    const msg = baseMessage();
    render(<ChatMessage message={msg} {...cbs} />);
    fireEvent.click(screen.getByRole('button', { name: /^ban user$/i }));
    expect(cbs.onBan).toHaveBeenCalledTimes(1);
    expect(cbs.onBan).toHaveBeenCalledWith(msg);
  });

  it('fires onUnban with the message when unban button is clicked', () => {
    const cbs = allCallbacks();
    const msg = baseMessage();
    render(<ChatMessage message={msg} {...cbs} />);
    fireEvent.click(screen.getByRole('button', { name: /unban user/i }));
    expect(cbs.onUnban).toHaveBeenCalledTimes(1);
    expect(cbs.onUnban).toHaveBeenCalledWith(msg);
  });

  it('fires onDelete with the message when delete button is clicked', () => {
    const cbs = allCallbacks();
    const msg = baseMessage();
    render(<ChatMessage message={msg} {...cbs} />);
    fireEvent.click(screen.getByRole('button', { name: /delete message/i }));
    expect(cbs.onDelete).toHaveBeenCalledTimes(1);
    expect(cbs.onDelete).toHaveBeenCalledWith(msg);
  });

  it('fires onPin with the message when pin button is clicked', () => {
    const cbs = allCallbacks();
    const msg = baseMessage();
    render(<ChatMessage message={msg} {...cbs} />);
    fireEvent.click(screen.getByRole('button', { name: /pin message/i }));
    expect(cbs.onPin).toHaveBeenCalledTimes(1);
    expect(cbs.onPin).toHaveBeenCalledWith(msg);
  });

  it('does not render toolbar on ban-type messages', () => {
    const cbs = allCallbacks();
    render(
      <ChatMessage
        message={baseMessage({
          type: 'ban',
          banInfo: {
            bannedUsername: 'spammer',
            bannedByUsername: 'mod',
            duration: 600,
            lastMessage: 'lol',
          },
        }) as ChatMessageType}
        {...cbs}
      />
    );
    expect(screen.queryByRole('button', { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pin message/i })).toBeNull();
  });

  it('does not render toolbar when isDeleted is true', () => {
    const cbs = allCallbacks();
    render(
      <ChatMessage
        message={baseMessage({ isDeleted: true })}
        {...cbs}
      />
    );
    expect(screen.queryByRole('button', { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pin message/i })).toBeNull();
  });
});

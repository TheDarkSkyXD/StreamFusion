/**
 * ChatInput tests — U9 layout.
 *
 * The new ChatInput hosts InfoBanner + two emote buttons (each with its own
 * EmotePickerPopover) and no longer renders a send button. We mock InfoBanner
 * and EmotePickerPopover at the module boundary to keep these tests focused
 * on the input shell + wiring; the real components have their own test
 * suites.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emotePickerPopoverCalls = vi.hoisted(
  () =>
    [] as Array<{
      isOpen: boolean;
      scope: 'native' | 'thirdParty';
      anchorRef: { current: HTMLElement | null };
    }>,
);

vi.mock('@/backend/services/chat/kick-chat', () => ({
  kickChatService: {
    sendMessage: vi.fn(async () => true),
    sendAction: vi.fn(async () => true),
  },
}));
vi.mock('@/backend/services/chat/twitch-chat', () => ({
  twitchChatService: {
    sendMessage: vi.fn(async () => true),
    sendAction: vi.fn(async () => true),
    sendReply: vi.fn(async () => true),
  },
}));

vi.mock('@/store/chat-store', () => ({
  useChatStore: () => ({ messagesByChannel: {} }),
}));

// Selector-capable zustand mock — mirrors EmotePicker.test.tsx so any
// `useEmoteStore((s) => s.foo)` calls inside EmotePickerPopover (or
// descendants) don't blow up under the mock. We mock EmotePickerPopover
// itself for the open-state assertions below — the real component has its
// own behavior tests.
vi.mock('@/store/emote-store', () => {
  const state = {
    searchEmotes: () => [],
    loadedGlobalPlatforms: new Set<'twitch' | 'kick'>(),
    loadedChannels: new Set(),
    activeChannelId: null,
    favoriteEmotes: [],
    recentEmotes: [],
    isLoading: false,
    getProviderEmotes: () => [],
    getEmotesByProvider: () => new Map(),
    getAllEmotes: () => [],
    addRecentEmote: vi.fn(),
    toggleFavorite: vi.fn(),
    isFavorite: () => false,
  };
  // ChatInput now reads emotes for inline rendering via
  // `useEmoteStore.getState().getAllEmotes()` and resubscribes via
  // `useEmoteStore.subscribe(refresh)` — the selector-callable shape alone
  // isn't enough.
  const useEmoteStore = ((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state) as ((selector?: (s: typeof state) => unknown) => unknown) & {
    getState: () => typeof state;
    subscribe: (fn: (s: typeof state) => void) => () => void;
  };
  useEmoteStore.getState = () => state;
  useEmoteStore.subscribe = () => () => {};
  return { useEmoteStore };
});

// Mock InfoBanner — we control its visibility per test via the impl.
const infoBannerImpl = vi.fn();
vi.mock('@/components/chat/InfoBanner', () => ({
  InfoBanner: (props: { platform: string; channelId: string }) =>
    infoBannerImpl(props) ?? null,
}));

// Mock EmotePickerPopover so we can assert open/closed state without pulling
// in the popover's portal positioning / shallow-zustand wiring.
vi.mock('@/components/chat/EmotePickerPopover', () => ({
  EmotePickerPopover: ({
    isOpen,
    scope,
    anchorRef,
  }: {
    isOpen: boolean;
    scope: 'native' | 'thirdParty';
    onClose: () => void;
    anchorRef: { current: HTMLElement | null };
  }) => {
    emotePickerPopoverCalls.push({ isOpen, scope, anchorRef });
    return isOpen ? <div data-testid={`emote-picker-popover-${scope}`} /> : null;
  },
}));

vi.mock('@/components/chat/EmoteAutocomplete', () => {
  const ctl = {
    isActive: false,
    openAutocomplete: vi.fn(),
    closeAutocomplete: vi.fn(),
    deactivate: vi.fn(),
    checkTrigger: vi.fn(),
  };
  return {
    EmoteAutocomplete: () => null,
    useEmoteAutocomplete: () => ctl,
  };
});

// Both emote buttons now look up the channel avatar for the picker's
// channel-tab thumbnail. Stub the hook so we don't need a QueryClientProvider
// in this shell-focused suite.
vi.mock('@/hooks/queries/useChannels', () => ({
  useChannelByUsername: () => ({ data: undefined }),
}));

vi.mock('@/components/chat/MentionAutocomplete', () => {
  const ctl = {
    isActive: false,
    openAutocomplete: vi.fn(),
    closeAutocomplete: vi.fn(),
    deactivate: vi.fn(),
    checkTrigger: vi.fn(),
  };
  return {
    MentionAutocomplete: () => null,
    useMentionAutocomplete: () => ctl,
  };
});

import { kickChatService } from '@/backend/services/chat/kick-chat';
import { twitchChatService } from '@/backend/services/chat/twitch-chat';
import { ChatInput, type ChatInputHandle } from '@/components/chat/ChatInput';
import type { ChatMessage } from '@/shared/chat-types';

beforeEach(() => {
  emotePickerPopoverCalls.length = 0;
  infoBannerImpl.mockReset();
});

function renderInput(overrides: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  return render(
    <ChatInput
      channel="ninja"
      platform="twitch"
      channelId="12345"
      {...overrides}
    />,
  );
}

describe('ChatInput — basics', () => {
  it('renders a textarea with the default placeholder', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    expect(screen.getByPlaceholderText(/send a message/i)).toBeInTheDocument();
  });

  it('honors a custom placeholder', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ placeholder: 'Type here...' });
    expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument();
  });

  it('updates input value as the user types', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const ta = screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hi' } });
    expect(ta.value).toBe('hi');
  });

  it('respects the disabled prop', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ disabled: true });
    expect(screen.getByPlaceholderText(/send a message/i)).toBeDisabled();
  });

  it('shows "Log in to chat" placeholder when canSend=false', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ canSend: false });
    expect(screen.getByPlaceholderText(/log in to chat/i)).toBeInTheDocument();
  });
});

describe('ChatInput — no send button', () => {
  it('does not render a send button', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    expect(
      screen.queryByRole('button', { name: /send message/i }),
    ).toBeNull();
  });
});

describe('ChatInput — InfoBanner integration', () => {
  it('renders InfoBanner content above the input row when modes are active', () => {
    infoBannerImpl.mockReturnValue(
      <div data-testid="info-banner-stub">Slow Mode [30s]</div>,
    );
    renderInput();
    expect(screen.getByTestId('info-banner-stub')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/send a message/i)).toBeInTheDocument();
  });

  it('renders nothing for InfoBanner when no modes active (banner row is invisible)', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    expect(screen.queryByTestId('info-banner-stub')).toBeNull();
  });

  it('reply preview stacks above InfoBanner when both are active', () => {
    infoBannerImpl.mockReturnValue(
      <div data-testid="info-banner-stub">Slow Mode</div>,
    );
    const ref = createRef<ChatInputHandle>();
    render(
      <ChatInput
        ref={ref}
        channel="ninja"
        platform="twitch"
        channelId="12345"
      />,
    );
    const msg: ChatMessage = {
      id: 'm1',
      platform: 'twitch',
      type: 'message',
      channel: 'ninja',
      userId: 'u1',
      username: 'alice',
      displayName: 'Alice',
      color: '#fff',
      badges: [],
      content: [{ type: 'text', content: 'hello' }],
      rawContent: 'hello',
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };
    act(() => ref.current?.replyTo(msg));
    const replyPreview = screen.getByTestId('reply-preview');
    const banner = screen.getByTestId('info-banner-stub');
    // DOM order check: reply preview comes before banner.
    const root = replyPreview.parentElement;
    expect(root).not.toBeNull();
    const children = Array.from(root!.children);
    const replyIdx = children.findIndex((c) => c === replyPreview);
    const bannerIdx = children.indexOf(banner.parentElement as HTMLElement);
    // banner is wrapped by the InfoBanner stub's render slot, but both share
    // the same parent. If parent equality isn't true, fall back to
    // compareDocumentPosition.
    if (replyIdx >= 0 && bannerIdx >= 0) {
      expect(replyIdx).toBeLessThan(bannerIdx);
    } else {
      const pos = replyPreview.compareDocumentPosition(banner);
      // Node.DOCUMENT_POSITION_FOLLOWING === 4
      expect(pos & 4).toBe(4);
    }
  });
});

describe('ChatInput — emote dialogs', () => {
  it('clicking the native button opens NativeEmotePicker only', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    fireEvent.click(screen.getByTestId('native-emote-button'));
    expect(screen.getByTestId('emote-picker-popover-native')).toBeInTheDocument();
    expect(screen.queryByTestId('emote-picker-popover-thirdParty')).toBeNull();
  });

  it('clicking the third-party button opens ThirdPartyEmotePicker only', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    fireEvent.click(screen.getByTestId('third-party-emote-button'));
    expect(screen.getByTestId('emote-picker-popover-thirdParty')).toBeInTheDocument();
    expect(screen.queryByTestId('emote-picker-popover-native')).toBeNull();
  });

  it('opening native closes third-party (mutual exclusion)', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    fireEvent.click(screen.getByTestId('third-party-emote-button'));
    expect(screen.getByTestId('emote-picker-popover-thirdParty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('native-emote-button'));
    expect(screen.queryByTestId('emote-picker-popover-thirdParty')).toBeNull();
    expect(screen.getByTestId('emote-picker-popover-native')).toBeInTheDocument();
  });

  it('anchors the native picker to the third-party picker position', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    fireEvent.click(screen.getByTestId('native-emote-button'));

    const nativePopover = [...emotePickerPopoverCalls]
      .reverse()
      .find((call) => call.scope === 'native');
    const thirdPartyPopover = [...emotePickerPopoverCalls]
      .reverse()
      .find((call) => call.scope === 'thirdParty');

    expect(nativePopover?.isOpen).toBe(true);
    expect(nativePopover?.anchorRef).toBe(thirdPartyPopover?.anchorRef);
    expect(nativePopover?.anchorRef.current).toBe(screen.getByTestId('third-party-emote-button'));
  });

  it('clicking the same button again closes its dialog', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const btn = screen.getByTestId('native-emote-button');
    fireEvent.click(btn);
    expect(screen.getByTestId('emote-picker-popover-native')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByTestId('emote-picker-popover-native')).toBeNull();
  });

  it('disables both emote buttons when ChatInput is disabled', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ disabled: true });
    expect(screen.getByTestId('native-emote-button')).toBeDisabled();
    expect(screen.getByTestId('third-party-emote-button')).toBeDisabled();
  });

  it('disables both emote buttons when canSend=false', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ canSend: false });
    expect(screen.getByTestId('native-emote-button')).toBeDisabled();
    expect(screen.getByTestId('third-party-emote-button')).toBeDisabled();
  });

  it('uses the KickTalk emote button frame sizing and border treatment', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ platform: 'kick' });
    const nativeButton = screen.getByTestId('native-emote-button');
    const thirdPartyButton = screen.getByTestId('third-party-emote-button');
    const buttonFrame = nativeButton.parentElement;
    const actionRail = buttonFrame?.parentElement;

    expect(nativeButton).toHaveClass('w-14');
    expect(thirdPartyButton).toHaveClass('w-14');
    expect(buttonFrame).toHaveClass('h-[38px]', 'border', 'bg-white/5');
    expect(buttonFrame).toHaveStyle({ borderColor: 'rgba(255,255,255,0.05)' });
    expect(actionRail).toHaveStyle({ borderLeftColor: 'rgba(255,255,255,0.16)' });
  });
});

describe('ChatInput — Enter / Shift+Enter', () => {
  it('Enter sends the message on Twitch', async () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput();
    const ta = screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hello' } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' });
    });
    // Third arg is the optimistic-echo localFragments (built from emote slots;
    // a plain text message produces a single text fragment).
    expect(twitchChatService.sendMessage).toHaveBeenCalledWith('ninja', 'hello', [
      { type: 'text', content: 'hello' },
    ]);
  });

  it('Shift+Enter does NOT send', async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(twitchChatService.sendMessage).mockClear();
    renderInput();
    const ta = screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'line1' } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    });
    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
  });

  it('/me routes to sendAction on Twitch', async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(twitchChatService.sendAction).mockClear();
    renderInput();
    const ta = screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '/me waves' } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' });
    });
    expect(twitchChatService.sendAction).toHaveBeenCalledWith('ninja', 'waves');
  });

  it('/me on Kick wraps in asterisks via sendMessage', async () => {
    infoBannerImpl.mockReturnValue(null);
    vi.mocked(kickChatService.sendMessage).mockClear();
    renderInput({ platform: 'kick' });
    const ta = screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '/me hi' } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' });
    });
    // ChatInput passes `kickUser ?? undefined` as the third arg so Kick's
    // optimistic echo can stamp the local user's badges on outbound messages.
    expect(kickChatService.sendMessage).toHaveBeenCalledWith('ninja', '*hi*', undefined);
  });
});

describe('ChatInput — character counter', () => {
  it('renders countdown when typing; not when empty', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ maxLength: 100 });
    const ta = screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement;
    expect(screen.queryByText('100')).toBeNull();
    fireEvent.change(ta, { target: { value: 'abc' } });
    expect(screen.getByText('97')).toBeInTheDocument();
  });

  it('styles the counter red when over the limit', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ maxLength: 5 });
    const ta = screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '1234567' } });
    const counter = screen.getByText('-2');
    expect(counter).toHaveClass('text-red-500');
  });

  it('styles the counter yellow when within 50 of the limit', () => {
    infoBannerImpl.mockReturnValue(null);
    renderInput({ maxLength: 100 });
    const ta = screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement;
    // 60 chars → 40 remaining → yellow
    fireEvent.change(ta, { target: { value: 'a'.repeat(60) } });
    expect(screen.getByText('40')).toHaveClass('text-yellow-500');
  });
});

describe('ChatInput — imperative handle', () => {
  it('mentionUser prepends @username and focuses', () => {
    infoBannerImpl.mockReturnValue(null);
    const ref = createRef<ChatInputHandle>();
    render(
      <ChatInput
        ref={ref}
        channel="ninja"
        platform="twitch"
        channelId="12345"
      />,
    );
    act(() => ref.current?.mentionUser('alice'));
    const ta = screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement;
    expect(ta.value.startsWith('@alice ')).toBe(true);
  });

  it('mentionUser focuses the textarea and sets the caret at the end (synchronously)', () => {
    infoBannerImpl.mockReturnValue(null);
    const ref = createRef<ChatInputHandle>();
    render(
      <ChatInput ref={ref} channel="ninja" platform="twitch" channelId="12345" />,
    );
    act(() => ref.current?.mentionUser('alice'));
    const ta = screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement;
    expect(ta.value).toBe('@alice ');
    expect(document.activeElement).toBe(ta); // fails on old code: focus is deferred to setTimeout(0)
    expect(ta.selectionStart).toBe(ta.value.length);
    expect(ta.selectionEnd).toBe(ta.value.length);
  });

  it('replyTo sets the reply preview', () => {
    infoBannerImpl.mockReturnValue(null);
    const ref = createRef<ChatInputHandle>();
    render(
      <ChatInput
        ref={ref}
        channel="ninja"
        platform="twitch"
        channelId="12345"
      />,
    );
    const msg: ChatMessage = {
      id: 'm1',
      platform: 'twitch',
      type: 'message',
      channel: 'ninja',
      userId: 'u1',
      username: 'alice',
      displayName: 'Alice',
      color: '#fff',
      badges: [],
      content: [{ type: 'text', content: 'hello' }],
      rawContent: 'hello there',
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };
    act(() => ref.current?.replyTo(msg));
    expect(screen.getByTestId('reply-preview')).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });
});

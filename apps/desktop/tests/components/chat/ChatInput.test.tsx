import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/backend/services/chat/kick-chat', () => ({
  kickChatService: { sendMessage: vi.fn(async () => true) },
}));
vi.mock('@/backend/services/chat/twitch-chat', () => ({
  twitchChatService: { sendMessage: vi.fn(async () => true) },
}));

vi.mock('@/store/chat-store', () => ({
  useChatStore: () => ({ messages: [] }),
}));

vi.mock('@/store/emote-store', () => ({
  useEmoteStore: () => ({
    searchEmotes: () => [],
    globalEmotesLoaded: false,
    loadedChannels: new Set(),
    activeChannelId: null,
  }),
}));

vi.mock('@/components/chat/EmotePicker', () => ({
  EmotePicker: () => null,
}));

vi.mock('@/components/chat/EmoteAutocomplete', () => ({
  EmoteAutocomplete: () => null,
  useEmoteAutocomplete: () => ({
    isActive: false,
    openAutocomplete: vi.fn(),
    closeAutocomplete: vi.fn(),
    checkTrigger: vi.fn(),
  }),
}));

vi.mock('@/components/chat/MentionAutocomplete', () => ({
  MentionAutocomplete: () => null,
  useMentionAutocomplete: () => ({
    isActive: false,
    openAutocomplete: vi.fn(),
    closeAutocomplete: vi.fn(),
    checkTrigger: vi.fn(),
  }),
}));

import { ChatInput } from '@/components/chat/ChatInput';

describe('ChatInput', () => {
  it('renders a textarea with the default placeholder', () => {
    render(<ChatInput channel="ninja" platform="twitch" />);
    expect(screen.getByPlaceholderText(/send a message/i)).toBeInTheDocument();
  });

  it('honors a custom placeholder', () => {
    render(<ChatInput channel="ninja" platform="twitch" placeholder="Type here..." />);
    expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument();
  });

  it('updates input value as the user types', () => {
    render(<ChatInput channel="ninja" platform="twitch" />);
    const ta = screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hi' } });
    expect(ta.value).toBe('hi');
  });

  it('respects the disabled prop', () => {
    render(<ChatInput channel="ninja" platform="twitch" disabled />);
    expect(screen.getByPlaceholderText(/send a message/i)).toBeDisabled();
  });
});

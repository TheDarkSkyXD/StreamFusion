import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/store/emote-store', () => {
  const state = {
    globalEmotesLoaded: true,
    loadedChannels: new Set(),
    activeChannelId: null,
    favoriteEmotes: [],
    recentEmotes: [],
    isLoading: false,
    getProviderEmotes: () => [],
    getEmotesByProvider: () => new Map(),
    addRecentEmote: vi.fn(),
    toggleFavorite: vi.fn(),
    isFavorite: () => false,
    searchEmotes: () => [],
  };
  return {
    useEmoteStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

import { EmotePicker } from '@/components/chat/EmotePicker';

describe('EmotePicker', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<EmotePicker isOpen={false} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders search input when open', () => {
    render(<EmotePicker isOpen={true} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });
});

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/store/emote-store', () => ({
  useEmoteStore: () => ({
    searchEmotes: () => [],
    loadedChannels: new Set(),
    activeChannelId: null,
  }),
}));

import { EmoteAutocomplete } from '@/components/chat/EmoteAutocomplete';

describe('EmoteAutocomplete', () => {
  it('renders nothing when not active', () => {
    const { container } = render(
      <EmoteAutocomplete
        inputValue=""
        cursorPosition={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when active but no trigger char in input', () => {
    const { container } = render(
      <EmoteAutocomplete
        inputValue="hello"
        cursorPosition={5}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={true}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

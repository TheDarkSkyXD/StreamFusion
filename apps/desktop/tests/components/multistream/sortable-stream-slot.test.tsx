import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/components/multistream/stream-slot', () => ({
  StreamSlot: ({ channelName }: { channelName: string }) => (
    <div data-testid="inner-slot">{channelName}</div>
  ),
}));

import { SortableStreamSlot } from '@/components/multistream/sortable-stream-slot';

describe('SortableStreamSlot', () => {
  it('forwards channelName to the inner StreamSlot', () => {
    renderWithProviders(
      <SortableStreamSlot
        id="s1"
        platform="twitch"
        channelName="ninja"
        isMuted={false}
        onRemove={() => {}}
        onFocus={() => {}}
        isFocused={false}
      />
    );
    expect(screen.getByTestId('inner-slot')).toHaveTextContent('ninja');
  });
});

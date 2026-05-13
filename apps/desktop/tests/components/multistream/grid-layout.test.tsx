import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

let mockState = {
  streams: [] as Array<{ id: string; platform: string; channelName: string }>,
  layout: 'grid' as 'grid' | 'focus',
  focusedStreamId: null as string | null,
};

vi.mock('@/store/multistream-store', () => ({
  useMultiStreamStore: () => ({
    ...mockState,
    removeStream: vi.fn(),
    setFocusedStream: vi.fn(),
    toggleMute: vi.fn(),
    reorderStreams: vi.fn(),
  }),
}));

vi.mock('@/components/multistream/sortable-stream-slot', () => ({
  SortableStreamSlot: ({ channelName }: { channelName: string }) => (
    <div data-testid="sortable-slot">{channelName}</div>
  ),
}));

vi.mock('@/components/multistream/stream-slot', () => ({
  StreamSlot: () => <div data-testid="slot">slot</div>,
}));

import { MultiStreamGrid } from '@/components/multistream/grid-layout';

describe('MultiStreamGrid', () => {
  it('renders an empty state when no streams', () => {
    mockState = { streams: [], layout: 'grid', focusedStreamId: null };
    renderWithProviders(<MultiStreamGrid />);
    expect(screen.getByText(/no active streams/i)).toBeInTheDocument();
  });

  it('renders one slot per stream', () => {
    mockState = {
      streams: [
        { id: 's1', platform: 'twitch', channelName: 'ninja' },
        { id: 's2', platform: 'kick', channelName: 'xqc' },
      ],
      layout: 'grid',
      focusedStreamId: null,
    };
    renderWithProviders(<MultiStreamGrid />);
    expect(screen.getAllByTestId('sortable-slot')).toHaveLength(2);
  });
});

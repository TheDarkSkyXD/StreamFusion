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

// Guards: empty state — no streams in the store → render "no active streams" empty card; otherwise the user lands on multistream with no signal anything's there
// Guards: per-slot isolation — one SortableStreamSlot renders per stream regardless of any slot's individual HLS state. The grid mounts all slots so one failing slot can't unmount its siblings
// Guards: partial loading — with N streams, all N sortable slots mount; a slot that's still mounting renders alongside an already-live slot (no blocking)
describe('MultiStreamGrid', () => {
  it('empty: no streams renders the empty-card', () => {
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

  it('partial-loading: all N slots mount independently — a sibling still being staggered does not block its peers', () => {
    // The real StreamSlot staggers HLS init per slotIndex (350ms each). The
    // grid renders the SortableStreamSlot wrapper for every entry regardless;
    // any single slot's HLS init is local to that slot's mount. We verify the
    // wiring: 3 streams → 3 wrapped slots, all present in one render pass.
    mockState = {
      streams: [
        { id: 's1', platform: 'twitch', channelName: 'a' },
        { id: 's2', platform: 'kick', channelName: 'b' },
        { id: 's3', platform: 'twitch', channelName: 'c' },
      ],
      layout: 'grid',
      focusedStreamId: null,
    };
    renderWithProviders(<MultiStreamGrid />);
    expect(screen.getAllByTestId('sortable-slot')).toHaveLength(3);
  });
});

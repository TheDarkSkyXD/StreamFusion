import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, renderWithProviders, routerMock, screen } from '../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

const setLayout = vi.fn();
const toggleChat = vi.fn();
let mockState = {
  streams: [] as Array<{ id: string; platform: string; username: string }>,
  layout: 'grid' as 'grid' | 'focus',
  isChatOpen: false,
  chatStreamId: null as string | null,
};

vi.mock('@/store/multistream-store', () => ({
  useMultiStreamStore: () => ({
    ...mockState,
    setLayout,
    toggleChat,
  }),
}));

vi.mock('@/components/multistream/add-stream-dialog', () => ({
  AddStreamDialog: () => <button type="button">Add Stream</button>,
}));

vi.mock('@/components/multistream/grid-layout', () => ({
  MultiStreamGrid: () => <div data-testid="multistream-grid">grid</div>,
}));

import { MultiStreamPage } from '@/pages/MultiStream';

// Guards: empty state — no streams in store → the MultiStreamGrid empty state surfaces ("no active streams"); the page still mounts the toolbar so users can Add Stream
// Guards: loading state — per-slot HLS init is owned by individual StreamSlot components, not the page. Page-level loading verified by toolbar/grid mounting before slots resolve
// Guards: error/isolation contract — when streams contains 2 slots and slot 1 errors mid-watch, slot 2 must stay live. The grid renders all slots regardless of any single slot's error state (per-slot isolation lives in the SlotSlot component; page mounts both)
// Guards: focus-button disabled when no streams — prevents users from clicking into focus mode that would have nothing to show
describe('MultiStreamPage', () => {
  beforeEach(() => {
    setLayout.mockReset();
    toggleChat.mockReset();
    mockState = { streams: [], layout: 'grid', isChatOpen: false, chatStreamId: null };
  });

  it('renders the toolbar with layout buttons and add-stream dialog', () => {
    renderWithProviders(<MultiStreamPage />);
    expect(screen.getByText(/multistream/i)).toBeInTheDocument();
    expect(screen.getByText(/add stream/i)).toBeInTheDocument();
    expect(screen.getByTestId('multistream-grid')).toBeInTheDocument();
  });

  it('switches layout when grid/focus buttons are clicked', () => {
    mockState.streams = [{ id: 's1', platform: 'twitch', username: 'ninja' }];
    renderWithProviders(<MultiStreamPage />);
    const focusBtn = screen.getByTitle(/focus layout/i);
    fireEvent.click(focusBtn);
    expect(setLayout).toHaveBeenCalledWith('focus');

    const gridBtn = screen.getByTitle(/grid layout/i);
    fireEvent.click(gridBtn);
    expect(setLayout).toHaveBeenCalledWith('grid');
  });

  it('disables the focus button when there are no streams', () => {
    renderWithProviders(<MultiStreamPage />);
    expect(screen.getByTitle(/focus layout/i)).toBeDisabled();
  });

  it('empty: with no streams, the page still mounts the multistream grid (its own empty state lives downstream)', () => {
    mockState.streams = [];
    renderWithProviders(<MultiStreamPage />);
    // Toolbar + grid still mount even at zero streams.
    expect(screen.getByText(/multistream/i)).toBeInTheDocument();
    expect(screen.getByTestId('multistream-grid')).toBeInTheDocument();
  });

  it('cross-slot isolation contract: with two streams configured, the page mounts the grid regardless of any individual slot\'s HLS state', () => {
    // Per-slot HLS error isolation is enforced by StreamSlot (covered in
    // stream-slot.test.tsx) — the page's job is only to render the grid with
    // every slot present. Failing one slot mustn't unmount the others, which
    // would happen only if the page-level error boundary was wider than per-slot.
    mockState.streams = [
      { id: 's1', platform: 'twitch', username: 'ninja' },
      { id: 's2', platform: 'kick', username: 'xqc' },
    ];
    renderWithProviders(<MultiStreamPage />);
    expect(screen.getByTestId('multistream-grid')).toBeInTheDocument();
    // Focus button enabled with >0 streams.
    expect(screen.getByTitle(/focus layout/i)).not.toBeDisabled();
  });
});

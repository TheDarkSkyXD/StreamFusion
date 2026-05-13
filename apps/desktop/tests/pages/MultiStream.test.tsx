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
});

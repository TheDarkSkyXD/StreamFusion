import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, renderWithProviders, routerMock, screen } from '../test-utils';

vi.mock('@tanstack/react-router', () => routerMock({ params: { platform: 'twitch', clipId: 'clip-0' } }));

const addToHistory = vi.fn();
vi.mock('@/store/history-store', () => ({
  useHistoryStore: () => ({ addToHistory }),
}));

import { ClipPage } from '@/pages/Clip';

describe('ClipPage', () => {
  beforeEach(() => {
    addToHistory.mockReset();
  });

  it('renders the placeholder clip title from mock data', () => {
    renderWithProviders(<ClipPage />);
    expect(screen.getByText(/playing clip:/i)).toBeInTheDocument();
  });

  it('renders Share and Follow action buttons', () => {
    renderWithProviders(<ClipPage />);
    expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /follow/i })).toBeInTheDocument();
  });

  it('toggles follow state when the follow button is clicked', () => {
    renderWithProviders(<ClipPage />);
    const followBtn = screen.getByRole('button', { name: /follow/i });
    fireEvent.click(followBtn);
    // After toggle the button no longer has "Follow" text — it shows an icon instead.
    expect(screen.queryByRole('button', { name: /^follow$/i })).not.toBeInTheDocument();
  });

  it('adds the clip to history on mount', () => {
    renderWithProviders(<ClipPage />);
    expect(addToHistory).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'clip', platform: 'twitch' })
    );
  });
});

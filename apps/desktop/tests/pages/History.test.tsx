import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, renderWithProviders, routerMock, screen } from '../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

const removeFromHistory = vi.fn();
const clearHistory = vi.fn();
let mockHistory: Array<{
  id: string;
  originalId: string;
  title: string;
  thumbnail?: string;
  platform: 'twitch' | 'kick';
  type: 'video' | 'clip' | 'stream';
  channelName: string;
  channelDisplayName?: string;
  timestamp: number;
}> = [];

vi.mock('@/store/history-store', () => ({
  useHistoryStore: () => ({ history: mockHistory, removeFromHistory, clearHistory }),
}));

import { HistoryPage } from '@/pages/History';

describe('HistoryPage', () => {
  beforeEach(() => {
    removeFromHistory.mockReset();
    clearHistory.mockReset();
    mockHistory = [];
  });

  it('shows empty-state when no history exists', () => {
    renderWithProviders(<HistoryPage />);
    expect(screen.getByText(/no watch history yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/clear history/i)).not.toBeInTheDocument();
  });

  it('renders history items grouped with platform/type badges', () => {
    mockHistory = [
      {
        id: '1',
        originalId: 'v1',
        title: 'Cool VOD',
        platform: 'twitch',
        type: 'video',
        channelName: 'ninja',
        channelDisplayName: 'Ninja',
        timestamp: Date.now(),
      },
      {
        id: '2',
        originalId: 'c1',
        title: 'Insane clip',
        platform: 'kick',
        type: 'clip',
        channelName: 'xqc',
        timestamp: Date.now(),
      },
    ];
    renderWithProviders(<HistoryPage />);
    expect(screen.getByText('Cool VOD')).toBeInTheDocument();
    expect(screen.getByText('Insane clip')).toBeInTheDocument();
    expect(screen.getByText('twitch')).toBeInTheDocument();
    expect(screen.getByText('kick')).toBeInTheDocument();
  });

  it('calls clearHistory after the confirm dialog', () => {
    mockHistory = [
      {
        id: '1',
        originalId: 'v1',
        title: 'X',
        platform: 'twitch',
        type: 'video',
        channelName: 'a',
        timestamp: Date.now(),
      },
    ];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<HistoryPage />);
    fireEvent.click(screen.getByRole('button', { name: /clear history/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(clearHistory).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('skips clearHistory if the confirm is dismissed', () => {
    mockHistory = [
      {
        id: '1',
        originalId: 'v1',
        title: 'X',
        platform: 'twitch',
        type: 'video',
        channelName: 'a',
        timestamp: Date.now(),
      },
    ];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithProviders(<HistoryPage />);
    fireEvent.click(screen.getByRole('button', { name: /clear history/i }));
    expect(clearHistory).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

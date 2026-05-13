import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock } from '../../test-utils';

vi.mock('@tanstack/react-router', () => ({
  ...routerMock(),
  useNavigate: () => vi.fn(),
}));

vi.mock('@/store/pip-store', () => ({
  usePipStore: () => ({
    currentStream: null,
    isPipActive: false,
    closePip: vi.fn(),
    isOnStreamPage: false,
  }),
}));

vi.mock('@/store/adblock-store', () => ({
  useAdBlockStore: () => true,
}));

vi.mock('@/components/player/hooks/use-volume', () => ({
  useVolume: () => ({
    isMuted: false,
    handleToggleMute: vi.fn(),
    syncFromVideoElement: vi.fn(),
    volume: 100,
    handleVolumeChange: vi.fn(),
  }),
}));

vi.mock('@/hooks/useStreamPlayback', () => ({
  useStreamPlayback: () => ({
    playback: null,
    isLoading: false,
    error: null,
    isUsingProxy: false,
    reload: vi.fn(),
    retryWithoutProxy: vi.fn(),
    reloadAttempts: 0,
  }),
}));

vi.mock('@/components/player/hls-player', () => ({
  HlsPlayer: () => <div data-testid="hls" />,
}));

vi.mock('@/components/player/twitch/twitch-hls-player', () => ({
  TwitchHlsPlayer: () => <div data-testid="tw-hls" />,
}));

import { MiniPlayer } from '@/components/player/mini-player';

describe('MiniPlayer', () => {
  it('renders nothing when no current stream / not pip active', () => {
    const { container } = renderWithProviders(<MiniPlayer />);
    expect(container.firstChild).toBeNull();
  });
});

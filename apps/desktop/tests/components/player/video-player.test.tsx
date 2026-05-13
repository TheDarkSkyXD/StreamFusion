import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test-utils';

vi.mock('@/components/player/hls-player', () => ({
  HlsPlayer: () => <div data-testid="hls">hls</div>,
}));

vi.mock('@/components/player/player-controls', () => ({
  PlayerControls: () => <div data-testid="player-controls">controls</div>,
}));

vi.mock('@/components/player/hooks/use-fullscreen', () => ({
  useFullscreen: () => ({ isFullscreen: false, toggleFullscreen: vi.fn() }),
}));
vi.mock('@/components/player/hooks/use-picture-in-picture', () => ({
  usePictureInPicture: () => ({ isPip: false, togglePip: vi.fn() }),
}));
vi.mock('@/components/player/hooks/use-default-quality', () => ({
  useDefaultQuality: () => ({ defaultQuality: 'auto', setDefaultQuality: vi.fn() }),
}));
vi.mock('@/components/player/hooks/use-player-keyboard', () => ({
  usePlayerKeyboard: () => undefined,
}));
vi.mock('@/components/player/hooks/use-resume-playback', () => ({
  useResumePlayback: () => ({ initialPosition: 0, saveProgress: vi.fn() }),
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

import { VideoPlayer } from '@/components/player/video-player';

describe('VideoPlayer', () => {
  it('mounts the HLS player and the controls layer', () => {
    const { getByTestId } = renderWithProviders(
      <VideoPlayer streamUrl="https://x.test/master.m3u8" platform="twitch" />
    );
    expect(getByTestId('hls')).toBeInTheDocument();
    expect(getByTestId('player-controls')).toBeInTheDocument();
  });
});

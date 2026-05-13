import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported() {
      return true;
    }
    static Events = {
      MANIFEST_PARSED: 'hlsManifestParsed',
      LEVEL_SWITCHED: 'hlsLevelSwitched',
      ERROR: 'hlsError',
      MEDIA_ATTACHED: 'hlsMediaAttached',
      FRAG_LOADED: 'hlsFragLoaded',
    };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    static ErrorDetails = { MANIFEST_LOAD_ERROR: 'manifestLoadError' };
    loadSource = vi.fn();
    attachMedia = vi.fn();
    on = vi.fn();
    off = vi.fn();
    destroy = vi.fn();
    startLoad = vi.fn();
    stopLoad = vi.fn();
    recoverMediaError = vi.fn();
    levels = [];
  }
  return { default: FakeHls };
});

import { HlsPlayer } from '@/components/player/hls-player';

describe('HlsPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a video element', () => {
    const { container } = render(<HlsPlayer src="https://x.test/playlist.m3u8" />);
    expect(container.querySelector('video')).toBeInTheDocument();
  });
});

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

// Guards: mount path — HlsPlayer ALWAYS mounts the <video> element so the layout is reserved before HLS init resolves; the parent's loading overlay sits on top until canplay fires
// Guards: error recovery contract — onError is invoked with PlayerError shape for NETWORK_ERROR / MEDIA_ERROR / NO_FRAGMENTS / STREAM_OFFLINE. Recovery sequence: nudge → startLoad → recoverMediaError → fatal shouldRefresh. The SUT's recovery logic owns this; tests/components/player/hls-player-stall-watchdog.test.tsx covers the stall-watchdog branch
// Note: full error-path coverage lives in hls-player-stall-watchdog.test.tsx + the player-controls test files. This file locks the video-element mount contract — the rest is delegated.
describe('HlsPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mount: always mounts the video element so the layout reserves space while HLS init resolves', () => {
    const { container } = render(<HlsPlayer src="https://x.test/playlist.m3u8" />);
    expect(container.querySelector('video')).toBeInTheDocument();
  });
});

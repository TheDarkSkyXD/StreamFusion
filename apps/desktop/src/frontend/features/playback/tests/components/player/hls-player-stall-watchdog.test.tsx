import { render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type EventHandler = (event: string, data: unknown) => void;

const fakeHlsModule = vi.hoisted(() => {
  let latest: FakeHlsInstance | null = null;

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

    handlers = new Map<string, EventHandler[]>();
    config = { backBufferLength: 30 };
    levels: unknown[] = [];
    currentLevel = -1;
    startLevel = -1;
    playingDate: Date | null = null;

    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    startLoad = vi.fn();
    stopLoad = vi.fn();
    recoverMediaError = vi.fn();

    constructor() {
      latest = this as unknown as FakeHlsInstance;
    }

    on = vi.fn((event: string, handler: EventHandler) => {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
    });

    off = vi.fn();

    emit(event: string, data: unknown = {}) {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(event, data);
      }
    }
  }

  return {
    FakeHls,
    getLatest: () => latest,
    reset: () => {
      latest = null;
    },
  };
});

type FakeHlsInstance = InstanceType<typeof fakeHlsModule.FakeHls>;

vi.mock('hls.js', () => ({ default: fakeHlsModule.FakeHls }));

import { HlsPlayer } from '@/features/playback/components/player/hls-player';

interface MutableVideo {
  currentTime: number;
  paused: boolean;
  ended: boolean;
  readyState: number;
}

/**
 * Replace the jsdom `<video>` props with backing fields we control.
 * jsdom's defaults are non-writable, so the watchdog would always see
 * `paused: true, readyState: 0` and skip every tick.
 */
function makeVideoMutable(video: HTMLVideoElement): MutableVideo {
  const state: MutableVideo = {
    currentTime: 0,
    paused: false,
    ended: false,
    readyState: 4, // HAVE_ENOUGH_DATA
  };
  for (const key of Object.keys(state) as (keyof MutableVideo)[]) {
    Object.defineProperty(video, key, {
      configurable: true,
      get: () => state[key],
      set: (v) => {
        (state as unknown as Record<string, unknown>)[key] = v;
      },
    });
  }
  Object.defineProperty(video, 'buffered', {
    configurable: true,
    get: () => ({ length: 1, start: () => 0, end: () => state.currentTime + 30 }),
  });
  return state;
}

/**
 * Advance time in chunks while emitting FRAG_LOADED every step so the
 * fragment heartbeat stays satisfied and
 * does NOT independently call startLoad / recoverMediaError. The H1 scenario
 * being tested is exactly: fragments still flow, but the decoder hangs.
 */
function advance(hls: FakeHlsInstance, ms: number) {
  const STEP = 2000;
  let remaining = ms;
  while (remaining > 0) {
    const step = Math.min(STEP, remaining);
    act(() => {
      hls.emit('hlsFragLoaded', {});
      vi.advanceTimersByTime(step);
    });
    remaining -= step;
  }
}

describe('HlsPlayer stall watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeHlsModule.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the shared decoder-stall ladder after playback has started', () => {
    const onError = vi.fn();
    const { container } = render(
      <HlsPlayer src="https://x.test/playlist.m3u8" isLive onError={onError} />
    );
    const video = container.querySelector('video')!;
    const videoState = makeVideoMutable(video);

    const hls = fakeHlsModule.getLatest()!;
    act(() => {
      hls.emit('hlsManifestParsed', { levels: [] });
      video.dispatchEvent(new Event('playing'));
      video.dispatchEvent(new Event('stalled'));
    });

    // Buffered output has stalled: soft recovery nudges at 2.5s.
    advance(hls, 2500);
    expect(videoState.currentTime).toBeCloseTo(0.1, 5);
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.recoverMediaError).not.toHaveBeenCalled();

    // The hard decoder-only rung recovers media at 5.5s.
    advance(hls, 3000);
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(1);

    // The incident exhausts once at 7.5s and delegates refresh to the parent.
    advance(hls, 2000);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DECODER_STALL', fatal: true, shouldRefresh: true })
    );
    expect(hls.destroy).toHaveBeenCalled();
  });

  it('does not fire while paused', () => {
    const onError = vi.fn();
    const { container } = render(
      <HlsPlayer src="https://x.test/playlist.m3u8" isLive onError={onError} />
    );
    const video = container.querySelector('video')!;
    const videoState = makeVideoMutable(video);
    videoState.paused = true;

    const hls = fakeHlsModule.getLatest()!;
    act(() => {
      hls.emit('hlsManifestParsed', { levels: [] });
      video.dispatchEvent(new Event('playing'));
      video.dispatchEvent(new Event('waiting'));
    });

    advance(hls, 30000);
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.recoverMediaError).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('resets escalation after sustained currentTime progress', () => {
    const { container } = render(<HlsPlayer src="https://x.test/playlist.m3u8" isLive />);
    const video = container.querySelector('video')!;
    const videoState = makeVideoMutable(video);

    const hls = fakeHlsModule.getLatest()!;
    act(() => {
      hls.emit('hlsManifestParsed', { levels: [] });
      video.dispatchEvent(new Event('playing'));
      video.dispatchEvent(new Event('stalled'));
    });

    // The first incident reaches only its soft rung.
    advance(hls, 2500);
    expect(videoState.currentTime).toBeCloseTo(0.1, 5);

    // Three ticks of real progress satisfy the sustained-health reset window.
    for (const currentTime of [5, 10, 15]) {
      videoState.currentTime = currentTime;
      advance(hls, 1000);
    }
    act(() => video.dispatchEvent(new Event('stalled')));

    // A later incident restarts at soft recovery rather than inheriting the prior budget.
    advance(hls, 2500);
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(videoState.currentTime).toBeCloseTo(15.1, 5);
  });
});

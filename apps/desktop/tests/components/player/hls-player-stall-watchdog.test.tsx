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

import { HlsPlayer } from '@/components/player/hls-player';

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

  it('escalates recovery in order when currentTime stops advancing', () => {
    const onError = vi.fn();
    const { container } = render(
      <HlsPlayer src="https://x.test/playlist.m3u8" isLive onError={onError} />
    );
    const video = container.querySelector('video')!;
    const videoState = makeVideoMutable(video);

    const hls = fakeHlsModule.getLatest()!;
    act(() => {
      hls.emit('hlsManifestParsed', { levels: [] });
    });

    // 8s of zero advance → rung 1: nudge currentTime += 0.1
    advance(hls, 8000);
    expect(videoState.currentTime).toBeCloseTo(0.1, 5);
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.recoverMediaError).not.toHaveBeenCalled();

    // 4s grace + 4s of stuck → rung 2: hls.startLoad(-1)
    advance(hls, 4000);
    expect(hls.startLoad).toHaveBeenCalledWith(-1);
    expect(hls.recoverMediaError).not.toHaveBeenCalled();

    // 4s grace + 4s stuck → rung 3: hls.recoverMediaError()
    advance(hls, 4000);
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    // 4s grace + 4s stuck → rung 4: fatal DECODER_STALL with shouldRefresh
    advance(hls, 4000);
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
    });

    advance(hls, 30000);
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.recoverMediaError).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('resets escalation when currentTime resumes advancing', () => {
    const { container } = render(<HlsPlayer src="https://x.test/playlist.m3u8" isLive />);
    const video = container.querySelector('video')!;
    const videoState = makeVideoMutable(video);

    const hls = fakeHlsModule.getLatest()!;
    act(() => {
      hls.emit('hlsManifestParsed', { levels: [] });
    });

    // Stuck → rung 1 nudge fires
    advance(hls, 8000);
    expect(videoState.currentTime).toBeCloseTo(0.1, 5);

    // Player resumes advancing across two ticks (each frame triggers the reset branch)
    videoState.currentTime = 5;
    advance(hls, 4000);
    videoState.currentTime = 10;
    advance(hls, 4000);

    // Stuck again — escalation must restart at rung 1 (nudge), so startLoad stays untouched.
    advance(hls, 8000);
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(videoState.currentTime).toBeCloseTo(10.1, 5);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRetainedViewportImageUrlsForTests,
  prewarmViewportImages,
  resetViewportImagePrewarmForTests,
  VIEWPORT_PREWARM_CONCURRENCY,
  VIEWPORT_PREWARM_LIMIT,
  VIEWPORT_PREWARM_RETAIN_LIMIT,
} from "@/lib/viewport-image-prewarm";

type LoadOutcome = "error" | "load" | "timeout";

const state = {
  active: 0,
  maxActive: 0,
  outcomes: [] as LoadOutcome[],
  sources: [] as string[],
};

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = "auto";
  fetchPriority = "auto";

  set src(value: string) {
    const outcome = state.outcomes[state.sources.length] ?? "load";
    state.sources.push(value);
    state.active++;
    state.maxActive = Math.max(state.maxActive, state.active);
    if (outcome === "timeout") return;
    queueMicrotask(() => {
      state.active--;
      if (outcome === "error") this.onerror?.();
      else this.onload?.();
    });
  }
}

beforeEach(() => {
  state.active = 0;
  state.maxActive = 0;
  state.outcomes = [];
  state.sources = [];
  resetViewportImagePrewarmForTests();
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Guards: snapshot image warming uses the same proxy URL contract, caps work to the first viewport batch, bounds concurrency, and deduplicates repeats.
// Guards: successful decoded images remain strongly reachable within a fixed memory cap, while failed or timed-out images are released.
describe("viewport image prewarm", () => {
  it("warms at most eight unique images with four concurrent requests", async () => {
    const urls = Array.from(
      { length: 12 },
      (_, index) => `https://files.kick.com/thumbnails/${index}.webp`
    );

    await prewarmViewportImages([...urls, urls[0]]);

    expect(state.sources).toHaveLength(VIEWPORT_PREWARM_LIMIT);
    expect(state.maxActive).toBeLessThanOrEqual(VIEWPORT_PREWARM_CONCURRENCY);
    expect(state.sources[0]).toMatch(/^kick-image:\/\/image\?u=/);

    await prewarmViewportImages(urls);
    expect(state.sources).toHaveLength(VIEWPORT_PREWARM_LIMIT);
  });

  it("retains successful images by their exact resolved URL within a fixed cap", async () => {
    const urls = Array.from(
      { length: VIEWPORT_PREWARM_RETAIN_LIMIT + VIEWPORT_PREWARM_LIMIT },
      (_, index) => `https://files.kick.com/thumbnails/retained-${index}.webp`
    );

    for (let index = 0; index < urls.length; index += VIEWPORT_PREWARM_LIMIT) {
      await prewarmViewportImages(urls.slice(index, index + VIEWPORT_PREWARM_LIMIT));
    }

    expect(getRetainedViewportImageUrlsForTests()).toEqual(
      state.sources.slice(-VIEWPORT_PREWARM_RETAIN_LIMIT)
    );
  });

  it("does not retain images that error or time out", async () => {
    vi.useFakeTimers();
    state.outcomes = ["load", "error", "timeout"];

    const warming = prewarmViewportImages([
      "https://files.kick.com/thumbnails/success.webp",
      "https://files.kick.com/thumbnails/error.webp",
      "https://files.kick.com/thumbnails/timeout.webp",
    ]);
    await vi.advanceTimersByTimeAsync(3000);
    await warming;

    expect(getRetainedViewportImageUrlsForTests()).toEqual([state.sources[0]]);
    vi.useRealTimers();
  });
});

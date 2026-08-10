import { describe, expect, it } from "vitest";

import {
  LivePlaybackStallController,
  type LivePlaybackSnapshot,
} from "@/components/player/live-playback-stall-controller";

const playableSnapshot = (overrides: Partial<LivePlaybackSnapshot> = {}): LivePlaybackSnapshot => ({
  currentTime: 10,
  paused: false,
  ended: false,
  seeking: false,
  hidden: false,
  online: true,
  readyState: 2,
  bufferedAheadSeconds: 0,
  adBlockHolding: false,
  videoFrameCallbacksSupported: false,
  lastPresentedFrameAt: null,
  ...overrides,
});

// Guards: recovery starts only after real playback has made progress and two signals corroborate a stall.
// Guards: buffered playback with fresh fragments still detects a silent decoder freeze when the browser emits no stall event.
// Guards: intentional pause, seek, end, offline, and hidden-window states never trigger recovery.
// Guards: ad-block holding is owned by the ad-block watchdog and never spends the stream-stall retry budget.
// Guards: one source generation gets a bounded soft -> hard -> fatal ladder and stale generations stay inert.
describe("LivePlaybackStallController", () => {
  it("does not arm during initial startup, even when waiting lasts beyond escalation", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 0);
    controller.noteWaiting(0);
    controller.noteFragmentLoaded(8_000);

    expect(
      controller.evaluate(
        8_000,
        playableSnapshot({ currentTime: 0, readyState: 4, bufferedAheadSeconds: 8 })
      )
    ).toBeNull();
  });

  it("arms after observed media progress even if playing was not emitted", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 0);

    expect(controller.evaluate(100, playableSnapshot({ currentTime: 1 }))).toBeNull();
    controller.noteWaiting(100);

    expect(controller.evaluate(2_600, playableSnapshot({ currentTime: 1 }))).toEqual(
      expect.objectContaining({ type: "start-load", stage: "soft" })
    );
  });

  it("escalates an input-starved stall at 2.5s, 5.5s, then once at 7.5s", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 10);
    controller.notePlaying(0, 10);
    controller.noteWaiting(0);

    expect(controller.evaluate(2_499, playableSnapshot())).toBeNull();
    expect(controller.evaluate(2_500, playableSnapshot())).toEqual({
      type: "start-load",
      stage: "soft",
      reason: "input-starved",
    });
    expect(controller.evaluate(5_500, playableSnapshot())).toEqual({
      type: "start-load",
      stage: "hard",
      reason: "input-starved",
    });
    expect(controller.evaluate(7_500, playableSnapshot())).toEqual({
      type: "fatal",
      stage: "exhausted",
      reason: "input-starved",
    });
    expect(controller.evaluate(20_000, playableSnapshot())).toBeNull();
  });

  it("uses nudge then media recovery only for a buffered decoder stall", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 10);
    controller.notePlaying(0, 10);
    controller.noteFragmentLoaded(0);
    controller.noteStalled(0);
    const buffered = playableSnapshot({ readyState: 4, bufferedAheadSeconds: 8 });

    expect(controller.evaluate(2_500, buffered)).toEqual({
      type: "nudge",
      stage: "soft",
      reason: "decoder-stall",
    });
    controller.noteFragmentLoaded(5_000);
    expect(controller.evaluate(5_500, buffered)).toEqual({
      type: "recover-media",
      stage: "hard",
      reason: "decoder-stall",
    });
  });

  it("bounds a silent buffered decoder freeze without waiting or stalled events", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 10);
    controller.notePlaying(0, 10);
    const buffered = playableSnapshot({ readyState: 4, bufferedAheadSeconds: 8 });

    controller.noteFragmentLoaded(0);
    expect(controller.evaluate(0, buffered)).toBeNull();
    controller.noteFragmentLoaded(2_499);
    expect(controller.evaluate(2_499, buffered)).toBeNull();
    controller.noteFragmentLoaded(2_500);
    expect(controller.evaluate(2_500, buffered)).toEqual({
      type: "nudge",
      stage: "soft",
      reason: "decoder-stall",
    });
    controller.noteRecoveryNudge(10.1);
    controller.noteFragmentLoaded(5_500);
    expect(controller.evaluate(5_500, { ...buffered, currentTime: 10.1 })).toEqual({
      type: "recover-media",
      stage: "hard",
      reason: "decoder-stall",
    });
    controller.noteFragmentLoaded(7_500);
    expect(controller.evaluate(7_500, { ...buffered, currentTime: 10.1 })).toEqual({
      type: "fatal",
      stage: "exhausted",
      reason: "decoder-stall",
    });
  });

  it("treats advancing audio time without a newly presented video frame as a decoder stall", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 10);
    controller.notePlaying(0, 10);
    controller.noteFragmentLoaded(0);
    controller.notePresentedFrame(0, 10);
    const blackFrame = playableSnapshot({
      readyState: 4,
      bufferedAheadSeconds: 8,
      videoFrameCallbacksSupported: true,
      lastPresentedFrameAt: 0,
    });

    controller.noteFragmentLoaded(2_500);
    expect(controller.evaluate(2_500, { ...blackFrame, currentTime: 12 })).toEqual({
      type: "nudge",
      stage: "soft",
      reason: "decoder-stall",
    });
    controller.noteFragmentLoaded(5_500);
    expect(controller.evaluate(5_500, { ...blackFrame, currentTime: 15 })).toEqual({
      type: "recover-media",
      stage: "hard",
      reason: "decoder-stall",
    });
    controller.noteFragmentLoaded(7_500);
    expect(controller.evaluate(7_500, { ...blackFrame, currentTime: 18 })).toEqual({
      type: "fatal",
      stage: "exhausted",
      reason: "decoder-stall",
    });
  });

  it("bounds startup when a parsed manifest never produces a fragment", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 0);
    controller.notePlay(0, 0);
    controller.noteManifestParsed(0);

    expect(controller.evaluate(3_000, playableSnapshot({ currentTime: 0 }))).toBeNull();
    expect(controller.evaluate(5_500, playableSnapshot({ currentTime: 0 }))).toEqual({
      type: "start-load",
      stage: "soft",
      reason: "input-starved",
    });
    expect(controller.evaluate(8_500, playableSnapshot({ currentTime: 0 }))).toEqual({
      type: "start-load",
      stage: "hard",
      reason: "input-starved",
    });
    expect(controller.evaluate(10_500, playableSnapshot({ currentTime: 0 }))).toEqual({
      type: "fatal",
      stage: "exhausted",
      reason: "input-starved",
    });
  });

  it("rebases the incident after returning from a hidden document", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 10);
    controller.notePlaying(0, 10);
    controller.noteWaiting(0);

    expect(controller.evaluate(2_000, playableSnapshot({ hidden: true }))).toBeNull();
    controller.noteVisibilityChange(10_000, 10);
    controller.noteWaiting(10_000);
    expect(controller.evaluate(12_499, playableSnapshot())).toBeNull();
    expect(controller.evaluate(12_500, playableSnapshot())).toEqual(
      expect.objectContaining({ type: "start-load", stage: "soft" })
    );
  });

  it("rebases stale frame timing after a long offline period before recovery resumes", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 10);
    controller.notePlaying(0, 10);
    controller.noteFragmentLoaded(0);
    controller.notePresentedFrame(0, 10);
    controller.noteWaiting(0);

    expect(
      controller.evaluate(
        20_000,
        playableSnapshot({
          online: false,
          videoFrameCallbacksSupported: true,
          lastPresentedFrameAt: 0,
        })
      )
    ).toBeNull();

    controller.noteConnectivityChange(20_000, 10);
    controller.noteWaiting(20_000);

    expect(
      controller.evaluate(
        20_001,
        playableSnapshot({ videoFrameCallbacksSupported: true, lastPresentedFrameAt: null })
      )
    ).toBeNull();
    expect(
      controller.evaluate(
        22_500,
        playableSnapshot({ videoFrameCallbacksSupported: true, lastPresentedFrameAt: null })
      )
    ).toEqual(expect.objectContaining({ type: "start-load", stage: "soft" }));
  });

  it("delegates a silent ad hold without spending the stream-stall retry budget", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 10);
    controller.notePlaying(0, 10);
    controller.noteFragmentLoaded(0);
    const held = playableSnapshot({
      readyState: 4,
      bufferedAheadSeconds: 8,
      adBlockHolding: true,
    });

    expect(controller.evaluate(2_500, held)).toBeNull();
    expect(controller.evaluate(3_001, held)).toBeNull();
    expect(controller.evaluate(5_501, held)).toBeNull();
    expect(controller.evaluate(8_501, held)).toBeNull();
    expect(controller.evaluate(30_000, held)).toBeNull();

    expect(controller.evaluate(30_001, playableSnapshot())).toBeNull();
    expect(controller.evaluate(32_500, playableSnapshot())).toBeNull();
    expect(controller.evaluate(32_501, playableSnapshot())).toEqual({
      type: "start-load",
      stage: "soft",
      reason: "input-starved",
    });
  });

  it.each([
    ["paused", { paused: true }],
    ["seeking", { seeking: true }],
    ["ended", { ended: true }],
    ["offline", { online: false }],
    ["hidden", { hidden: true }],
  ] as const)("suppresses recovery while %s", (_label, override) => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 10);
    controller.notePlaying(0, 10);
    controller.noteWaiting(0);
    controller.noteFragmentLoaded(8_000);

    expect(
      controller.evaluate(
        8_000,
        playableSnapshot({ readyState: 4, bufferedAheadSeconds: 8, ...override })
      )
    ).toBeNull();
  });

  it("grants a seek grace period after seeked", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 10);
    controller.notePlaying(0, 10);
    controller.noteSeeking(1_000);
    controller.noteSeeked(1_100, 40);
    controller.noteWaiting(1_100);

    expect(controller.evaluate(3_000, playableSnapshot({ currentTime: 40 }))).toBeNull();
    expect(controller.evaluate(3_600, playableSnapshot({ currentTime: 40 }))).toBeNull();
    expect(controller.evaluate(6_100, playableSnapshot({ currentTime: 40 }))).toEqual(
      expect.objectContaining({ type: "start-load", stage: "soft" })
    );
  });

  it("cancels a pending incident when the source generation changes", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 10);
    controller.notePlaying(0, 10);
    controller.noteWaiting(0);
    controller.resetSource(2, 2_000, 0);
    controller.noteFragmentLoaded(8_000);

    expect(
      controller.evaluate(
        8_000,
        playableSnapshot({ currentTime: 0, readyState: 4, bufferedAheadSeconds: 8 })
      )
    ).toBeNull();
  });

  it("resets the exhausted budget only after sustained healthy progress", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 10);
    controller.notePlaying(0, 10);
    controller.noteWaiting(0);
    controller.evaluate(2_500, playableSnapshot());
    controller.evaluate(5_500, playableSnapshot());
    controller.evaluate(7_500, playableSnapshot());

    expect(controller.evaluate(8_000, playableSnapshot({ currentTime: 11 }))).toBeNull();
    expect(controller.evaluate(9_000, playableSnapshot({ currentTime: 12 }))).toBeNull();
    expect(controller.evaluate(10_100, playableSnapshot({ currentTime: 13 }))).toBeNull();
    controller.noteWaiting(10_100);

    expect(controller.evaluate(12_600, playableSnapshot({ currentTime: 13 }))).toEqual(
      expect.objectContaining({ type: "start-load", stage: "soft" })
    );
  });

  it("does not rearm an exhausted source from a playing event without progress", () => {
    const controller = new LivePlaybackStallController();
    controller.resetSource(1, 0, 10);
    controller.notePlaying(0, 10);
    controller.noteWaiting(0);
    controller.evaluate(2_500, playableSnapshot());
    controller.evaluate(5_500, playableSnapshot());
    controller.evaluate(7_500, playableSnapshot());

    controller.notePlaying(8_000, 10);
    controller.noteWaiting(8_000);

    expect(controller.evaluate(20_000, playableSnapshot())).toBeNull();
  });
});

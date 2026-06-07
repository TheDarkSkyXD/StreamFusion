import { beforeEach, describe, expect, it } from "vitest";

import type { PipStreamInfo } from "@/store/pip-store";
import { usePipStore } from "@/store/pip-store";

function makeStream(overrides: Partial<PipStreamInfo> = {}): PipStreamInfo {
  return {
    platform: "kick",
    channelName: "xqc",
    channelDisplayName: "xQc",
    streamUrl: "https://player.kick.com/xqc",
    ...overrides,
  };
}

function resetStore() {
  usePipStore.setState({
    currentStream: null,
    isPipActive: false,
    isOnStreamPage: false,
  });
}

beforeEach(() => resetStore());

describe("pip-store setCurrentStream", () => {
  it("sets the current stream", () => {
    usePipStore.getState().setCurrentStream(makeStream());
    expect(usePipStore.getState().currentStream).toMatchObject({ channelName: "xqc" });
  });

  it("deactivates PiP when switching to a different stream", () => {
    usePipStore.getState().setCurrentStream(makeStream());
    usePipStore.setState({ isPipActive: true });
    usePipStore.getState().setCurrentStream(makeStream({ channelName: "adin" }));
    expect(usePipStore.getState().isPipActive).toBe(false);
    expect(usePipStore.getState().isOnStreamPage).toBe(true);
  });

  it("does not deactivate PiP when setting the same stream again", () => {
    usePipStore.getState().setCurrentStream(makeStream());
    usePipStore.setState({ isPipActive: true });
    usePipStore.getState().setCurrentStream(makeStream());
    expect(usePipStore.getState().isPipActive).toBe(true);
  });

  it("clears the stream when null is passed", () => {
    usePipStore.getState().setCurrentStream(makeStream());
    usePipStore.getState().setCurrentStream(null);
    expect(usePipStore.getState().currentStream).toBeNull();
  });
});

describe("pip-store setIsOnStreamPage", () => {
  it("activates PiP when leaving the stream page with an active stream", () => {
    usePipStore.getState().setCurrentStream(makeStream());
    usePipStore.getState().setIsOnStreamPage(true);
    usePipStore.getState().setIsOnStreamPage(false);
    expect(usePipStore.getState().isPipActive).toBe(true);
  });

  it("does not activate PiP when leaving the stream page without a stream", () => {
    usePipStore.getState().setIsOnStreamPage(true);
    usePipStore.getState().setIsOnStreamPage(false);
    expect(usePipStore.getState().isPipActive).toBe(false);
  });

  it("deactivates PiP when navigating to the stream page", () => {
    usePipStore.getState().setCurrentStream(makeStream());
    usePipStore.setState({ isPipActive: true });
    usePipStore.getState().setIsOnStreamPage(true);
    expect(usePipStore.getState().isPipActive).toBe(false);
  });
});

describe("pip-store activatePip", () => {
  it("activates PiP when a stream exists and not on stream page", () => {
    usePipStore.getState().setCurrentStream(makeStream());
    usePipStore.getState().activatePip();
    expect(usePipStore.getState().isPipActive).toBe(true);
  });

  it("does not activate PiP when no stream is set", () => {
    usePipStore.getState().activatePip();
    expect(usePipStore.getState().isPipActive).toBe(false);
  });

  it("does not activate PiP when on the stream page", () => {
    usePipStore.getState().setCurrentStream(makeStream());
    usePipStore.setState({ isOnStreamPage: true });
    usePipStore.getState().activatePip();
    expect(usePipStore.getState().isPipActive).toBe(false);
  });
});

describe("pip-store deactivatePip", () => {
  it("sets isPipActive to false", () => {
    usePipStore.setState({ isPipActive: true });
    usePipStore.getState().deactivatePip();
    expect(usePipStore.getState().isPipActive).toBe(false);
  });
});

describe("pip-store closePip", () => {
  it("clears the stream and deactivates PiP", () => {
    usePipStore.getState().setCurrentStream(makeStream());
    usePipStore.setState({ isPipActive: true });
    usePipStore.getState().closePip();
    expect(usePipStore.getState().currentStream).toBeNull();
    expect(usePipStore.getState().isPipActive).toBe(false);
  });
});

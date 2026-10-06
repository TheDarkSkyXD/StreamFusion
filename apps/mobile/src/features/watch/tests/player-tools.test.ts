// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PlayerTools } from "../components/player-tools";
import type { PlaybackObservationResult } from "../capabilities/watch";

vi.mock("react-native", () => ({ Text: "span", View: "div" }));
vi.mock("lucide-react-native", () => ({ Activity: "i", Timer: "i" }));
vi.mock("@mobile/design/choice-group", () => ({ MobileChoiceGroup: "div" }));
vi.mock("@mobile/design/list-row", () => ({
  MobileListRow: ({
    title,
    description,
  }: {
    title: string;
    description: string;
  }) => createElement("p", null, title + " " + description),
}));

it("reads the selected player, polls without overlap, and releases its timer on unmount", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  let complete: ((result: PlaybackObservationResult) => void) | undefined;
  const read = vi.fn(
    () =>
      new Promise<PlaybackObservationResult>((resolve) => {
        complete = resolve;
      }),
  );
  try {
    await act(async () =>
      root.render(
        createElement(PlayerTools, {
          session: { readPlaybackObservation: read },
          sessionId: "selected",
          recorded: false,
          tool: "stats",
          onSelectTool: () => undefined,
        }),
      ),
    );
    expect(host.textContent).toContain("Reading current player");
    await act(async () => vi.advanceTimersByTime(5000));
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () =>
      complete?.({
        kind: "observed",
        observation: {
          sessionId: "selected",
          speed: 1,
          bufferedMs: 3500,
          width: 1280,
          height: 720,
          frameRate: 60,
          bitrate: 3000000,
          codec: "avc1",
          droppedFrames: 1,
          renderedFrames: 120,
        },
      }),
    );
    expect(host.textContent).toContain("Resolution 1280 \u00d7 720");
    expect(host.textContent).toContain("Bitrate 3.00 Mbps");
    await act(async () => vi.advanceTimersByTime(1000));
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    await act(async () =>
      complete?.({
        kind: "unavailable",
        failure: { code: "INVOCATION_FAILED", detail: "Late read" },
      }),
    );
    vi.advanceTimersByTime(10000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

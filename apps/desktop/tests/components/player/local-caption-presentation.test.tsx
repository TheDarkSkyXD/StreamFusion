import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CaptionOverlay } from "@/features/playback/components/player/caption-overlay";
import {
  advanceLocalCaptionCue,
  applyLocalCaptionResult,
} from "@/features/playback/components/player/local-caption-presentation";
import type { TimedTextCue } from "@/features/playback/components/player/types";
import type { LocalCaptionResult } from "@shared/local-caption-types";

function result(overrides: Partial<LocalCaptionResult> = {}): LocalCaptionResult {
  return {
    type: "result",
    sessionId: "twitch:talker",
    generation: 7,
    sequence: 1,
    mediaTime: 10.2,
    cueId: "twitch:talker:7:1",
    revision: 1,
    text: "hello world",
    isFinal: false,
    words: [
      { text: "hello", startTime: 10, endTime: 10.4 },
      { text: "world", startTime: 10.4, endTime: 10.8 },
    ],
    ...overrides,
  };
}

// Guards: partial recognizer revisions replace one stable local cue and stale or equal revisions cannot regress its text.
// Guards: mapped word timing uses the default accent or a caller's platform accent while completed words stay full contrast.
// Guards: retrospective live partials keep their latest recognized word active after its measured interval ends.
// Guards: invalid local timing uses provisional phrase fallback without inventing a final active word.
// Guards: visible local partials stay out of the accessibility tree while each final phrase owns one polite announcement.
// Guards: platform-authored cues retain their plain overlay rendering.
describe("local caption presentation", () => {
  it("keeps legacy HMR results visible without dereferencing a null current cue", () => {
    const legacy = {
      ...result(),
      cueId: undefined,
      revision: undefined,
    } as unknown as LocalCaptionResult;

    expect(() => applyLocalCaptionResult(null, legacy)).not.toThrow();
    expect(applyLocalCaptionResult(null, legacy)).toMatchObject({
      text: "hello world",
      localLive: {
        cueId: "legacy:twitch:talker:7",
        revision: 1,
      },
    });
  });

  it("normalizes empty cue IDs and unsafe revisions before comparing revisions", () => {
    const first = applyLocalCaptionResult(null, {
      ...result(),
      cueId: " ",
      revision: 0,
    } as unknown as LocalCaptionResult);
    const advanced = applyLocalCaptionResult(first, {
      ...result(),
      cueId: "",
      revision: Number.MAX_SAFE_INTEGER + 1,
      sequence: 2,
      text: "legacy revision advanced",
    } as unknown as LocalCaptionResult);
    const equal = applyLocalCaptionResult(advanced, {
      ...result(),
      cueId: undefined,
      revision: undefined,
      sequence: 2,
      text: "equal legacy revision must lose",
    } as unknown as LocalCaptionResult);

    expect(advanced).toMatchObject({
      text: "legacy revision advanced",
      localLive: { cueId: "legacy:twitch:talker:7", revision: 2 },
    });
    expect(equal).toBe(advanced);
  });

  it("replaces one stable cue only when its revision advances", () => {
    const first = applyLocalCaptionResult(null, result());
    const advanced = applyLocalCaptionResult(
      first,
      result({ sequence: 2, revision: 2, text: "hello world again" })
    );
    const equal = applyLocalCaptionResult(
      advanced,
      result({ sequence: 3, revision: 2, text: "equal must lose" })
    );
    const stale = applyLocalCaptionResult(
      advanced,
      result({ sequence: 4, revision: 1, text: "stale must lose" })
    );

    expect(advanced).toMatchObject({
      text: "hello world again",
      localLive: { cueId: "twitch:talker:7:1", revision: 2 },
    });
    expect(equal).toBe(advanced);
    expect(stale).toBe(advanced);
  });

  it("highlights the mapped active word without dimming completed words", () => {
    const cue = applyLocalCaptionResult(null, result());
    expect(cue.localLive).toMatchObject({ activeWordIndex: 0, fallbackHighlight: false });

    render(<CaptionOverlay cues={[cue]} />);

    const active = screen.getByTestId("local-caption-active-word");
    expect(active).toHaveTextContent("hello");
    expect(active).toHaveStyle({ color: "#dc143c", textDecorationLine: "underline" });
    expect(screen.getByTestId("local-caption-word-1")).toHaveStyle({ color: "#fff" });

    const boundary = applyLocalCaptionResult(null, result({ mediaTime: 10.4 }));
    expect(boundary.localLive?.activeWordIndex).toBe(1);

    const finalWithinRealInterval = applyLocalCaptionResult(null, result({ isFinal: true }));
    expect(finalWithinRealInterval.localLive).toMatchObject({
      activeWordIndex: 0,
      fallbackHighlight: false,
      wordTimingValid: true,
    });
    expect(advanceLocalCaptionCue(finalWithinRealInterval, 10.5).localLive?.activeWordIndex).toBe(
      1
    );
    expect(
      advanceLocalCaptionCue(finalWithinRealInterval, 11).localLive?.activeWordIndex
    ).toBeNull();
  });
  it("uses a caller-provided highlight color for local active words", () => {
    const cue = applyLocalCaptionResult(null, result());

    render(<CaptionOverlay cues={[cue]} localHighlightColor="#bf94ff" />);

    expect(screen.getByTestId("local-caption-active-word")).toHaveStyle({ color: "#bf94ff" });
    expect(screen.getByTestId("local-caption-word-1")).toHaveStyle({ color: "#fff" });
  });
  it("uses a caller-provided highlight color for the provisional phrase fallback", () => {
    const cue = applyLocalCaptionResult(null, result({ words: [] }));

    render(<CaptionOverlay cues={[cue]} localHighlightColor="#bf94ff" />);

    expect(screen.getByTestId("local-caption-active-phrase")).toHaveStyle({ color: "#bf94ff" });
  });
  it("keeps the latest word active when a provisional result arrives at its interval boundary", () => {
    const cue = applyLocalCaptionResult(null, result({ mediaTime: 10.8 }));

    expect(cue.localLive).toMatchObject({
      activeWordIndex: 1,
      fallbackHighlight: false,
      wordTimingValid: true,
    });
    expect(advanceLocalCaptionCue(cue, 11.2).localLive?.activeWordIndex).toBe(1);

    const finalized = applyLocalCaptionResult(null, result({ mediaTime: 10.8, isFinal: true }));
    expect(finalized.localLive?.activeWordIndex).toBeNull();
  });
  it.each([
    ["missing", []],
    ["malformed", [{ text: "hello world", startTime: Number.NaN, endTime: 10.4 }]],
    ["zero-duration", [{ text: "hello world", startTime: 10.2, endTime: 10.2 }]],
    [
      "non-monotonic",
      [
        { text: "hello", startTime: 10.3, endTime: 10.5 },
        { text: "world", startTime: 10.1, endTime: 10.6 },
      ],
    ],
    [
      "out-of-range",
      [
        { text: "hello", startTime: 200, endTime: 201 },
        { text: "world", startTime: 201, endTime: 202 },
      ],
    ],
    ["unalignable", [{ text: "different words", startTime: 10, endTime: 10.4 }]],
  ])("falls back for %s provisional timing", (_name, words) => {
    const cue = applyLocalCaptionResult(null, result({ words }));
    expect(cue.localLive).toMatchObject({
      activeWordIndex: null,
      fallbackHighlight: true,
      wordTimingValid: false,
    });
    expect(Number.isFinite(cue.startTime)).toBe(true);
    expect(Number.isFinite(cue.endTime)).toBe(true);
    expect(cue.startTime).toBeLessThanOrEqual(10.2);
    expect(cue.endTime).toBeGreaterThan(10.2);

    const view = render(<CaptionOverlay cues={[cue]} />);
    expect(screen.getByTestId("local-caption-active-phrase")).toHaveTextContent("hello world");
    view.unmount();
  });

  it("shows finalized fallback text without inventing an active word", () => {
    const cue = applyLocalCaptionResult(null, result({ isFinal: true, words: [] }));
    expect(cue.localLive).toMatchObject({
      activeWordIndex: null,
      fallbackHighlight: false,
      wordTimingValid: false,
    });

    render(<CaptionOverlay cues={[cue]} />);
    expect(
      screen.getByText("hello world", { selector: "[data-caption-layout='fallback']" })
    ).toBeVisible();
    expect(screen.queryByTestId("local-caption-active-word")).not.toBeInTheDocument();
    expect(screen.queryByTestId("local-caption-active-phrase")).not.toBeInTheDocument();
  });
  it("announces final local text once without exposing visible partial spans", () => {
    const partial = applyLocalCaptionResult(null, result());
    const view = render(<CaptionOverlay cues={[partial]} />);
    expect(
      screen.getByTestId("local-caption-active-word").closest("[aria-hidden='true']")
    ).not.toBeNull();
    expect(screen.queryByLabelText("Final caption announcement")).not.toBeInTheDocument();
    expect(screen.getByTestId("local-caption-active-word").style.animation).toBe("");
    expect(screen.getByTestId("local-caption-active-word").style.transition).toBe("");

    const final = applyLocalCaptionResult(
      partial,
      result({ sequence: 2, revision: 2, isFinal: true })
    );
    view.rerender(<CaptionOverlay cues={[final]} />);

    const announcement = screen.getByLabelText("Final caption announcement");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement).toHaveAttribute("aria-atomic", "true");
    expect(announcement).toHaveTextContent("hello world");
    expect(screen.getAllByLabelText("Final caption announcement")).toHaveLength(1);
  });
  it("renders a platform-authored cue as unchanged plain text", () => {
    const platformCue: TimedTextCue = {
      text: "Platform caption",
      startTime: 2,
      endTime: 5,
    };
    render(<CaptionOverlay cues={[platformCue]} localHighlightColor="#bf94ff" />);

    const overlay = screen.getByRole("status", { name: "Captions" });
    expect(overlay).toHaveTextContent("Platform caption");
    expect(screen.getByText("Platform caption")).not.toHaveAttribute("aria-hidden");
    expect(screen.getByText("Platform caption")).not.toHaveStyle({ color: "#bf94ff" });
    expect(screen.queryByTestId("local-caption-active-word")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Final caption announcement")).not.toBeInTheDocument();
  });
});

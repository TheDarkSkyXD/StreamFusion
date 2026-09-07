import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  KickProgressBar,
  type KickProgressBarHandle,
} from "@/features/playback/components/player/kick/kick-progress-bar";
import { TwitchProgressBar } from "@/features/playback/components/player/twitch/twitch-progress-bar";

function setProgressBarBounds(element: HTMLDivElement) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left: 0,
    width: 100,
    top: 0,
    height: 20,
    right: 100,
    bottom: 20,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
}

// Guards: Twitch VOD and clip scrubbing previews whole seconds and commits only once on pointer release
// Guards: Kick VOD and clip scrubbing matches Twitch whole-second preview and pointer-release behavior
// Guards: Kick's imperative live-rewind timeline keeps its latest duration and seekable range while scrubbing
describe("platform progress bars", () => {
  it("gives Twitch pointer scrubbing the shared whole-second commit behavior", () => {
    const onSeek = vi.fn();
    const onSeekHover = vi.fn();
    const { container } = render(
      <TwitchProgressBar currentTime={0} duration={101} onSeek={onSeek} onSeekHover={onSeekHover} />
    );
    const progressBar = container.firstChild as HTMLDivElement;
    setProgressBarBounds(progressBar);

    fireEvent.mouseEnter(progressBar, { clientX: 30 });
    expect(onSeekHover).toHaveBeenLastCalledWith(30);
    expect(screen.getByText("00:30")).toBeInTheDocument();

    fireEvent.pointerDown(progressBar, { pointerId: 3, clientX: 20 });
    fireEvent.mouseLeave(progressBar);
    fireEvent.pointerMove(progressBar, { pointerId: 3, clientX: 60 });

    expect(onSeek).not.toHaveBeenCalled();
    expect(onSeekHover).toHaveBeenLastCalledWith(61);
    expect(screen.getByText("01:01")).toBeInTheDocument();

    fireEvent.pointerUp(progressBar, { pointerId: 3, clientX: 60 });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(61);
  });

  it("gives Kick pointer scrubbing the shared whole-second commit behavior", () => {
    const onSeek = vi.fn();
    const onSeekHover = vi.fn();
    const { container } = render(
      <KickProgressBar currentTime={0} duration={101} onSeek={onSeek} onSeekHover={onSeekHover} />
    );
    const progressBar = container.firstChild as HTMLDivElement;
    setProgressBarBounds(progressBar);

    fireEvent.mouseEnter(progressBar, { clientX: 30 });
    expect(onSeekHover).toHaveBeenLastCalledWith(30);
    expect(screen.getByText("00:30")).toBeInTheDocument();

    fireEvent.pointerDown(progressBar, { pointerId: 4, clientX: 20 });
    fireEvent.mouseLeave(progressBar);
    fireEvent.pointerMove(progressBar, { pointerId: 4, clientX: 60 });

    expect(onSeek).not.toHaveBeenCalled();
    expect(onSeekHover).toHaveBeenLastCalledWith(61);
    expect(screen.getByText("01:01")).toBeInTheDocument();

    fireEvent.pointerUp(progressBar, { pointerId: 4, clientX: 60 });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(61);
  });

  it("uses Kick timeline values supplied through the imperative update path", () => {
    const progressBarRef = createRef<KickProgressBarHandle>();
    const onSeek = vi.fn();
    const onSeekHover = vi.fn();
    const { container } = render(
      <KickProgressBar ref={progressBarRef} onSeek={onSeek} onSeekHover={onSeekHover} />
    );
    const progressBar = container.firstChild as HTMLDivElement;
    setProgressBarBounds(progressBar);
    progressBarRef.current?.update({
      currentTime: 60,
      duration: 100,
      seekableRange: { start: 20, end: 80 },
    });

    fireEvent.mouseEnter(progressBar, { clientX: 90 });
    fireEvent.click(progressBar, { clientX: 90 });

    expect(onSeekHover).toHaveBeenLastCalledWith(80);
    expect(onSeek).toHaveBeenCalledWith(80);
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaptionErrorNotice } from "@/components/player/caption-error-notice";
import { CaptionOverlay } from "@/components/player/caption-overlay";
import { useTimedText } from "@/components/player/hooks/use-timed-text";
import { DEFAULT_USER_PREFERENCES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

class FakeHls {
  subtitleTracks: Array<{
    name: string;
    lang?: string;
    groupId?: string;
    url?: string;
    default?: boolean;
  }> = [{ name: "English", lang: "en", groupId: "subs", url: "/en.m3u8", default: false }];
  subtitleTrack = -1;
  private listeners = new Map<string, Set<(event: string, data: unknown) => void>>();

  on(event: string, listener: (event: string, data: unknown) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: (event: string, data: unknown) => void) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, data: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(event, data);
  }
}

interface FakeTextTrack {
  mode: TextTrackMode;
  cues: TextTrackCue[];
  addCue: ReturnType<typeof vi.fn>;
  removeCue: ReturnType<typeof vi.fn>;
}

function installNativeTrack(video: HTMLVideoElement): FakeTextTrack {
  const track: FakeTextTrack = {
    mode: "disabled",
    cues: [],
    addCue: vi.fn((cue: TextTrackCue) => track.cues.push(cue)),
    removeCue: vi.fn((cue: TextTrackCue) => {
      track.cues = track.cues.filter((candidate) => candidate !== cue);
    }),
  };
  video.addTextTrack = vi.fn(() => track as unknown as TextTrack);
  return track;
}

function CaptionHarness({ hls, video }: { hls: FakeHls; video: HTMLVideoElement }) {
  const captions = useTimedText(hls as never, "vod:resilience", video);
  return (
    <>
      {captions.tracks.map((track) => (
        <button key={track.key} type="button" onClick={() => captions.selectTrack(track.key)}>
          Select {track.label}
        </button>
      ))}
      <button type="button" onClick={() => captions.selectTrack(null)}>
        Disable captions
      </button>
      <output aria-label="Selected caption track">{captions.selectedTrackKey ?? "off"}</output>
      <CaptionOverlay cues={captions.activeCues} />
      <CaptionErrorNotice error={captions.error} onRetry={captions.retry} />
    </>
  );
}

// Guards: native Picture-in-Picture receives the selected captions while the in-player overlay is hidden.
// Guards: disabling or replacing captions clears stale native Picture-in-Picture cues.
// Guards: failed caption tracks stop offering a dead Retry after the track disappears.
// Guards: repeated Picture-in-Picture language changes reuse one bounded native text track.
describe("caption resilience", () => {
  beforeEach(() => {
    useAuthStore.setState({
      preferences: DEFAULT_USER_PREFERENCES,
      updatePreferences: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("moves the selected cues to Chromium's native caption path on PiP entry", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    const nativeTrack = installNativeTrack(video);
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "Native caption", startTime: 1, endTime: 4 }],
      });
    });
    expect(screen.getByText("Native caption")).toBeInTheDocument();

    act(() => video.dispatchEvent(new Event("enterpictureinpicture")));

    expect(screen.queryByRole("status", { name: "Captions" })).not.toBeInTheDocument();
    expect(nativeTrack.mode).toBe("showing");
    expect(nativeTrack.addCue).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Native caption", startTime: 1, endTime: 4 })
    );
  });

  it("restores only current custom cues and disables the native track on PiP exit", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    const nativeTrack = installNativeTrack(video);
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [
          { text: "Expired in PiP", startTime: 1, endTime: 3 },
          { text: "Still current", startTime: 1, endTime: 8 },
        ],
      });
      video.dispatchEvent(new Event("enterpictureinpicture"));
    });

    video.currentTime = 4;
    act(() => video.dispatchEvent(new Event("leavepictureinpicture")));

    expect(nativeTrack.mode).toBe("disabled");
    expect(nativeTrack.cues).toHaveLength(0);
    expect(screen.queryByText("Expired in PiP")).not.toBeInTheDocument();
    expect(screen.getAllByText("Still current")).toHaveLength(1);
  });

  it("turns captions off and offers a non-blocking Retry when the selected track fails", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    const pause = vi.spyOn(video, "pause").mockImplementation(() => undefined);
    render(<CaptionHarness hls={hls} video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    expect(hls.subtitleTrack).toBe(0);

    act(() => {
      hls.emit("hlsError", {
        details: "subtitleTrackLoadError",
        fatal: false,
        context: { id: 0, groupId: "subs" },
      });
    });

    expect(hls.subtitleTrack).toBe(-1);
    expect(screen.getByLabelText("Selected caption track")).toHaveTextContent("off");
    expect(screen.getByRole("status", { name: "Caption error" })).toHaveTextContent(
      "English captions could not be loaded"
    );
    expect(screen.getByRole("button", { name: "Retry captions" })).toBeInTheDocument();
    expect(pause).not.toHaveBeenCalled();
  });

  it("retries the failed selection in place and resumes its cues", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsError", {
        details: "subtitleTrackLoadTimeOut",
        fatal: false,
        context: { id: 0, groupId: "subs" },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry captions" }));

    expect(hls.subtitleTrack).toBe(0);
    expect(screen.queryByRole("status", { name: "Caption error" })).not.toBeInTheDocument();

    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "Recovered caption", startTime: 1, endTime: 4 }],
      });
    });
    expect(screen.getByText("Recovered caption")).toBeInTheDocument();
  });

  it("removes an inert Retry when its failed track disappears", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    render(<CaptionHarness hls={hls} video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsError", {
        details: "subtitleTrackLoadError",
        fatal: false,
        context: { id: 0, groupId: "subs" },
      });
    });
    expect(screen.getByRole("button", { name: "Retry captions" })).toBeInTheDocument();

    hls.subtitleTracks = [];
    act(() => hls.emit("hlsSubtitleTracksCleared", {}));

    expect(screen.queryByRole("button", { name: "Retry captions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Caption error" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Selected caption track")).toHaveTextContent("off");
  });

  it("does not auto-restore a failed track when an enabled preference update arrives", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    render(<CaptionHarness hls={hls} video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsError", {
        details: "subtitleTrackLoadError",
        fatal: false,
        context: { id: 0, groupId: "subs" },
      });
      useAuthStore.setState({
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          captions: {
            ...DEFAULT_USER_PREFERENCES.captions,
            enabled: true,
            preferredLanguage: "en",
          },
        },
      });
    });

    expect(hls.subtitleTrack).toBe(-1);
    expect(screen.getByRole("button", { name: "Retry captions" })).toBeInTheDocument();
  });

  it("clears Chromium's native cues when captions are turned Off during PiP", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    const nativeTrack = installNativeTrack(video);
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "Must disappear", startTime: 1, endTime: 4 }],
      });
      video.dispatchEvent(new Event("enterpictureinpicture"));
    });
    expect(nativeTrack.mode).toBe("showing");

    fireEvent.click(screen.getByRole("button", { name: "Disable captions" }));

    expect(nativeTrack.mode).toBe("disabled");
    expect(nativeTrack.cues).toHaveLength(0);
  });

  it("clears Chromium's native cues when the selected track disappears during PiP", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    const nativeTrack = installNativeTrack(video);
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "Removed track caption", startTime: 1, endTime: 4 }],
      });
      video.dispatchEvent(new Event("enterpictureinpicture"));
    });
    expect(nativeTrack.cues).toHaveLength(1);

    hls.subtitleTracks = [];
    act(() => hls.emit("hlsSubtitleTracksCleared", {}));

    expect(nativeTrack.mode).toBe("disabled");
    expect(nativeTrack.cues).toHaveLength(0);
    expect(screen.getByLabelText("Selected caption track")).toHaveTextContent("off");
  });

  it("clears old native cues when the selected rendition moves to a new cue identity", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    const nativeTrack = installNativeTrack(video);
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "Old cue identity", startTime: 1, endTime: 4 }],
      });
      video.dispatchEvent(new Event("enterpictureinpicture"));
    });
    expect(nativeTrack.cues).toHaveLength(1);

    hls.subtitleTracks = [
      { name: "EspaÃ±ol", lang: "es", groupId: "subs", url: "/es.m3u8", default: false },
      { name: "English", lang: "en", groupId: "subs", url: "/en.m3u8", default: false },
    ];
    act(() => hls.emit("hlsSubtitleTracksUpdated", {}));

    expect(hls.subtitleTrack).toBe(1);
    expect(nativeTrack.mode).toBe("disabled");
    expect(nativeTrack.cues).toHaveLength(0);
  });

  it("clears native cues when captions are disabled globally during PiP", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    const nativeTrack = installNativeTrack(video);
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      useAuthStore.setState({
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          captions: { ...DEFAULT_USER_PREFERENCES.captions, enabled: true },
        },
      });
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "Globally disabled", startTime: 1, endTime: 4 }],
      });
      video.dispatchEvent(new Event("enterpictureinpicture"));
    });
    expect(nativeTrack.cues).toHaveLength(1);

    act(() => {
      useAuthStore.setState({
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          captions: { ...DEFAULT_USER_PREFERENCES.captions, enabled: false },
        },
      });
    });

    expect(nativeTrack.mode).toBe("disabled");
    expect(nativeTrack.cues).toHaveLength(0);
    expect(screen.getByLabelText("Selected caption track")).toHaveTextContent("off");
  });

  it("reuses one native text track while switching A to B to A during PiP", () => {
    const hls = new FakeHls();
    hls.subtitleTracks.push({
      name: "EspaÃ±ol",
      lang: "es",
      groupId: "subs",
      url: "/es.m3u8",
      default: false,
    });
    const video = document.createElement("video");
    const nativeTrack = installNativeTrack(video);
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "English A", startTime: 1, endTime: 4 }],
      });
      video.dispatchEvent(new Event("enterpictureinpicture"));
    });

    fireEvent.click(screen.getByRole("button", { name: "Select EspaÃ±ol" }));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles1",
        cues: [{ text: "EspaÃ±ol B", startTime: 1, endTime: 4 }],
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "English A again", startTime: 1, endTime: 4 }],
      });
    });

    expect(video.addTextTrack).toHaveBeenCalledTimes(1);
    expect(nativeTrack.mode).toBe("showing");
    expect(nativeTrack.cues).toEqual([
      expect.objectContaining({ text: "English A again", startTime: 1, endTime: 4 }),
    ]);
  });
});

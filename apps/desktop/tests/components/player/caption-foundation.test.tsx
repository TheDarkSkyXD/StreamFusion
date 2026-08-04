import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaptionOverlay } from "@/components/player/caption-overlay";
import { useTimedText } from "@/components/player/hooks/use-timed-text";
import { KickLivePlayerControls } from "@/components/player/kick/kick-live-player-controls";
import { KickVodPlayerControls } from "@/components/player/kick/kick-vod-player-controls";
import { SettingsMenu } from "@/components/player/settings-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_USER_PREFERENCES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

const originalUpdatePreferences = useAuthStore.getState().updatePreferences;

beforeEach(() => {
  useAuthStore.setState({
    preferences: { ...DEFAULT_USER_PREFERENCES },
    updatePreferences: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ preferences: null, updatePreferences: originalUpdatePreferences });
});

const baseProps = {
  qualities: [],
  currentQualityId: "auto",
  onQualityChange: vi.fn(),
};

function openSettings(props: React.ComponentProps<typeof SettingsMenu>) {
  render(
    <TooltipProvider>
      <SettingsMenu {...props} />
    </TooltipProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
}

class FakeHls {
  config = {
    captionsTextTrack1LanguageCode: "en",
    captionsTextTrack2LanguageCode: "es",
    captionsTextTrack3LanguageCode: "",
    captionsTextTrack4LanguageCode: "",
  };
  subtitleTracks: Array<{
    name: string;
    lang?: string;
    groupId?: string;
    url?: string;
    default?: boolean;
    attrs?: Record<string, string>;
  }> = [{ name: "English", lang: "en", groupId: "subs", url: "/en.m3u8" }];
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

function CaptionHarness({
  hls,
  mediaKey,
  video,
}: {
  hls: FakeHls;
  mediaKey: string;
  video: HTMLVideoElement;
}) {
  const captions = useTimedText(hls as never, mediaKey, video);
  return (
    <>
      <output aria-label="Track count">{captions.tracks.length}</output>
      <output aria-label="Track labels">
        {captions.tracks.map((track) => track.label).join(",")}
      </output>
      <output aria-label="Selected track">{captions.selectedTrackKey ?? "off"}</output>
      {captions.tracks.map((track) => (
        <button key={track.key} type="button" onClick={() => captions.selectTrack(track.key)}>
          Select {track.label}
        </button>
      ))}
      <button type="button" onClick={() => captions.selectTrack(null)}>
        Disable captions
      </button>
      <CaptionOverlay cues={captions.activeCues} />
    </>
  );
}

// Guards: live players always offer Off and keyless Local live captions even without platform tracks.
describe("caption foundation", () => {
  it("discovers named WebVTT tracks without language metadata and non-native CEA captions", () => {
    const hls = new FakeHls();
    hls.subtitleTracks = [{ name: "Commentary", groupId: "subs", url: "/commentary.m3u8" }];
    const video = document.createElement("video");
    render(<CaptionHarness hls={hls} mediaKey="live:captions" video={video} />);

    expect(screen.getByLabelText("Track labels")).toHaveTextContent("Commentary");

    act(() => {
      hls.emit("hlsNonNativeTextTracksFound", {
        tracks: [
          {
            _id: "textTrack1",
            label: "English CC",
            kind: "captions",
            default: false,
          },
        ],
      });
    });

    expect(screen.getByLabelText("Track labels")).toHaveTextContent("Commentary,English CC");
  });

  it("selects a discovered CEA service and renders only that service's cues", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} mediaKey="live:cea" video={video} />);

    act(() => {
      hls.emit("hlsNonNativeTextTracksFound", {
        tracks: [{ _id: "textTrack1", label: "English CC", kind: "captions", default: false }],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Select English CC" }));

    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "captions",
        track: "textTrack1",
        cues: [{ text: "CEA caption", startTime: 1, endTime: 4 }],
      });
    });

    expect(screen.getByText("CEA caption")).toBeInTheDocument();
    expect(hls.subtitleTrack).toBe(-1);
  });

  it("keeps Subtitles/CC enabled with Off and Local live captions when no platform track exists", () => {
    const { unmount } = render(
      <TooltipProvider>
        <SettingsMenu
          {...baseProps}
          timedTextTracks={[]}
          localTimedTextTrack={{
            key: "local-live:en",
            hlsTrackId: null,
            cueTrack: "local-live",
            kind: "captions",
            label: "Local live captions (English)",
            language: "en",
          }}
        />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const captions = screen.getByRole("button", { name: /Subtitles\/CC.*Off/ });
    expect(captions).toBeEnabled();
    fireEvent.click(captions);
    expect(screen.getByRole("radio", { name: "Off" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Local live captions (English)" })).toBeVisible();
    unmount();

    openSettings({
      ...baseProps,
      timedTextTracks: [
        {
          key: "subtitles:en",
          hlsTrackId: 0,
          cueTrack: "subtitles0",
          kind: "subtitles",
          label: "English",
          language: "en",
        },
      ],
    });
    expect(screen.getByRole("button", { name: /Subtitles\/CC.*Off/ })).toBeEnabled();
  });

  it("does not report Off when captions are enabled but the preferred language is unavailable", () => {
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
    openSettings({
      ...baseProps,
      timedTextTracks: [
        {
          key: "subtitles:es",
          hlsTrackId: 0,
          cueTrack: "subtitles0",
          kind: "subtitles",
          label: "Español",
          language: "es",
        },
      ],
    });

    expect(screen.getByRole("button", { name: /Subtitles\/CC.*Choose language/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Subtitles\/CC.*Off/ })).not.toBeInTheDocument();
  });

  it("lists Off and every timed text language and reflects the selected track", () => {
    const onTimedTextTrackChange = vi.fn();
    openSettings({
      ...baseProps,
      timedTextTracks: [
        {
          key: "subtitles:en",
          hlsTrackId: 0,
          cueTrack: "subtitles0",
          kind: "subtitles",
          label: "English",
          language: "en",
        },
        {
          key: "subtitles:es",
          hlsTrackId: 1,
          cueTrack: "subtitles1",
          kind: "subtitles",
          label: "Español",
          language: "es",
        },
      ],
      currentTimedTextTrackKey: "subtitles:es",
      onTimedTextTrackChange,
    });

    fireEvent.click(screen.getByRole("button", { name: /Subtitles\/CC/ }));
    expect(screen.getByRole("radio", { name: /Off/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /English/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /Español/ })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: /English/ }));
    expect(onTimedTextTrackChange).toHaveBeenCalledWith("subtitles:en");
  });

  it("exposes a labelled radiogroup with roving arrow-key selection", () => {
    const onTimedTextTrackChange = vi.fn();
    openSettings({
      ...baseProps,
      timedTextTracks: [
        {
          key: "subtitles:en",
          hlsTrackId: 0,
          cueTrack: "subtitles0",
          kind: "subtitles",
          label: "English",
          language: "en",
        },
        {
          key: "subtitles:es",
          hlsTrackId: 1,
          cueTrack: "subtitles1",
          kind: "subtitles",
          label: "Español",
          language: "es",
        },
      ],
      currentTimedTextTrackKey: null,
      onTimedTextTrackChange,
    });
    fireEvent.click(screen.getByRole("button", { name: /Subtitles\/CC/ }));

    const group = screen.getByRole("radiogroup", { name: "Subtitles/CC" });
    const off = screen.getByRole("radio", { name: "Off" });
    const english = screen.getByRole("radio", { name: "English" });
    expect(group).toContainElement(off);
    expect(off).toHaveAttribute("type", "button");
    expect(off).toHaveFocus();

    fireEvent.keyDown(off, { key: "ArrowDown" });
    expect(onTimedTextTrackChange).toHaveBeenLastCalledWith("subtitles:en");
    expect(english).toHaveFocus();
  });

  it("renders active HLS cues in a custom overlay after selecting a track", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 0, writable: true });
    render(<CaptionHarness hls={hls} mediaKey="vod:123" video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    expect(hls.subtitleTrack).toBe(0);

    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "Welcome to StreamFusion", startTime: 1, endTime: 4 }],
      });
    });

    expect(screen.queryByRole("status", { name: "Captions" })).not.toBeInTheDocument();

    video.currentTime = 2;
    act(() => video.dispatchEvent(new Event("timeupdate")));
    expect(screen.getByRole("status", { name: "Captions" })).toHaveTextContent(
      "Welcome to StreamFusion"
    );

    video.currentTime = 5;
    act(() => video.dispatchEvent(new Event("timeupdate")));
    expect(screen.queryByRole("status", { name: "Captions" })).not.toBeInTheDocument();
  });

  it("ignores cues for other tracks and keeps Off empty while cue events continue", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} mediaKey="live:off" video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "captions",
        track: "textTrack1",
        cues: [{ text: "Wrong track", startTime: 1, endTime: 4 }],
      });
    });
    expect(screen.queryByText("Wrong track")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Disable captions" }));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "After Off", startTime: 1, endTime: 4 }],
      });
    });
    expect(screen.queryByText("After Off")).not.toBeInTheDocument();
  });

  it("updates tracks and clears stale cues when tracks or active media change", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    const view = render(<CaptionHarness hls={hls} mediaKey="live:first" video={video} />);
    expect(screen.getByLabelText("Track count")).toHaveTextContent("1");

    hls.subtitleTracks.push({ name: "Español", lang: "es" });
    act(() => hls.emit("hlsSubtitleTracksUpdated", {}));
    expect(screen.getByLabelText("Track count")).toHaveTextContent("2");

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "Stale caption", startTime: 1, endTime: 4 }],
      });
    });
    expect(screen.getByText("Stale caption")).toBeInTheDocument();

    hls.subtitleTracks = [];
    act(() => hls.emit("hlsSubtitleTracksCleared", {}));
    expect(screen.getByLabelText("Track count")).toHaveTextContent("0");
    expect(screen.queryByText("Stale caption")).not.toBeInTheDocument();

    view.rerender(<CaptionHarness hls={hls} mediaKey="live:second" video={video} />);
    expect(screen.queryByRole("status", { name: "Captions" })).not.toBeInTheDocument();
    expect(hls.subtitleTrack).toBe(-1);
  });

  it("clears selection when a reused HLS index now represents a different track identity", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} mediaKey="live:identity" video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "Original identity", startTime: 1, endTime: 4 }],
      });
    });
    expect(screen.getByText("Original identity")).toBeInTheDocument();

    hls.subtitleTracks = [{ name: "Español", lang: "es", groupId: "replacement", url: "/es.m3u8" }];
    act(() => hls.emit("hlsSubtitleTracksUpdated", {}));

    expect(hls.subtitleTrack).toBe(-1);
    expect(screen.queryByText("Original identity")).not.toBeInTheDocument();
  });

  it("preserves selection when a stable rendition moves to a different HLS index", () => {
    const hls = new FakeHls();
    hls.subtitleTracks = [
      {
        name: "English",
        lang: "en",
        groupId: "first-group",
        url: "/first-token/en.m3u8",
        attrs: { "STABLE-RENDITION-ID": "english-main" },
      },
    ];
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} mediaKey="live:stable" video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Select English" }));
    hls.subtitleTracks = [
      { name: "EspaÃ±ol", lang: "es", groupId: "second-group", url: "/es.m3u8" },
      {
        name: "English Main",
        lang: "en",
        groupId: "second-group",
        url: "/second-token/en.m3u8",
        attrs: { "STABLE-RENDITION-ID": "english-main" },
      },
    ];
    act(() => hls.emit("hlsSubtitleTracksUpdated", {}));

    expect(screen.getByLabelText("Selected track")).not.toHaveTextContent("off");
    expect(hls.subtitleTrack).toBe(1);

    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles1",
        cues: [{ text: "Moved rendition", startTime: 1, endTime: 4 }],
      });
    });
    expect(screen.getByText("Moved rendition")).toBeInTheDocument();
  });

  // Guards: a long backward seek retains reparsed cues near the new playback position.
  it("bounds retained cues around playback while accepting a reloaded backward-seek window", () => {
    const hls = new FakeHls();
    const video = document.createElement("video");
    const nativeCues: TextTrackCue[] = [];
    const addCue = vi.fn((cue: TextTrackCue) => nativeCues.push(cue));
    const nativeTrack = {
      mode: "disabled" as TextTrackMode,
      cues: nativeCues,
      addCue,
      removeCue: vi.fn((cue: TextTrackCue) => {
        const index = nativeCues.indexOf(cue);
        if (index >= 0) nativeCues.splice(index, 1);
      }),
    };
    video.addTextTrack = vi.fn(() => nativeTrack as unknown as TextTrack);
    Object.defineProperty(video, "currentTime", { value: 599.5, writable: true });
    render(<CaptionHarness hls={hls} mediaKey="live:long" video={video} />);
    fireEvent.click(screen.getByRole("button", { name: "Select English" }));

    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: Array.from({ length: 600 }, (_, index) => ({
          text: `Cue ${index}`,
          startTime: index,
          endTime: index + 1,
        })),
      });
    });
    expect(screen.getByText("Cue 599")).toBeInTheDocument();

    video.currentTime = 0.5;
    act(() => video.dispatchEvent(new Event("seeked")));
    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [{ text: "Reloaded Cue 0", startTime: 0, endTime: 1 }],
      });
    });

    expect(screen.getByText("Reloaded Cue 0")).toBeInTheDocument();
    act(() => video.dispatchEvent(new Event("enterpictureinpicture")));
    expect(addCue.mock.calls.length).toBeLessThanOrEqual(512);
    expect(addCue).toHaveBeenCalledWith(expect.objectContaining({ text: "Reloaded Cue 0" }));
  });

  it("exposes timed text selection through both live and VOD control paths", () => {
    const playerProps = {
      isPlaying: false,
      volume: 100,
      muted: false,
      qualities: [],
      currentQualityId: "auto",
      isFullscreen: false,
      onTogglePlay: vi.fn(),
      onVolumeChange: vi.fn(),
      onToggleMute: vi.fn(),
      onQualityChange: vi.fn(),
      onToggleFullscreen: vi.fn(),
      timedTextTracks: [
        {
          key: "subtitles:en",
          hlsTrackId: 0,
          cueTrack: "subtitles0",
          kind: "subtitles" as const,
          label: "English",
          language: "en",
        },
      ],
      currentTimedTextTrackKey: null,
      onTimedTextTrackChange: vi.fn(),
    };

    const live = render(
      <TooltipProvider>
        <KickLivePlayerControls {...playerProps} />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText("Subtitles/CC")).toBeInTheDocument();
    live.unmount();

    render(
      <TooltipProvider>
        <KickVodPlayerControls {...playerProps} duration={120} currentTime={10} />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText("Subtitles/CC")).toBeInTheDocument();
  });
});

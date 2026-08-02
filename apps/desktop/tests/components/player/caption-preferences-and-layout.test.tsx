import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useMemo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CaptionOverlay } from "@/components/player/caption-overlay";
import { useTimedText } from "@/components/player/hooks/use-timed-text";
import { SettingsMenu } from "@/components/player/settings-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

const originalUpdatePreferences = useAuthStore.getState().updatePreferences;

function installPreferences(preferences: UserPreferences = DEFAULT_USER_PREFERENCES) {
  const updatePreferences = vi.fn(async (updates: Partial<UserPreferences>) => {
    const current = useAuthStore.getState().preferences ?? DEFAULT_USER_PREFERENCES;
    useAuthStore.setState({ preferences: { ...current, ...updates } });
  });
  useAuthStore.setState({ preferences: { ...preferences }, updatePreferences });
  return updatePreferences;
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
  }> = [];
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
  usePersistedPreference = true,
}: {
  hls: FakeHls;
  mediaKey: string;
  video?: HTMLVideoElement;
  usePersistedPreference?: boolean;
}) {
  const fallbackVideo = useMemo(() => document.createElement("video"), []);
  const captions = useTimedText(hls as never, mediaKey, video ?? fallbackVideo, {
    usePersistedPreference,
  });
  return (
    <>
      <output aria-label="Selected caption">{captions.selectedTrackKey ?? "off"}</output>
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

function TrackDiscovery({ hls, tracks }: { hls: FakeHls; tracks: FakeHls["subtitleTracks"] }) {
  useEffect(() => {
    hls.subtitleTracks = tracks;
    hls.emit("hlsSubtitleTracksUpdated", {});
  }, [hls, tracks]);
  return null;
}

function LiveSwitchHarness({
  hls,
  mediaKey,
  tracks,
}: {
  hls: FakeHls;
  mediaKey: string;
  tracks: FakeHls["subtitleTracks"];
}) {
  const video = useMemo(() => document.createElement("video"), []);
  const captions = useTimedText(hls as never, mediaKey, video);
  return (
    <>
      <TrackDiscovery hls={hls} tracks={tracks} />
      <output aria-label="Selected live caption">{captions.selectedTrackKey ?? "off"}</output>
    </>
  );
}

function CeaDiscovery({ hls, available }: { hls: FakeHls; available: boolean }) {
  useEffect(() => {
    if (!available) {
      hls.subtitleTracks = [];
      hls.emit("hlsSubtitleTracksUpdated", {});
      return;
    }
    hls.emit("hlsNonNativeTextTracksFound", {
      tracks: [{ _id: "textTrack1", label: "English", kind: "captions", default: false }],
    });
    hls.emit("hlsCuesParsed", {
      type: "captions",
      track: "textTrack1",
      cues: [{ text: "First live caption", startTime: 1, endTime: 4 }],
    });
  }, [available, hls]);
  return null;
}

function LiveCeaHarness({
  hls,
  mediaKey,
  available,
}: {
  hls: FakeHls;
  mediaKey: string;
  available: boolean;
}) {
  const video = useMemo(() => {
    const element = document.createElement("video");
    Object.defineProperty(element, "currentTime", { value: 2, writable: true });
    return element;
  }, []);
  const captions = useTimedText(hls as never, mediaKey, video);
  return (
    <>
      <CeaDiscovery hls={hls} available={available} />
      <output aria-label="Selected CEA caption">{captions.selectedTrackKey ?? "off"}</output>
      <CaptionOverlay cues={captions.activeCues} />
    </>
  );
}

afterEach(() => {
  cleanup();
  useAuthStore.setState({
    preferences: null,
    updatePreferences: originalUpdatePreferences,
  });
});

// Guards: globally preferred caption language restores only when that Timed Text Track exists.
// Guards: platform caption choices replace Local only in single-stream players; MultiView choices stay session-only.
describe("caption preferences and layout", () => {
  it("does not restore a platform track from a saved Local caption source", () => {
    useAuthStore.setState({
      preferences: {
        ...DEFAULT_USER_PREFERENCES,
        captions: {
          ...DEFAULT_USER_PREFERENCES.captions,
          enabled: true,
          source: "local",
          preferredLanguage: "en",
          localModelId: "zipformer-en-20m-2023-02-17",
        },
      },
    });
    const hls = new FakeHls();
    hls.subtitleTracks = [{ name: "English", lang: "en", groupId: "subs", url: "/en.m3u8" }];

    render(<CaptionHarness hls={hls} mediaKey="live:saved-local" />);

    expect(screen.getByLabelText("Selected caption")).toHaveTextContent("off");
    expect(hls.subtitleTrack).toBe(-1);
  });

  it("keeps a MultiView platform-caption choice out of single-stream preferences", () => {
    const updatePreferences = installPreferences({
      ...DEFAULT_USER_PREFERENCES,
      captions: {
        ...DEFAULT_USER_PREFERENCES.captions,
        enabled: true,
        source: "local",
        preferredLanguage: "en",
        localModelId: "zipformer-en-20m-2023-02-17",
      },
    });
    const savedCaptions = useAuthStore.getState().preferences?.captions;
    const hls = new FakeHls();
    hls.subtitleTracks = [{ name: "Spanish", lang: "es", groupId: "subs", url: "/es.m3u8" }];
    render(
      <CaptionHarness hls={hls} mediaKey="multiview:session-only" usePersistedPreference={false} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Select Spanish" }));

    expect(screen.getByLabelText("Selected caption")).not.toHaveTextContent("off");
    expect(hls.subtitleTrack).toBe(0);
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(useAuthStore.getState().preferences?.captions).toEqual(savedCaptions);
  });

  it("restores an available preferred language and remains Off when it is unavailable", () => {
    useAuthStore.setState({
      preferences: {
        ...DEFAULT_USER_PREFERENCES,
        captions: {
          ...DEFAULT_USER_PREFERENCES.captions,
          enabled: true,
          preferredLanguage: "ES-mx",
        },
      },
    });

    const availableHls = new FakeHls();
    availableHls.subtitleTracks = [
      { name: "English", lang: "en", groupId: "subs", url: "/en.m3u8" },
      { name: "Español", lang: "es-MX", groupId: "subs", url: "/es.m3u8" },
    ];
    const available = render(<CaptionHarness hls={availableHls} mediaKey="vod:available" />);

    expect(screen.getByLabelText("Selected caption")).not.toHaveTextContent("off");
    expect(availableHls.subtitleTrack).toBe(1);
    available.unmount();

    const unavailableHls = new FakeHls();
    unavailableHls.subtitleTracks = [
      { name: "English", lang: "en", groupId: "subs", url: "/en.m3u8" },
    ];
    render(<CaptionHarness hls={unavailableHls} mediaKey="vod:unavailable" />);

    expect(screen.getByLabelText("Selected caption")).toHaveTextContent("off");
    expect(unavailableHls.subtitleTrack).toBe(-1);
  });

  it("matches a preferred base language to an available regional caption track", () => {
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
    const hls = new FakeHls();
    hls.subtitleTracks = [
      { name: "English (United States)", lang: "en-US", groupId: "subs", url: "/en.m3u8" },
    ];

    render(<CaptionHarness hls={hls} mediaKey="live:regional" />);

    expect(screen.getByLabelText("Selected caption")).not.toHaveTextContent("off");
    expect(hls.subtitleTrack).toBe(0);
  });

  it("restores the preferred language when a reused HLS instance discovers the next live stream", () => {
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

    const hls = new FakeHls();
    const firstTracks = [{ name: "English", lang: "en", groupId: "first", url: "/first/en.m3u8" }];
    const secondTracks = [
      { name: "English", lang: "en", groupId: "second", url: "/second/en.m3u8" },
    ];
    const view = render(<LiveSwitchHarness hls={hls} mediaKey="live:first" tracks={firstTracks} />);
    expect(hls.subtitleTrack).toBe(0);

    view.rerender(<LiveSwitchHarness hls={hls} mediaKey="live:second" tracks={secondTracks} />);

    expect(screen.getByLabelText("Selected live caption")).not.toHaveTextContent("off");
    expect(hls.subtitleTrack).toBe(0);
  });

  it("restores an enabled preference to CEA textTrack1 and renders its first cue after a no-track stream", () => {
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
    const hls = new FakeHls();
    const noTrackView = render(
      <LiveCeaHarness hls={hls} mediaKey="live:no-captions" available={false} />
    );
    expect(screen.getByLabelText("Selected CEA caption")).toHaveTextContent("off");

    noTrackView.rerender(<LiveCeaHarness hls={hls} mediaKey="live:cea" available />);

    expect(screen.getByLabelText("Selected CEA caption")).not.toHaveTextContent("off");
    expect(screen.getByRole("status", { name: "Captions" })).toHaveTextContent(
      "First live caption"
    );
  });

  it("persists a selected language and keeps it preferred when captions are turned Off", () => {
    const updatePreferences = installPreferences();
    const hls = new FakeHls();
    hls.subtitleTracks = [{ name: "Español", lang: "es", groupId: "subs", url: "/es.m3u8" }];
    render(<CaptionHarness hls={hls} mediaKey="vod:persist" />);

    fireEvent.click(screen.getByRole("button", { name: "Select Español" }));
    expect(updatePreferences).toHaveBeenLastCalledWith({
      captions: {
        ...DEFAULT_USER_PREFERENCES.captions,
        enabled: true,
        preferredLanguage: "es",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Disable captions" }));
    expect(updatePreferences).toHaveBeenLastCalledWith({
      captions: {
        ...DEFAULT_USER_PREFERENCES.captions,
        enabled: false,
        preferredLanguage: "es",
      },
    });
  });

  it("replaces a saved local source when the user selects a platform caption track", () => {
    const updatePreferences = installPreferences({
      ...DEFAULT_USER_PREFERENCES,
      captions: {
        ...DEFAULT_USER_PREFERENCES.captions,
        enabled: true,
        source: "local",
        preferredLanguage: "en",
        localModelId: "zipformer-en-20m-2023-02-17",
      },
    });
    const hls = new FakeHls();
    hls.subtitleTracks = [{ name: "Spanish", lang: "es", groupId: "subs", url: "/es.m3u8" }];
    render(<CaptionHarness hls={hls} mediaKey="live:platform-handoff" />);

    fireEvent.click(screen.getByRole("button", { name: "Select Spanish" }));

    expect(updatePreferences).toHaveBeenLastCalledWith({
      captions: {
        ...DEFAULT_USER_PREFERENCES.captions,
        enabled: true,
        source: "platform",
        preferredLanguage: "es",
        localModelId: "zipformer-en-20m-2023-02-17",
      },
    });
  });

  it("updates caption size and opacity and resets the fixed accessible style defaults", () => {
    installPreferences();
    render(
      <TooltipProvider>
        <SettingsMenu
          qualities={[]}
          currentQualityId="auto"
          onQualityChange={vi.fn()}
          timedTextTracks={[
            {
              key: "subtitles:en",
              hlsTrackId: 0,
              cueTrack: "subtitles0",
              kind: "subtitles",
              label: "English",
              language: "en",
            },
          ]}
        />
        <CaptionOverlay cues={[{ text: "Readable caption", startTime: 0, endTime: 2 }]} />
      </TooltipProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: /Subtitles\/CC/ }));
    fireEvent.change(screen.getByRole("slider", { name: "Caption text size" }), {
      target: { value: "150" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Caption background opacity" }), {
      target: { value: "40" },
    });

    const caption = screen.getByText("Readable caption");
    expect(caption).toHaveStyle({
      color: "rgb(255, 255, 255)",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: "1.875rem",
      backgroundColor: "rgba(0, 0, 0, 0.4)",
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset caption appearance" }));
    expect(caption).toHaveStyle({
      fontSize: "1.25rem",
      backgroundColor: "rgba(0, 0, 0, 0.8)",
    });
  });

  it("honors valid cue positioning and sends malformed positioning to the control-safe fallback", () => {
    render(
      <CaptionOverlay
        cues={[
          {
            text: "Positioned cue",
            startTime: 0,
            endTime: 2,
            position: 10,
            positionAlign: "line-left",
            line: 20,
            snapToLines: false,
            size: 40,
            align: "start",
          },
          {
            text: "Malformed cue",
            startTime: 0,
            endTime: 2,
            position: 140,
          },
        ]}
      />
    );

    expect(screen.getByText("Positioned cue")).toHaveStyle({
      left: "10%",
      top: "20%",
      width: "40%",
      textAlign: "left",
      transform: "translateX(0%)",
    });
    expect(screen.getByText("Malformed cue")).toHaveAttribute("data-caption-layout", "fallback");
    expect(screen.getByText("Malformed cue").parentElement).toHaveStyle({
      bottom: "clamp(5rem, 12%, 8rem)",
    });
  });

  // Guards: valid WebVTT percentage and snapped lines honor start, center, and end alignment.
  it("anchors percentage and snapped cue lines with valid WebVTT line alignment CSS", () => {
    render(
      <CaptionOverlay
        cues={[
          {
            text: "Percentage center",
            startTime: 0,
            endTime: 2,
            line: 25,
            lineAlign: "center",
            snapToLines: false,
          },
          {
            text: "Snapped end",
            startTime: 0,
            endTime: 2,
            line: 2,
            lineAlign: "end",
            snapToLines: true,
          },
        ]}
      />
    );

    expect(screen.getByText("Percentage center")).toHaveStyle({
      top: "25%",
      transform: "translateX(-50%) translateY(-50%)",
    });
    const snappedCue = screen.getByText("Snapped end");
    expect(snappedCue).toHaveStyle({
      top: "calc(5% + 3em)",
      transform: "translateX(-50%) translateY(-100%)",
    });
    expect(snappedCue.getAttribute("style")).not.toContain("*");
  });

  it("renders multiline and overlapping cues while rapid transitions follow playback time", () => {
    installPreferences();
    const hls = new FakeHls();
    hls.subtitleTracks = [{ name: "English", lang: "en", groupId: "subs", url: "/en.m3u8" }];
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 2, writable: true });
    render(<CaptionHarness hls={hls} mediaKey="vod:timing" video={video} />);
    fireEvent.click(screen.getByRole("button", { name: "Select English" }));

    act(() => {
      hls.emit("hlsCuesParsed", {
        type: "subtitles",
        track: "subtitles0",
        cues: [
          { text: "First line\nSecond line", startTime: 0, endTime: 5 },
          { text: "Overlapping speaker", startTime: 1, endTime: 4 },
          { text: "Rapid first", startTime: 1.95, endTime: 2.05 },
          { text: "Rapid second", startTime: 2.05, endTime: 2.2 },
        ],
      });
    });

    expect(screen.getByText(/First line/)).toHaveClass("whitespace-pre-line");
    expect(screen.getByText("Overlapping speaker")).toBeInTheDocument();
    expect(screen.getByText("Rapid first")).toBeInTheDocument();
    expect(screen.queryByText("Rapid second")).not.toBeInTheDocument();

    video.currentTime = 2.1;
    act(() => video.dispatchEvent(new Event("timeupdate")));
    expect(screen.queryByText("Rapid first")).not.toBeInTheDocument();
    expect(screen.getByText("Rapid second")).toBeInTheDocument();
  });

  it("keeps fallback captions readable through resize and fullscreen layout changes", () => {
    const view = render(
      <div data-testid="player" style={{ width: "320px", height: "180px", position: "relative" }}>
        <CaptionOverlay cues={[{ text: "Responsive caption", startTime: 0, endTime: 2 }]} />
      </div>
    );
    const player = screen.getByTestId("player");
    const caption = screen.getByText("Responsive caption");
    const overlay = screen.getByRole("status", { name: "Captions" });

    expect(overlay).toHaveClass("inset-4");
    expect(caption).toHaveClass("max-w-[85%]");
    expect(caption.parentElement).toHaveStyle({ bottom: "clamp(5rem, 12%, 8rem)" });

    player.style.width = "160px";
    window.dispatchEvent(new Event("resize"));
    expect(screen.getByText("Responsive caption")).toBeVisible();

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: player,
    });
    view.rerender(
      <div data-testid="player" style={{ width: "100vw", height: "100vh", position: "relative" }}>
        <CaptionOverlay cues={[{ text: "Responsive caption", startTime: 0, endTime: 2 }]} />
      </div>
    );
    expect(screen.getByText("Responsive caption")).toBeVisible();
    expect(screen.getByText("Responsive caption").parentElement).toHaveStyle({
      bottom: "clamp(5rem, 12%, 8rem)",
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
  });
});

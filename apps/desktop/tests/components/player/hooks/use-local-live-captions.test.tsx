import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type RefObject, StrictMode, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_USER_PREFERENCES } from "@/shared/auth-types";
import type {
  LocalCaptionModelState,
  LocalCaptionRecognizerState,
  LocalCaptionResult,
} from "@/shared/local-caption-types";
import { useAuthStore } from "@/store/auth-store";

const capture = vi.hoisted(() => ({
  onBatch: null as null | ((batch: unknown) => void),
  bind: vi.fn(async () => 1),
  stop: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
  setPresentation: vi.fn(),
}));

vi.mock("@/components/player/local-audio-capture", () => ({
  LocalAudioCaptureController: class {
    constructor(options: { onBatch: (batch: unknown) => void }) {
      capture.onBatch = options.onBatch;
    }
    bind = capture.bind;
    stop = capture.stop;
    dispose = capture.dispose;
    setPresentation = capture.setPresentation;
  },
}));

import { useLocalLiveCaptions } from "@/components/player/hooks/use-local-live-captions";

const originalUpdatePreferences = useAuthStore.getState().updatePreferences;

const readyModel: LocalCaptionModelState = {
  phase: "ready",
  languageLabel: "English",
  languageTag: "en",
  downloadBytes: 45_202_074,
  installedBytes: 45_202_074,
  displaySize: "43.11 MiB",
  license: "Apache-2.0",
  sourceName: "Hugging Face",
  sourceUrl: "https://huggingface.co/model",
  downloadedBytes: 45_202_074,
};

function Harness({
  video,
  volume = 0.75,
  sourceKey = "https://twitch.test/live.m3u8",
  sessionId = "twitch:talker",
  allowLocalCaptions = true,
  videoRefOverride,
}: {
  video: HTMLVideoElement;
  volume?: number;
  sourceKey?: string;
  sessionId?: string;
  allowLocalCaptions?: boolean;
  videoRefOverride?: RefObject<HTMLVideoElement | null>;
}) {
  const internalVideoRef = useRef(video);
  const videoRef = videoRefOverride ?? internalVideoRef;
  const captions = useLocalLiveCaptions({
    videoRef,
    sessionId,
    sourceKey,
    muted: false,
    volume,
    allowLocalCaptions,
  });
  return (
    <>
      <output aria-label="Local phase">{captions.phase}</output>
      <output aria-label="Local model phase">{captions.modelState.phase}</output>
      <output aria-label="Local cue">{captions.activeCues[0]?.text ?? ""}</output>
      <output aria-label="Local error">{captions.error ?? ""}</output>
      <output aria-label="Local selected">{captions.selected ? "on" : "off"}</output>
      <button type="button" onClick={() => void captions.selectLocal()}>
        Select Local
      </button>
      <button type="button" onClick={() => void captions.stop()}>
        Off
      </button>
      <button type="button" onClick={() => captions.suspend()}>
        Suspend local
      </button>
      <button type="button" onClick={() => void captions.removeModel()}>
        Remove model
      </button>
    </>
  );
}

// Guards: local selection starts one verified lease/capture, streams bounded PCM, renders partials, and Off tears down both sides.
// Guards: durable Local selection restores after hydration without duplicate StrictMode leases or missing-model fallback.
// Guards: manifest refreshes keep one session, platform switches reject stale work, and MultiView suppression acquires zero leases.
// Guards: cue revisions replace in place while seek, discontinuity, clock jumps, and stream switches clear stale local text.
// Guards: local captions use one bounded native plain-text track while Chromium Picture-in-Picture is active.
describe("useLocalLiveCaptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capture.onBatch = null;
    const updatePreferences = vi.fn(async (updates) => {
      useAuthStore.setState((state) => ({
        preferences: { ...(state.preferences ?? DEFAULT_USER_PREFERENCES), ...updates },
      }));
    });
    useAuthStore.setState({
      preferences: { ...DEFAULT_USER_PREFERENCES },
      updatePreferences,
    });
  });

  afterEach(() => {
    useAuthStore.setState({ preferences: null, updatePreferences: originalUpdatePreferences });
  });

  it("persists the explicit local source, language, model, and enabled state", async () => {
    const api = {
      getModelState: vi.fn(async () => readyModel),
      downloadModel: vi.fn(),
      cancelModelDownload: vi.fn(),
      removeModel: vi.fn(),
      start: vi.fn(async (_sessionId: string, _generation: number) => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      pushAudio: vi.fn(async () => ({ accepted: true })),
      onModelState: vi.fn(() => vi.fn()),
      onRecognizerState: vi.fn(() => vi.fn()),
      onResult: vi.fn(() => vi.fn()),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { localCaptions: api },
    });
    render(
      <Harness
        video={document.createElement("video")}
        videoRefOverride={createRef<HTMLVideoElement>()}
      />
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Local model phase")).toHaveTextContent("ready")
    );

    fireEvent.click(screen.getByRole("button", { name: "Select Local" }));

    const updatePreferences = useAuthStore.getState().updatePreferences;
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        captions: expect.objectContaining({
          enabled: true,
          source: "local",
          preferredLanguage: "en",
          localModelId: "zipformer-en-20m-2023-02-17",
        }),
      })
    );

    vi.mocked(updatePreferences).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Suspend local" }));
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(useAuthStore.getState().preferences?.captions).toMatchObject({
      enabled: true,
      source: "local",
    });

    fireEvent.click(screen.getByRole("button", { name: "Select Local" }));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Off" }));
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenLastCalledWith({
        captions: expect.objectContaining({ enabled: false, source: "local" }),
      })
    );
  });

  it("restores one local caption lease only after preferences hydrate under StrictMode", async () => {
    useAuthStore.setState({ preferences: null });
    const api = {
      getModelState: vi.fn(async () => readyModel),
      downloadModel: vi.fn(),
      cancelModelDownload: vi.fn(),
      removeModel: vi.fn(),
      start: vi.fn(async (_sessionId: string, _generation: number) => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      pushAudio: vi.fn(async () => ({ accepted: true })),
      onModelState: vi.fn(() => vi.fn()),
      onRecognizerState: vi.fn(() => vi.fn()),
      onResult: vi.fn(() => vi.fn()),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { localCaptions: api },
    });
    const videoRef = createRef<HTMLVideoElement>();
    videoRef.current = document.createElement("video");
    render(
      <StrictMode>
        <Harness video={videoRef.current} videoRefOverride={videoRef} />
      </StrictMode>
    );
    await waitFor(() => expect(api.getModelState.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(api.start).not.toHaveBeenCalled();

    act(() => {
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
    });

    await waitFor(() => expect(screen.getByLabelText("Local selected")).toHaveTextContent("on"));
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    expect(api.start).toHaveBeenCalledWith("twitch:talker", expect.any(Number));
  });

  it("keeps a saved local selection install-required when its model is missing", async () => {
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
    const api = {
      getModelState: vi.fn(async () => ({
        ...readyModel,
        phase: "not-installed" as const,
        downloadedBytes: 0,
      })),
      downloadModel: vi.fn(),
      cancelModelDownload: vi.fn(),
      removeModel: vi.fn(),
      start: vi.fn(async (_sessionId: string, _generation: number) => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      pushAudio: vi.fn(async () => ({ accepted: true })),
      onModelState: vi.fn(() => vi.fn()),
      onRecognizerState: vi.fn(() => vi.fn()),
      onResult: vi.fn(() => vi.fn()),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { localCaptions: api },
    });

    render(<Harness video={document.createElement("video")} />);

    await waitFor(() =>
      expect(screen.getByLabelText("Local model phase")).toHaveTextContent("not-installed")
    );
    expect(screen.getByLabelText("Local selected")).toHaveTextContent("on");
    expect(screen.getByLabelText("Local phase")).toHaveTextContent("install-required");
    expect(api.start).not.toHaveBeenCalled();
    expect(useAuthStore.getState().preferences?.captions).toMatchObject({
      enabled: true,
      source: "local",
      localModelId: "zipformer-en-20m-2023-02-17",
    });
  });

  it("keeps one session across manifest refreshes and replaces it once in both platform directions", async () => {
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
    let onResult: ((result: LocalCaptionResult) => void) | null = null;
    const api = {
      getModelState: vi.fn(async () => readyModel),
      downloadModel: vi.fn(),
      cancelModelDownload: vi.fn(),
      removeModel: vi.fn(),
      start: vi.fn(async (_sessionId: string, _generation: number) => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      pushAudio: vi.fn(async () => ({ accepted: true })),
      onModelState: vi.fn(() => vi.fn()),
      onRecognizerState: vi.fn(() => vi.fn()),
      onResult: vi.fn((listener) => {
        onResult = listener;
        return vi.fn();
      }),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { localCaptions: api },
    });
    const video = document.createElement("video");
    const videoRef = createRef<HTMLVideoElement>();
    videoRef.current = video;
    const view = render(
      <Harness
        video={video}
        sessionId="twitch:talker"
        sourceKey="https://twitch.test/manifest-1.m3u8"
        videoRefOverride={videoRef}
      />
    );
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    const twitchGeneration = api.start.mock.calls[0][1];
    const twitchOnBatch = capture.onBatch;
    act(() =>
      onResult?.({
        type: "result",
        sessionId: "twitch:talker",
        generation: twitchGeneration,
        sequence: 1,
        mediaTime: 1,
        cueId: "twitch:talker:live-1",
        revision: 1,
        text: "twitch words",
        isFinal: false,
        words: [],
      })
    );
    expect(screen.getByLabelText("Local cue")).toHaveTextContent("twitch words");
    act(() =>
      onResult?.({
        type: "result",
        sessionId: "twitch:talker",
        generation: twitchGeneration,
        sequence: 2,
        mediaTime: 1.2,
        cueId: "twitch:talker:live-1",
        revision: 2,
        text: "twitch words revised",
        isFinal: false,
        words: [],
      })
    );
    expect(screen.getByLabelText("Local cue")).toHaveTextContent("twitch words revised");
    act(() =>
      onResult?.({
        type: "result",
        sessionId: "twitch:talker",
        generation: twitchGeneration,
        sequence: 3,
        mediaTime: 1.3,
        cueId: "twitch:talker:live-1",
        revision: 2,
        text: "equal revision must lose",
        isFinal: false,
        words: [],
      })
    );
    expect(screen.getByLabelText("Local cue")).toHaveTextContent("twitch words revised");

    view.rerender(
      <Harness
        video={video}
        sessionId="twitch:talker"
        sourceKey="https://twitch.test/manifest-2.m3u8"
        videoRefOverride={videoRef}
      />
    );

    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.stop).not.toHaveBeenCalled();

    view.rerender(
      <Harness
        video={video}
        sessionId="kick:talker"
        sourceKey="https://kick.test/manifest.m3u8"
        videoRefOverride={videoRef}
      />
    );
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2));
    const kickGeneration = api.start.mock.calls[1][1];
    expect(api.stop).toHaveBeenCalledWith("twitch:talker", twitchGeneration);
    expect(screen.getByLabelText("Local cue")).toHaveTextContent("");
    api.pushAudio.mockClear();
    act(() =>
      twitchOnBatch?.({
        mediaTime: 2,
        sampleRate: 16_000,
        pcm: Float32Array.from([0.1, -0.1]),
      })
    );
    expect(api.pushAudio).not.toHaveBeenCalled();
    act(() =>
      onResult?.({
        type: "result",
        sessionId: "twitch:talker",
        generation: twitchGeneration,
        sequence: 4,
        mediaTime: 2,
        cueId: "twitch:talker:live-1",
        revision: 3,
        text: "late twitch words",
        isFinal: false,
        words: [],
      })
    );
    expect(screen.getByLabelText("Local cue")).toHaveTextContent("");

    view.rerender(
      <Harness
        video={video}
        sessionId="twitch:talker"
        sourceKey="https://twitch.test/manifest-3.m3u8"
        videoRefOverride={videoRef}
      />
    );
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(3));
    expect(api.stop).toHaveBeenCalledWith("kick:talker", kickGeneration);
  });

  it("acquires zero leases and preserves the saved selection when local captions are suppressed", async () => {
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
    const updatePreferences = useAuthStore.getState().updatePreferences;
    const api = {
      getModelState: vi.fn(async () => readyModel),
      downloadModel: vi.fn(),
      cancelModelDownload: vi.fn(),
      removeModel: vi.fn(),
      start: vi.fn(async (_sessionId: string, _generation: number) => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      pushAudio: vi.fn(async () => ({ accepted: true })),
      onModelState: vi.fn(() => vi.fn()),
      onRecognizerState: vi.fn(() => vi.fn()),
      onResult: vi.fn(() => vi.fn()),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { localCaptions: api },
    });

    render(
      <>
        <Harness
          video={document.createElement("video")}
          sessionId="twitch:first"
          allowLocalCaptions={false}
        />
        <Harness
          video={document.createElement("video")}
          sessionId="kick:second"
          allowLocalCaptions={false}
        />
      </>
    );
    await waitFor(() => expect(api.getModelState).toHaveBeenCalledTimes(2));

    expect(api.start).not.toHaveBeenCalled();
    expect(updatePreferences).not.toHaveBeenCalled();
    for (const element of screen.getAllByLabelText("Local selected")) {
      expect(element).toHaveTextContent("off");
    }
    expect(useAuthStore.getState().preferences?.captions).toMatchObject({
      enabled: true,
      source: "local",
      localModelId: "zipformer-en-20m-2023-02-17",
    });
  });

  it("keeps the logical local selection when the installed model is removed", async () => {
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
    const notInstalledModel = {
      ...readyModel,
      phase: "not-installed" as const,
      downloadedBytes: 0,
    };
    const api = {
      getModelState: vi.fn(async () => readyModel),
      downloadModel: vi.fn(),
      cancelModelDownload: vi.fn(),
      removeModel: vi.fn(async () => ({ success: true, state: notInstalledModel })),
      start: vi.fn(async (_sessionId: string, _generation: number) => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      pushAudio: vi.fn(async () => ({ accepted: true })),
      onModelState: vi.fn(() => vi.fn()),
      onRecognizerState: vi.fn(() => vi.fn()),
      onResult: vi.fn(() => vi.fn()),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { localCaptions: api },
    });

    render(<Harness video={document.createElement("video")} />);
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Remove model" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Local phase")).toHaveTextContent("install-required")
    );
    expect(screen.getByLabelText("Local selected")).toHaveTextContent("on");
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().preferences?.captions).toMatchObject({
      enabled: true,
      source: "local",
      localModelId: "zipformer-en-20m-2023-02-17",
    });
  });

  it("runs the explicit ready-model lifecycle without capturing while Off", async () => {
    const lifecycle: string[] = [];
    let onResult: ((result: LocalCaptionResult) => void) | null = null;
    let onRecognizerState: ((state: LocalCaptionRecognizerState) => void) | null = null;
    const api = {
      getModelState: vi.fn(async () => readyModel),
      downloadModel: vi.fn(),
      cancelModelDownload: vi.fn(),
      removeModel: vi.fn(),
      start: vi.fn(async (_sessionId: string, generation: number) => {
        lifecycle.push(`start:${generation}`);
        return { success: true };
      }),
      stop: vi.fn(async (_sessionId: string, generation: number) => {
        lifecycle.push(`stop:${generation}`);
        return { success: true };
      }),
      pushAudio: vi.fn(async () => ({ accepted: true })),
      onModelState: vi.fn(() => vi.fn()),
      onRecognizerState: vi.fn((listener) => {
        onRecognizerState = listener;
        return vi.fn();
      }),
      onResult: vi.fn((listener) => {
        onResult = listener;
        return vi.fn();
      }),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { localCaptions: api },
    });
    const video = document.createElement("video");
    const nativeTrack = {
      mode: "disabled" as TextTrackMode,
      cues: [] as TextTrackCue[],
      addCue: vi.fn((cue: TextTrackCue) => nativeTrack.cues.push(cue)),
      removeCue: vi.fn((cue: TextTrackCue) => {
        nativeTrack.cues = nativeTrack.cues.filter((candidate) => candidate !== cue);
      }),
    };
    video.addTextTrack = vi.fn(() => nativeTrack as unknown as TextTrack);
    const firstVideoRef = createRef<HTMLVideoElement>();
    firstVideoRef.current = video;
    const view = render(
      <StrictMode>
        <Harness video={video} videoRefOverride={firstVideoRef} />
      </StrictMode>
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Local model phase")).toHaveTextContent("ready")
    );
    expect(capture.bind).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Select Local" }));
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    const firstGeneration = api.start.mock.calls[0][1];
    expect(api.start).toHaveBeenCalledWith("twitch:talker", firstGeneration);

    act(() => video.dispatchEvent(new Event("playing")));
    await waitFor(() => expect(capture.bind).toHaveBeenCalledWith(video, "twitch:talker"));
    view.rerender(
      <StrictMode>
        <Harness video={video} volume={0.4} videoRefOverride={firstVideoRef} />
      </StrictMode>
    );
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(capture.dispose).not.toHaveBeenCalled();
    expect(capture.setPresentation).toHaveBeenLastCalledWith(false, 0.4);
    const replacementVideoRef = createRef<HTMLVideoElement>();
    replacementVideoRef.current = video;
    view.rerender(
      <StrictMode>
        <Harness video={video} volume={0.4} videoRefOverride={replacementVideoRef} />
      </StrictMode>
    );
    await waitFor(() => expect(api.stop).toHaveBeenCalledWith("twitch:talker", firstGeneration));
    await waitFor(() =>
      expect(api.start).toHaveBeenLastCalledWith("twitch:talker", firstGeneration + 1)
    );
    expect(lifecycle.slice(0, 3)).toEqual([
      `start:${firstGeneration}`,
      `stop:${firstGeneration}`,
      `start:${firstGeneration + 1}`,
    ]);
    act(() =>
      onRecognizerState?.({
        type: "state",
        sessionId: "twitch:talker",
        generation: firstGeneration,
        phase: "stopped",
      })
    );
    expect(screen.getByLabelText("Local selected")).toHaveTextContent("on");
    view.rerender(
      <StrictMode>
        <Harness
          video={video}
          volume={0.4}
          sourceKey="https://twitch.test/restarted.m3u8"
          videoRefOverride={replacementVideoRef}
        />
      </StrictMode>
    );
    expect(api.start).toHaveBeenCalledTimes(2);
    act(() => {
      capture.onBatch?.({
        generation: firstGeneration + 1,
        mediaTime: 12,
        sampleRate: 16_000,
        pcm: Float32Array.from([0.1, -0.1]),
      });
    });
    await waitFor(() =>
      expect(api.pushAudio).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "twitch:talker",
          generation: firstGeneration + 1,
          sequence: 1,
          mediaTime: 12,
          sampleRate: 16_000,
          samples: expect.any(ArrayBuffer),
        })
      )
    );

    act(() =>
      onRecognizerState?.({
        type: "state",
        sessionId: "twitch:talker",
        generation: firstGeneration + 1,
        phase: "ready",
      })
    );
    act(() =>
      onResult?.({
        type: "result",
        sessionId: "twitch:talker",
        generation: firstGeneration + 1,
        sequence: 1,
        mediaTime: 12,
        cueId: "twitch:talker:live-1",
        revision: 1,
        text: "live partial",
        isFinal: false,
        words: [],
      })
    );
    await waitFor(() => expect(screen.getByLabelText("Local phase")).toHaveTextContent("ready"));
    expect(screen.getByLabelText("Local cue")).toHaveTextContent("live partial");
    act(() => video.dispatchEvent(new Event("enterpictureinpicture")));
    expect(nativeTrack.mode).toBe("showing");
    expect(nativeTrack.addCue).toHaveBeenCalledWith(
      expect.objectContaining({ text: "live partial" })
    );
    act(() =>
      onResult?.({
        type: "result",
        sessionId: "twitch:talker",
        generation: firstGeneration + 1,
        sequence: 2,
        mediaTime: 12.2,
        cueId: "twitch:talker:live-1",
        revision: 2,
        text: "updated plain PiP caption",
        isFinal: false,
        words: [],
      })
    );
    expect(nativeTrack.cues).toHaveLength(1);
    expect(nativeTrack.addCue).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "updated plain PiP caption" })
    );
    expect(video.addTextTrack).toHaveBeenCalledTimes(1);
    act(() => video.dispatchEvent(new Event("leavepictureinpicture")));
    expect(nativeTrack.mode).toBe("disabled");
    expect(nativeTrack.cues).toHaveLength(0);
    act(() => video.dispatchEvent(new Event("enterpictureinpicture")));
    expect(video.addTextTrack).toHaveBeenCalledTimes(1);
    act(() => video.dispatchEvent(new Event("leavepictureinpicture")));

    act(() =>
      onRecognizerState?.({
        type: "state",
        sessionId: "twitch:talker",
        generation: firstGeneration + 1,
        phase: "error",
        error: "Recognizer utility stopped",
      })
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Local error")).toHaveTextContent("Recognizer utility stopped")
    );
    fireEvent.click(screen.getByRole("button", { name: "Select Local" }));
    await waitFor(() =>
      expect(api.start).toHaveBeenLastCalledWith("twitch:talker", firstGeneration + 2)
    );
    expect(screen.getByLabelText("Local error")).toHaveTextContent("");

    act(() =>
      onResult?.({
        type: "result",
        sessionId: "twitch:talker",
        generation: firstGeneration + 2,
        sequence: 1,
        mediaTime: 13,
        cueId: "twitch:talker:seek-cue",
        revision: 1,
        text: "clear me on seek",
        isFinal: false,
        words: [],
      })
    );
    expect(screen.getByLabelText("Local cue")).toHaveTextContent("clear me on seek");
    act(() => video.dispatchEvent(new Event("seeking")));
    await waitFor(() =>
      expect(api.start).toHaveBeenLastCalledWith("twitch:talker", firstGeneration + 3)
    );
    expect(api.stop).toHaveBeenCalledWith("twitch:talker", firstGeneration + 2);
    expect(screen.getByLabelText("Local cue")).toHaveTextContent("");

    act(() =>
      onResult?.({
        type: "result",
        sessionId: "twitch:talker",
        generation: firstGeneration + 3,
        sequence: 1,
        mediaTime: 14,
        cueId: "twitch:talker:discontinuity-cue",
        revision: 1,
        text: "clear me on discontinuity",
        isFinal: true,
        words: [],
      })
    );
    expect(screen.getByLabelText("Local cue")).toHaveTextContent("clear me on discontinuity");
    act(() => video.dispatchEvent(new Event("emptied")));
    await waitFor(() =>
      expect(api.start).toHaveBeenLastCalledWith("twitch:talker", firstGeneration + 4)
    );
    expect(api.stop).toHaveBeenCalledWith("twitch:talker", firstGeneration + 3);
    expect(screen.getByLabelText("Local cue")).toHaveTextContent("");

    act(() =>
      onResult?.({
        type: "result",
        sessionId: "twitch:talker",
        generation: firstGeneration + 4,
        sequence: 1,
        mediaTime: 15,
        cueId: "twitch:talker:jump-cue",
        revision: 1,
        text: "clear me on clock jump",
        isFinal: false,
        words: [],
      })
    );
    act(() =>
      capture.onBatch?.({
        mediaTime: 15,
        sampleRate: 16_000,
        pcm: Float32Array.from([0.1, -0.1]),
      })
    );
    await waitFor(() =>
      expect(api.pushAudio).toHaveBeenLastCalledWith(
        expect.objectContaining({ generation: firstGeneration + 4, mediaTime: 15 })
      )
    );
    await act(async () => undefined);
    act(() =>
      capture.onBatch?.({
        mediaTime: 20,
        sampleRate: 16_000,
        pcm: Float32Array.from([0.1, -0.1]),
      })
    );
    await waitFor(() =>
      expect(api.start).toHaveBeenLastCalledWith("twitch:talker", firstGeneration + 5)
    );
    expect(api.stop).toHaveBeenCalledWith("twitch:talker", firstGeneration + 4);
    expect(screen.getByLabelText("Local cue")).toHaveTextContent("");

    fireEvent.click(screen.getByRole("button", { name: "Off" }));
    await waitFor(() =>
      expect(api.stop).toHaveBeenCalledWith("twitch:talker", firstGeneration + 5)
    );
    await waitFor(() => expect(useAuthStore.getState().preferences?.captions.enabled).toBe(false));
    expect(capture.dispose).toHaveBeenCalled();
    expect(screen.getByLabelText("Local cue")).toHaveTextContent("");

    view.unmount();
    render(<Harness video={document.createElement("video")} />);
    await waitFor(() => expect(api.getModelState.mock.calls.length).toBeGreaterThanOrEqual(3));
    fireEvent.click(screen.getAllByRole("button", { name: "Select Local" }).at(-1) as HTMLElement);
    await waitFor(() =>
      expect(api.start).toHaveBeenLastCalledWith("twitch:talker", firstGeneration + 6)
    );
  });
});

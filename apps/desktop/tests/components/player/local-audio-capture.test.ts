import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ContinuousMonoResampler,
  createBrowserDecodedAudioTap,
  type DecodedAudioTap,
  LocalAudioCaptureController,
  PcmBatcher,
  type RawDecodedAudioChunk,
  resampleMonoPcm,
} from "@/components/player/local-audio-capture";

function installMediaElementAudioHarness() {
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const gains: Array<{
    gain: { value: number };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const worklets: Array<{
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    port: {
      onmessage: ((event: MessageEvent<{ pcm: Float32Array }>) => void) | null;
      postMessage: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
  }> = [];
  const createMediaElementSource = vi.fn(() => source);

  class FakeAudioContext {
    sampleRate = 48_000;
    state = "running" as AudioContextState;
    destination = {};
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    createMediaElementSource = createMediaElementSource;
    createGain = vi.fn(() => {
      const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
      gains.push(gain);
      return gain;
    });
    resume = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);

    constructor() {
      contexts.push(this);
    }
  }

  class FakeAudioWorkletNode {
    connect = vi.fn();
    disconnect = vi.fn();
    port = {
      onmessage: null as ((event: MessageEvent<{ pcm: Float32Array }>) => void) | null,
      postMessage: vi.fn(),
      close: vi.fn(),
    };

    constructor() {
      worklets.push(this);
    }
  }

  const contexts: FakeAudioContext[] = [];
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
  return { contexts, createMediaElementSource, gains, source, worklets };
}

// Guards: decoded player audio is converted to the recognizer's fixed mono 16 kHz input contract.
describe("local live audio capture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("mixes channels and resamples decoded audio to mono 16 kHz PCM", () => {
    const left = Float32Array.from([1, 0.5, 0, -0.5, -1, -0.5, 0, 0.5]);
    const right = Float32Array.from([0.5, 0, -0.5, -1, -0.5, 0, 0.5, 1]);

    const pcm = resampleMonoPcm([left, right], 32_000, 16_000);

    expect(Array.from(pcm)).toEqual([0.5, -0.5, -0.5, 0.5]);
  });

  it("resamples continuously across uneven 44.1 kHz chunks without cumulative drift", () => {
    const resampler = new ContinuousMonoResampler(44_100, 16_000);
    const output: number[] = [];
    const chunkSizes = [127, 511, 2_048, 333, 4_097, 89];
    let inputSamples = 0;

    for (let iteration = 0; iteration < 40; iteration += 1) {
      for (const chunkSize of chunkSizes) {
        inputSamples += chunkSize;
        output.push(...resampler.push([new Float32Array(chunkSize).fill(0.25)]));
      }
    }

    expect(output).toHaveLength(Math.floor((inputSamples * 16_000) / 44_100));
    expect(output.every((sample) => Math.abs(sample - 0.25) < 1e-6)).toBe(true);
  });

  it("emits fixed-size bounded batches and retains only the unfinished tail", () => {
    const emitted: Float32Array[] = [];
    const batcher = new PcmBatcher(4, (pcm) => emitted.push(pcm));

    batcher.push(Float32Array.from([1, 2, 3]));
    batcher.push(Float32Array.from([4, 5, 6, 7, 8, 9]));

    expect(emitted.map((pcm) => Array.from(pcm))).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
    expect(batcher.pendingSampleCount).toBe(1);
  });

  it("rebinds with a new generation and rejects late audio from the old stream", async () => {
    const chunkListeners: Array<(chunk: RawDecodedAudioChunk) => void> = [];
    const stops = [vi.fn(), vi.fn()];
    const batches: Array<{ mediaKey: string; generation: number }> = [];
    const controller = new LocalAudioCaptureController({
      batchSampleCount: 4,
      tapFactory: async (_video, onChunk) => {
        const index = chunkListeners.push(onChunk) - 1;
        return { dispose: vi.fn(), setPresentation: vi.fn(), stop: stops[index] };
      },
      onBatch: ({ mediaKey, generation }) => batches.push({ mediaKey, generation }),
    });
    const video = document.createElement("video");

    await controller.bind(video, "twitch:first");
    await controller.bind(video, "kick:second");
    chunkListeners[0]({
      channels: [Float32Array.from([1, 1, 1, 1])],
      inputSampleRate: 16_000,
      mediaTime: 1,
    });
    chunkListeners[1]({
      channels: [Float32Array.from([1, 1, 1, 1])],
      inputSampleRate: 16_000,
      mediaTime: 2,
    });

    expect(stops[0]).toHaveBeenCalledOnce();
    expect(batches).toEqual([{ mediaKey: "kick:second", generation: 2 }]);
  });

  it("replaces capture ownership when the source refreshes on the same channel", async () => {
    const listeners: Array<(chunk: RawDecodedAudioChunk) => void> = [];
    const stops = [vi.fn(), vi.fn()];
    const onBatch = vi.fn();
    const controller = new LocalAudioCaptureController({
      batchSampleCount: 2,
      tapFactory: async (_video, listener) => {
        const index = listeners.push(listener) - 1;
        return { dispose: vi.fn(), setPresentation: vi.fn(), stop: stops[index] };
      },
      onBatch,
    });
    const video = document.createElement("video");

    await controller.bind(video, "twitch:same-channel");
    await controller.bind(video, "twitch:same-channel");
    listeners[0]({
      channels: [Float32Array.from([1, 1])],
      inputSampleRate: 16_000,
      mediaTime: 1,
    });
    listeners[1]({
      channels: [Float32Array.from([1, 1])],
      inputSampleRate: 16_000,
      mediaTime: 2,
    });

    expect(stops[0]).toHaveBeenCalledOnce();
    expect(onBatch).toHaveBeenCalledOnce();
    expect(onBatch).toHaveBeenCalledWith(
      expect.objectContaining({ mediaKey: "twitch:same-channel", generation: 2 })
    );
  });

  it("isolates generations and teardown between simultaneous player controllers", async () => {
    const listeners: Array<(chunk: RawDecodedAudioChunk) => void> = [];
    const stops = [vi.fn(), vi.fn()];
    const firstBatches = vi.fn();
    const secondBatches = vi.fn();
    const tapFactory = async (
      _video: HTMLVideoElement,
      listener: (chunk: RawDecodedAudioChunk) => void
    ) => {
      const index = listeners.push(listener) - 1;
      return { dispose: vi.fn(), setPresentation: vi.fn(), stop: stops[index] };
    };
    const first = new LocalAudioCaptureController({
      batchSampleCount: 2,
      tapFactory,
      onBatch: firstBatches,
    });
    const second = new LocalAudioCaptureController({
      batchSampleCount: 2,
      tapFactory,
      onBatch: secondBatches,
    });

    await first.bind(document.createElement("video"), "twitch:first-player");
    await second.bind(document.createElement("video"), "kick:second-player");
    await first.stop();
    listeners[0]({
      channels: [Float32Array.from([1, 1])],
      inputSampleRate: 16_000,
      mediaTime: 1,
    });
    listeners[1]({
      channels: [Float32Array.from([1, 1])],
      inputSampleRate: 16_000,
      mediaTime: 2,
    });

    expect(stops[0]).toHaveBeenCalledOnce();
    expect(stops[1]).not.toHaveBeenCalled();
    expect(firstBatches).not.toHaveBeenCalled();
    expect(secondBatches).toHaveBeenCalledWith(
      expect.objectContaining({ mediaKey: "kick:second-player", generation: 1 })
    );
  });

  it("updates native presentation without restarting the decoded capture tap", async () => {
    const setPresentation = vi.fn();
    const tapFactory = vi.fn().mockResolvedValue({
      dispose: vi.fn(),
      setPresentation,
      stop: vi.fn(),
    });
    const controller = new LocalAudioCaptureController({
      initialPresentation: { muted: true, volume: 0.42 },
      tapFactory,
      onBatch: vi.fn(),
    });

    await controller.bind(document.createElement("video"), "twitch:presentation");
    controller.setPresentation(false, 0.42);

    expect(tapFactory).toHaveBeenCalledOnce();
    expect(setPresentation.mock.calls).toEqual([
      [true, 0.42],
      [false, 0.42],
    ]);
  });

  it("keeps native autoplay mute until decoded capture binding succeeds", async () => {
    const video = document.createElement("video");
    video.muted = true;
    video.volume = 0.6;
    let finishBinding: ((tap: DecodedAudioTap) => void) | undefined;
    const controller = new LocalAudioCaptureController({
      initialPresentation: { muted: true, volume: 0.6 },
      tapFactory: () =>
        new Promise((resolve) => {
          finishBinding = resolve;
        }),
      onBatch: vi.fn(),
    });

    const binding = controller.bind(video, "twitch:autoplay");
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.6);

    await Promise.resolve();
    finishBinding?.({
      dispose: vi.fn(),
      setPresentation(muted, volume) {
        video.volume = muted ? 0 : volume;
        video.muted = false;
      },
      stop: vi.fn(),
    });
    await binding;

    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0);
  });

  it("tears down the decoded-audio tap and drops buffered or late samples", async () => {
    let onChunk: ((chunk: RawDecodedAudioChunk) => void) | undefined;
    const stopTap = vi.fn();
    const onBatch = vi.fn();
    const controller = new LocalAudioCaptureController({
      batchSampleCount: 4,
      tapFactory: async (_video, listener) => {
        onChunk = listener;
        return { dispose: vi.fn(), setPresentation: vi.fn(), stop: stopTap };
      },
      onBatch,
    });

    await controller.bind(document.createElement("video"), "twitch:teardown");
    onChunk?.({
      channels: [Float32Array.from([1, 1, 1])],
      inputSampleRate: 16_000,
      mediaTime: 1,
    });
    await controller.stop();
    onChunk?.({
      channels: [Float32Array.from([1, 1, 1, 1])],
      inputSampleRate: 16_000,
      mediaTime: 2,
    });

    expect(stopTap).toHaveBeenCalledOnce();
    expect(onBatch).not.toHaveBeenCalled();
  });

  it("routes one audible presentation path while muted analysis PCM continues", async () => {
    vi.useFakeTimers();
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const zeroGain = {
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const presentationGain = {
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const close = vi.fn();
    const workletNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      port: {
        onmessage: null as ((event: MessageEvent<{ pcm: Float32Array }>) => void) | null,
        postMessage: vi.fn(),
        close: vi.fn(),
      },
    };
    const onChunk = vi.fn();
    const addModule = vi.fn().mockResolvedValue(undefined);
    const createMediaElementSource = vi.fn(() => source);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:blocked-local-audio-worklet");
    const revokeObjectURL = vi.fn();

    class FakeAudioContext {
      sampleRate = 48_000;
      state = "running" as AudioContextState;
      destination = {};
      audioWorklet = { addModule };
      createMediaElementSource = createMediaElementSource;
      createGain = vi.fn().mockReturnValueOnce(zeroGain).mockReturnValueOnce(presentationGain);
      resume = vi.fn();
      close = close;
    }

    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal(
      "AudioWorkletNode",
      class FakeAudioWorkletNode {
        connect = workletNode.connect;
        disconnect = workletNode.disconnect;
        port = workletNode.port;
      }
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
    const video = document.createElement("video");
    video.muted = true;
    video.volume = 0.37;
    Object.defineProperty(video, "captureStream", {
      get: () => {
        throw new Error("captureStream must not be accessed");
      },
    });
    Object.defineProperty(video, "isConnected", { get: () => true });

    const tap = await createBrowserDecodedAudioTap(video, onChunk, {
      muted: true,
      volume: 0.37,
    });

    expect(addModule).toHaveBeenCalledOnce();
    const moduleUrl = String(addModule.mock.calls[0][0]);
    expect(moduleUrl).not.toMatch(/^(?:blob|data):/);
    expect(new URL(moduleUrl, window.location.href).origin).toBe(window.location.origin);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(1);
    expect(presentationGain.gain.value).toBe(0);
    expect(createMediaElementSource).toHaveBeenCalledOnce();
    expect(createMediaElementSource).toHaveBeenCalledWith(video);
    expect(source.connect).toHaveBeenCalledWith(
      expect.objectContaining({ port: workletNode.port })
    );
    expect(source.connect).toHaveBeenCalledWith(presentationGain);
    expect(source.connect).toHaveBeenCalledTimes(2);
    expect(workletNode.connect).toHaveBeenCalledWith(zeroGain);
    expect(zeroGain.gain.value).toBe(0);
    expect(zeroGain.connect).toHaveBeenCalledWith(expect.anything());
    expect(presentationGain.connect).toHaveBeenCalledWith(expect.anything());

    tap.setPresentation(false, 0.37);
    expect(presentationGain.gain.value).toBe(0.37);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(1);

    workletNode.port.onmessage?.({
      data: { pcm: Float32Array.from([0.2, -0.2]) },
    } as MessageEvent<{ pcm: Float32Array }>);
    expect(onChunk).toHaveBeenCalledWith(
      expect.objectContaining({ inputSampleRate: 48_000, mediaTime: 0 })
    );

    await tap.stop();
    workletNode.port.onmessage?.({
      data: { pcm: Float32Array.from([0.4, -0.4]) },
    } as MessageEvent<{ pcm: Float32Array }>);
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(presentationGain.disconnect).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(1);
  });

  it("reuses one media source hub on same-video rebind and rejects stale presentation updates", async () => {
    vi.useFakeTimers();
    const harness = installMediaElementAudioHarness();
    const video = document.createElement("video");
    video.muted = true;
    video.volume = 0.55;
    Object.defineProperty(video, "isConnected", { get: () => true });

    const oldTap = await createBrowserDecodedAudioTap(video, vi.fn(), {
      muted: true,
      volume: 0.55,
    });
    await oldTap.stop();
    const refreshedTap = await createBrowserDecodedAudioTap(video, vi.fn(), {
      muted: false,
      volume: 0.55,
    });
    oldTap.setPresentation(true, 0.55);

    expect(harness.contexts).toHaveLength(1);
    expect(harness.createMediaElementSource).toHaveBeenCalledOnce();
    expect(harness.source.connect).toHaveBeenCalledTimes(3);
    expect(harness.gains[1].gain.value).toBe(0.55);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(1);

    await refreshedTap.stop();
  });

  it("closes a detached presentation hub once after its bounded cleanup delay", async () => {
    vi.useFakeTimers();
    const harness = installMediaElementAudioHarness();
    const video = document.createElement("video");
    video.muted = true;
    video.volume = 0.42;
    let connected = true;
    Object.defineProperty(video, "isConnected", { get: () => connected });
    const tap = await createBrowserDecodedAudioTap(video, vi.fn(), {
      muted: true,
      volume: 0.42,
    });

    await tap.stop();
    expect(harness.contexts[0].close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    const disposing = tap.dispose();
    connected = false;
    await vi.advanceTimersByTimeAsync(250);
    await disposing;
    expect(harness.contexts[0].close).toHaveBeenCalledOnce();
    expect(harness.gains[1].disconnect).toHaveBeenCalledOnce();
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.42);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.contexts[0].close).toHaveBeenCalledOnce();
  });

  it("cleans every acquired capture resource without masking the setup failure", async () => {
    const moduleFailure = new Error("worklet module failed");
    const closeFailure = new Error("context close failed");
    const close = vi.fn().mockRejectedValue(closeFailure);
    const revokeObjectURL = vi.fn();

    class FakeAudioContext {
      state = "running" as AudioContextState;
      audioWorklet = { addModule: vi.fn().mockRejectedValue(moduleFailure) };
      close = close;
    }

    vi.stubGlobal("AudioContext", FakeAudioContext);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:failed-worklet");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
    const video = document.createElement("video");
    video.muted = true;
    video.volume = 0.41;

    await expect(
      createBrowserDecodedAudioTap(video, vi.fn(), { muted: true, volume: 0.41 })
    ).rejects.toBe(moduleFailure);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.41);
  });
});

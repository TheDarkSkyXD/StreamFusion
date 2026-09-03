import localAudioCaptureWorkletUrl from "./local-audio-capture-worklet.js?url&no-inline";
import { i18n } from "@/i18n";

const DEFAULT_TARGET_SAMPLE_RATE = 16_000;
const DEFAULT_BATCH_SAMPLE_COUNT = 3_200;

export interface RawDecodedAudioChunk {
  channels: readonly Float32Array[];
  inputSampleRate: number;
  mediaTime: number;
}

export interface LocalAudioCaptureBatch {
  mediaKey: string;
  generation: number;
  mediaTime: number;
  sampleRate: number;
  pcm: Float32Array;
  rms: number;
}

export interface DecodedAudioTap {
  diagnostic?(): string;
  setPresentation(muted: boolean, volume: number): void;
  stop(): void | Promise<void>;
  dispose(): void | Promise<void>;
}

export type DecodedAudioTapFactory = (
  video: HTMLVideoElement,
  onChunk: (chunk: RawDecodedAudioChunk) => void,
  presentation: UserAudioPresentation
) => Promise<DecodedAudioTap>;

interface UserAudioPresentation {
  muted: boolean;
  volume: number;
}

interface PresentationHub {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  presentationGain: GainNode;
  presentation: UserAudioPresentation;
  presentationOwner: number;
  activeTaps: number;
  cleanupTimer: number | null;
  closed: boolean;
  resume(): void;
}

interface AnalysisBranch {
  worklet: AudioWorkletNode;
  zeroGain: GainNode;
}

interface InitialHubBuild {
  hub: PresentationHub;
  analysis: AnalysisBranch;
}

const presentationHubs = new WeakMap<HTMLVideoElement, PresentationHub>();
const presentationHubCreations = new WeakMap<HTMLVideoElement, Promise<InitialHubBuild>>();
const tapSequences = new WeakMap<HTMLVideoElement, number>();
const HUB_CLEANUP_DELAY_MS = 250;

function clampPresentation(presentation: UserAudioPresentation): UserAudioPresentation {
  return {
    muted: presentation.muted,
    volume: Math.max(0, Math.min(1, presentation.volume)),
  };
}

function disconnect(node: AudioNode | null, destination?: AudioNode): void {
  try {
    if (destination) node?.disconnect(destination);
    else node?.disconnect();
  } catch {
    // Construction and teardown can encounter nodes that never connected.
  }
}

async function closeContext(context: AudioContext): Promise<void> {
  if (context.state === "closed") return;
  try {
    await context.close();
  } catch {
    // Cleanup must not hide the setup error or reject component teardown.
  }
}

function createAnalysisBranch(context: AudioContext): AnalysisBranch {
  let worklet: AudioWorkletNode | null = null;
  let zeroGain: GainNode | null = null;
  try {
    worklet = new AudioWorkletNode(context, "streamfusion-decoded-audio", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    zeroGain = context.createGain();
    zeroGain.gain.value = 0;
    worklet.connect(zeroGain);
    zeroGain.connect(context.destination);
    return { worklet, zeroGain };
  } catch (error) {
    disconnect(worklet);
    disconnect(zeroGain);
    try {
      worklet?.port.close();
    } catch {
      // The worklet may not have finished constructing its message port.
    }
    throw error;
  }
}

function applyPresentation(
  hub: PresentationHub,
  owner: number,
  presentation: UserAudioPresentation
): void {
  if (owner < hub.presentationOwner) return;
  hub.presentationOwner = owner;
  hub.presentation = clampPresentation(presentation);
  hub.presentationGain.gain.value = hub.presentation.muted ? 0 : hub.presentation.volume;
  hub.resume();
}

function scheduleHubDisposal(video: HTMLVideoElement, hub: PresentationHub): void {
  if (hub.cleanupTimer !== null || hub.closed) return;
  // timer-allowlist: lets React detach a player before closing its shared audio graph
  hub.cleanupTimer = window.setTimeout(() => {
    hub.cleanupTimer = null;
    if (
      video.isConnected ||
      hub.closed ||
      presentationHubs.get(video) !== hub ||
      hub.activeTaps > 0
    )
      return;
    hub.closed = true;
    presentationHubs.delete(video);
    document.removeEventListener("pointerdown", hub.resume, true);
    document.removeEventListener("keydown", hub.resume, true);
    video.removeEventListener("playing", hub.resume);
    video.muted = hub.presentation.muted;
    video.volume = hub.presentation.volume;
    disconnect(hub.source);
    disconnect(hub.presentationGain);
    void closeContext(hub.context);
  }, HUB_CLEANUP_DELAY_MS);
}

async function buildPresentationHub(
  video: HTMLVideoElement,
  presentation: UserAudioPresentation,
  owner: number
): Promise<InitialHubBuild> {
  const originalMuted = video.muted;
  const originalVolume = video.volume;
  const context = new AudioContext({ latencyHint: "interactive" });
  let analysis: AnalysisBranch | null = null;
  let presentationGain: GainNode | null = null;
  let source: MediaElementAudioSourceNode | null = null;

  try {
    await context.audioWorklet.addModule(localAudioCaptureWorkletUrl);
    analysis = createAnalysisBranch(context);
    presentationGain = context.createGain();
    const initialPresentation = clampPresentation(presentation);
    presentationGain.gain.value = initialPresentation.muted ? 0 : initialPresentation.volume;
    presentationGain.connect(context.destination);
    source = context.createMediaElementSource(video);
    source.connect(analysis.worklet);
    source.connect(presentationGain);

    const hub: PresentationHub = {
      context,
      source,
      presentationGain,
      presentation: initialPresentation,
      presentationOwner: owner,
      activeTaps: 0,
      cleanupTimer: null,
      closed: false,
      resume: () => {
        if (context.state === "suspended") void context.resume().catch(() => undefined);
      },
    };
    presentationHubs.set(video, hub);
    document.addEventListener("pointerdown", hub.resume, true);
    document.addEventListener("keydown", hub.resume, true);
    video.addEventListener("playing", hub.resume);
    video.muted = false;
    video.volume = 1;
    hub.resume();
    return { hub, analysis };
  } catch (error) {
    disconnect(source);
    disconnect(presentationGain);
    if (analysis) {
      disconnect(analysis.worklet);
      disconnect(analysis.zeroGain);
      try {
        analysis.worklet.port.close();
      } catch {
        // The worklet may already have terminated with its context.
      }
    }
    video.muted = originalMuted;
    video.volume = originalVolume;
    await closeContext(context);
    throw error;
  }
}

async function createAnalysisForHub(hub: PresentationHub): Promise<AnalysisBranch> {
  const analysis = createAnalysisBranch(hub.context);
  try {
    hub.source.connect(analysis.worklet);
    return analysis;
  } catch (error) {
    disconnect(analysis.worklet);
    disconnect(analysis.zeroGain);
    try {
      analysis.worklet.port.close();
    } catch {
      // Preserve the source-connection error.
    }
    throw error;
  }
}

/** Tap decoded media audio while the shared hub remains the only audible path. */
export async function createBrowserDecodedAudioTap(
  video: HTMLVideoElement,
  onChunk: (chunk: RawDecodedAudioChunk) => void,
  requestedPresentation: UserAudioPresentation
): Promise<DecodedAudioTap> {
  const owner = (tapSequences.get(video) ?? 0) + 1;
  tapSequences.set(video, owner);
  let hub = presentationHubs.get(video);
  let analysis: AnalysisBranch;

  if (hub) {
    if (hub.cleanupTimer !== null) window.clearTimeout(hub.cleanupTimer);
    hub.cleanupTimer = null;
    try {
      analysis = await createAnalysisForHub(hub);
    } catch (error) {
      if (hub.activeTaps === 0) scheduleHubDisposal(video, hub);
      throw error;
    }
  } else {
    const pendingHub = presentationHubCreations.get(video);
    if (pendingHub) {
      hub = (await pendingHub).hub;
      try {
        analysis = await createAnalysisForHub(hub);
      } catch (error) {
        if (hub.activeTaps === 0) scheduleHubDisposal(video, hub);
        throw error;
      }
    } else {
      const build = buildPresentationHub(video, requestedPresentation, owner);
      presentationHubCreations.set(video, build);
      try {
        const built = await build;
        hub = built.hub;
        analysis = built.analysis;
      } finally {
        presentationHubCreations.delete(video);
      }
    }
  }

  applyPresentation(hub, owner, requestedPresentation);
  hub.activeTaps += 1;
  let stopped = false;
  analysis.worklet.port.onmessage = (event: MessageEvent<{ pcm?: Float32Array }>) => {
    if (stopped || !event.data.pcm) return;
    onChunk({
      channels: [event.data.pcm],
      inputSampleRate: hub.context.sampleRate,
      mediaTime: video.currentTime,
    });
  };

  const stopAnalysis = () => {
    if (stopped) return;
    stopped = true;
    analysis.worklet.port.onmessage = null;
    try {
      analysis.worklet.port.postMessage({ type: "stop" });
    } catch {
      // The port can already be gone if Chromium stopped the worklet.
    }
    disconnect(hub.source, analysis.worklet);
    disconnect(analysis.worklet);
    disconnect(analysis.zeroGain);
    try {
      analysis.worklet.port.close();
    } catch {
      // The worklet may already have terminated with its context.
    }
    hub.activeTaps = Math.max(0, hub.activeTaps - 1);
  };

  return {
    diagnostic: () => `worklet ctx-${hub.context.state} media-element`,
    setPresentation(muted, volume) {
      applyPresentation(hub, owner, { muted, volume });
    },
    stop: stopAnalysis,
    dispose() {
      stopAnalysis();
      if (hub.activeTaps === 0) scheduleHubDisposal(video, hub);
    },
  };
}

interface LocalAudioCaptureControllerOptions {
  tapFactory?: DecodedAudioTapFactory;
  onBatch: (batch: LocalAudioCaptureBatch) => void;
  batchSampleCount?: number;
  targetSampleRate?: number;
  initialPresentation?: UserAudioPresentation;
}

function calculateRms(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let sumOfSquares = 0;
  for (const sample of pcm) sumOfSquares += sample * sample;
  return Math.sqrt(sumOfSquares / pcm.length);
}

export class LocalAudioCaptureController {
  private readonly tapFactory: DecodedAudioTapFactory;
  private readonly targetSampleRate: number;
  private readonly batchSampleCount: number;
  private readonly onBatch: (batch: LocalAudioCaptureBatch) => void;
  private presentation: UserAudioPresentation;
  private generation = 0;
  private tap: DecodedAudioTap | null = null;
  private readonly ownedTaps = new Set<DecodedAudioTap>();

  constructor(options: LocalAudioCaptureControllerOptions) {
    this.tapFactory = options.tapFactory ?? createBrowserDecodedAudioTap;
    this.targetSampleRate = options.targetSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE;
    this.batchSampleCount = options.batchSampleCount ?? DEFAULT_BATCH_SAMPLE_COUNT;
    this.onBatch = options.onBatch;
    this.presentation = {
      muted: options.initialPresentation?.muted ?? false,
      volume: Math.max(0, Math.min(1, options.initialPresentation?.volume ?? 1)),
    };
  }

  get diagnostic(): string {
    return this.tap?.diagnostic?.() ?? "tap-ready";
  }

  setPresentation(muted: boolean, volume: number): void {
    this.presentation = { muted, volume: Math.max(0, Math.min(1, volume)) };
    this.tap?.setPresentation(this.presentation.muted, this.presentation.volume);
  }

  async bind(video: HTMLVideoElement, mediaKey: string): Promise<number> {
    const generation = ++this.generation;
    const previousTap = this.tap;
    this.tap = null;
    await previousTap?.stop();
    if (generation !== this.generation) return generation;

    let mediaTime = video.currentTime;
    let resampler: ContinuousMonoResampler | null = null;
    const batcher = new PcmBatcher(this.batchSampleCount, (pcm) => {
      if (generation !== this.generation) return;
      this.onBatch({
        mediaKey,
        generation,
        mediaTime,
        sampleRate: this.targetSampleRate,
        pcm,
        rms: calculateRms(pcm),
      });
    });

    const tap = await this.tapFactory(
      video,
      (chunk) => {
        if (generation !== this.generation) return;
        mediaTime = chunk.mediaTime;
        resampler ??= new ContinuousMonoResampler(chunk.inputSampleRate, this.targetSampleRate);
        if (resampler.inputSampleRate !== chunk.inputSampleRate) {
          throw new Error(i18n.t("playback.decodedAudioRateChanged"));
        }
        batcher.push(resampler.push(chunk.channels));
      },
      this.presentation
    );
    this.ownedTaps.add(tap);

    if (generation !== this.generation) {
      await tap.stop();
    } else {
      try {
        tap.setPresentation(this.presentation.muted, this.presentation.volume);
        this.tap = tap;
      } catch (error) {
        await tap.stop();
        throw error;
      }
    }
    return generation;
  }

  async stop(): Promise<void> {
    ++this.generation;
    const tap = this.tap;
    this.tap = null;
    await tap?.stop();
  }

  async dispose(): Promise<void> {
    await this.stop();
    const taps = [...this.ownedTaps];
    this.ownedTaps.clear();
    await Promise.all(taps.map((tap) => tap.dispose()));
  }
}

export class PcmBatcher {
  private readonly pending: Float32Array;
  private pendingLength = 0;

  constructor(
    readonly batchSampleCount: number,
    private readonly emit: (pcm: Float32Array) => void
  ) {
    if (!Number.isInteger(batchSampleCount) || batchSampleCount <= 0) {
      throw new RangeError(i18n.t("playback.invalidAudioBatchSize"));
    }
    this.pending = new Float32Array(batchSampleCount);
  }

  get pendingSampleCount(): number {
    return this.pendingLength;
  }

  push(pcm: Float32Array): void {
    let sourceOffset = 0;
    while (sourceOffset < pcm.length) {
      const copyLength = Math.min(
        this.batchSampleCount - this.pendingLength,
        pcm.length - sourceOffset
      );
      this.pending.set(pcm.subarray(sourceOffset, sourceOffset + copyLength), this.pendingLength);
      this.pendingLength += copyLength;
      sourceOffset += copyLength;

      if (this.pendingLength === this.batchSampleCount) {
        this.emit(this.pending.slice());
        this.pendingLength = 0;
      }
    }
  }

  reset(): void {
    this.pendingLength = 0;
  }
}

/** Stateful area-average downsampler whose output clock survives chunk boundaries. */
export class ContinuousMonoResampler {
  readonly inputSampleRate: number;
  readonly outputSampleRate: number;
  private readonly inputSamplesPerOutput: number;
  private inputPosition = 0;
  private nextOutputBoundary: number;
  private weightedSum = 0;
  private accumulatedWeight = 0;

  constructor(inputSampleRate: number, outputSampleRate = DEFAULT_TARGET_SAMPLE_RATE) {
    if (inputSampleRate < outputSampleRate || outputSampleRate <= 0) {
      throw new RangeError(i18n.t("playback.unsupportedAudioSampleRate"));
    }
    this.inputSampleRate = inputSampleRate;
    this.outputSampleRate = outputSampleRate;
    this.inputSamplesPerOutput = inputSampleRate / outputSampleRate;
    this.nextOutputBoundary = this.inputSamplesPerOutput;
  }

  push(channels: readonly Float32Array[]): Float32Array {
    if (channels.length === 0 || channels[0].length === 0) return new Float32Array();
    const sourceLength = Math.min(...channels.map((channel) => channel.length));
    const output: number[] = [];

    for (let sourceIndex = 0; sourceIndex < sourceLength; sourceIndex += 1) {
      let mono = 0;
      for (const channel of channels) mono += channel[sourceIndex];
      mono /= channels.length;

      let samplePosition = this.inputPosition;
      const sampleEnd = this.inputPosition + 1;
      while (samplePosition < sampleEnd) {
        const overlapEnd = Math.min(sampleEnd, this.nextOutputBoundary);
        const weight = overlapEnd - samplePosition;
        this.weightedSum += mono * weight;
        this.accumulatedWeight += weight;
        samplePosition = overlapEnd;

        if (Math.abs(samplePosition - this.nextOutputBoundary) < 1e-9) {
          output.push(this.weightedSum / this.accumulatedWeight);
          this.weightedSum = 0;
          this.accumulatedWeight = 0;
          this.nextOutputBoundary += this.inputSamplesPerOutput;
        }
      }
      this.inputPosition = sampleEnd;
    }

    return Float32Array.from(output);
  }
}

export function resampleMonoPcm(
  channels: readonly Float32Array[],
  inputSampleRate: number,
  outputSampleRate = DEFAULT_TARGET_SAMPLE_RATE
): Float32Array {
  return new ContinuousMonoResampler(inputSampleRate, outputSampleRate).push(channels);
}

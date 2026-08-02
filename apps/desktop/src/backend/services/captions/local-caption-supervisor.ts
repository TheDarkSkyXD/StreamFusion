import type {
  LocalCaptionPcmChunk,
  LocalCaptionRecognizerState,
  LocalCaptionResult,
} from "@/shared/local-caption-types";

export interface CaptionUtilityProcess {
  postMessage(message: unknown): void;
  kill(): void;
  on(event: "message" | "exit", listener: (...args: unknown[]) => void): this;
}

export interface LocalCaptionLease {
  sessionId: string;
  generation: number;
  modelPath: string;
}

interface LocalCaptionSupervisorOptions {
  spawn: () => CaptionUtilityProcess;
  maxInFlightChunks?: number;
  onResult?: (result: LocalCaptionResult) => void;
  onState?: (state: LocalCaptionRecognizerState) => void;
}

interface ActiveCaptionLease extends LocalCaptionLease {
  child: CaptionUtilityProcess;
}

export class LocalCaptionSupervisor {
  private active: ActiveCaptionLease | null = null;
  private readonly inFlightSequences = new Set<number>();
  private lastSequence = 0;

  constructor(private readonly options: LocalCaptionSupervisorOptions) {}

  start(lease: LocalCaptionLease): void {
    if (this.active) {
      this.options.onState?.({
        type: "state",
        sessionId: this.active.sessionId,
        generation: this.active.generation,
        phase: "error",
        error: "Local captions were started in another player. Retry to reclaim captions.",
      });
    }
    this.stopActive();
    const child = this.options.spawn();
    this.active = { ...lease, child };
    this.inFlightSequences.clear();
    this.lastSequence = 0;
    child.on("message", (message) => this.handleMessage(child, message));
    child.on("exit", () => this.handleExit(child));
    child.postMessage({ type: "start", ...lease });
  }

  pushAudio(chunk: LocalCaptionPcmChunk): boolean {
    const active = this.active;
    const maxInFlightChunks = this.options.maxInFlightChunks ?? 2;
    if (!active) return false;
    if (chunk.sessionId !== active.sessionId || chunk.generation !== active.generation)
      return false;
    if (chunk.sequence <= this.lastSequence) return false;
    if (chunk.sampleRate !== 16_000 || !Number.isFinite(chunk.mediaTime)) return false;
    if (!(chunk.samples instanceof ArrayBuffer) || chunk.samples.byteLength / 4 > 32_000)
      return false;
    if (this.inFlightSequences.size >= maxInFlightChunks) return false;

    this.lastSequence = chunk.sequence;
    this.inFlightSequences.add(chunk.sequence);
    active.child.postMessage({ type: "audio", ...chunk });
    return true;
  }

  stop(identity: { sessionId: string; generation: number }): boolean {
    if (
      !this.active ||
      identity.sessionId !== this.active.sessionId ||
      identity.generation !== this.active.generation
    ) {
      return false;
    }
    this.stopActive();
    return true;
  }

  dispose(): void {
    this.stopActive();
  }

  private handleMessage(child: CaptionUtilityProcess, message: unknown): void {
    if (!message || typeof message !== "object") return;
    const candidate = message as {
      type?: unknown;
      sessionId?: unknown;
      generation?: unknown;
      sequence?: number;
    };
    const active = this.active;
    if (!active || active.child !== child) return;
    if (candidate.sessionId !== active.sessionId || candidate.generation !== active.generation)
      return;

    if (candidate.type === "ack" && typeof candidate.sequence === "number") {
      this.inFlightSequences.delete(candidate.sequence);
      return;
    }
    if (candidate.type === "result") {
      this.options.onResult?.(message as LocalCaptionResult);
    }
    if (candidate.type === "state") this.options.onState?.(message as LocalCaptionRecognizerState);
  }

  private stopActive(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    this.inFlightSequences.clear();
    this.lastSequence = 0;
    active.child.postMessage({ type: "stop", sessionId: active.sessionId });
    active.child.kill();
  }

  private handleExit(child: CaptionUtilityProcess): void {
    const active = this.active;
    if (!active || active.child !== child) return;
    this.active = null;
    this.inFlightSequences.clear();
    this.lastSequence = 0;
    this.options.onState?.({
      type: "state",
      sessionId: active.sessionId,
      generation: active.generation,
      phase: "error",
      error: "Local caption recognizer stopped unexpectedly. Retry local captions.",
    });
  }
}

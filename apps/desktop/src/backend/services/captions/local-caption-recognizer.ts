import type { LocalCaptionPcmChunk, LocalCaptionResult } from "@/shared/local-caption-types";

interface SherpaOnlineStream {
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void;
  inputFinished(): void;
}

interface SherpaOnlineResult {
  text?: string;
  tokens?: string[];
  timestamps?: number[];
  is_final?: boolean;
}

export interface SherpaOnlineRecognizer {
  createStream(): SherpaOnlineStream;
  isReady(stream: SherpaOnlineStream): boolean;
  decode(stream: SherpaOnlineStream): void;
  isEndpoint(stream: SherpaOnlineStream): boolean;
  reset(stream: SherpaOnlineStream): void;
  getResult(stream: SherpaOnlineStream): SherpaOnlineResult;
}

type RecognizerOutput =
  | LocalCaptionResult
  | { type: "ack"; sessionId: string; generation: number; sequence: number };

interface ActiveSession {
  sessionId: string;
  generation: number;
  stream: SherpaOnlineStream;
  mediaClockOffset: number | null;
  lastText: string;
  cueNumber: number;
  revision: number;
}

function timestampedWords(
  result: SherpaOnlineResult,
  mediaClockOffset: number,
  mediaTime: number
): LocalCaptionResult["words"] {
  const tokens = result.tokens ?? [];
  const timestamps = result.timestamps ?? [];
  if (tokens.length === 0 || tokens.length !== timestamps.length) return [];

  const words: Array<{ text: string; startTime: number; endTime: number }> = [];
  for (let index = 0; index < tokens.length; index++) {
    const rawToken = tokens[index];
    const startsWord = rawToken.startsWith("\u2581") || /^[\t\n\v\f\r ]/.test(rawToken);
    const tokenText = rawToken.replace(/^\u2581/, "").trim();
    if (!tokenText) continue;
    const startTime = mediaClockOffset + timestamps[index];
    if (!Number.isFinite(startTime)) return [];
    const nextTimestamp = timestamps.slice(index + 1).find(Number.isFinite);
    const endTime = nextTimestamp === undefined ? mediaTime : mediaClockOffset + nextTimestamp;

    if (!startsWord && words.length > 0) {
      const currentWord = words[words.length - 1];
      currentWord.text += tokenText;
      currentWord.endTime = Math.max(currentWord.startTime, endTime);
      continue;
    }
    words.push({ text: tokenText, startTime, endTime: Math.max(startTime, endTime) });
  }
  return words;
}

export class LocalCaptionRecognizer {
  private active: ActiveSession | null = null;

  constructor(
    private readonly recognizer: SherpaOnlineRecognizer,
    private readonly emit: (message: RecognizerOutput) => void
  ) {}

  start(identity: { sessionId: string; generation: number }): void {
    this.active = {
      ...identity,
      stream: this.recognizer.createStream(),
      mediaClockOffset: null,
      lastText: "",
      cueNumber: 1,
      revision: 0,
    };
  }

  acceptAudio(chunk: LocalCaptionPcmChunk): void {
    const active = this.active;
    if (!active || chunk.sessionId !== active.sessionId || chunk.generation !== active.generation) {
      return;
    }

    const samples = new Float32Array(chunk.samples);
    active.mediaClockOffset ??= chunk.mediaTime - samples.length / chunk.sampleRate;
    active.stream.acceptWaveform({ samples, sampleRate: chunk.sampleRate });

    let decodeCount = 0;
    while (this.recognizer.isReady(active.stream) && decodeCount < 64) {
      this.recognizer.decode(active.stream);
      decodeCount += 1;
    }

    const result = this.recognizer.getResult(active.stream);
    const text = result.text?.trim() ?? "";
    const endpoint = this.recognizer.isEndpoint(active.stream);
    let finalized = false;
    if (text && (text !== active.lastText || endpoint || result.is_final)) {
      active.lastText = text;
      active.revision += 1;
      finalized = !!result.is_final || endpoint;
      this.emit({
        type: "result",
        sessionId: chunk.sessionId,
        generation: chunk.generation,
        sequence: chunk.sequence,
        mediaTime: chunk.mediaTime,
        cueId: `${chunk.sessionId}:${chunk.generation}:${active.cueNumber}`,
        revision: active.revision,
        text,
        isFinal: finalized,
        words: timestampedWords(result, active.mediaClockOffset, chunk.mediaTime),
      });
    }

    if (endpoint) {
      this.recognizer.reset(active.stream);
      active.mediaClockOffset = chunk.mediaTime;
      active.lastText = "";
    }
    if (finalized || (endpoint && !text)) {
      active.cueNumber += 1;
      active.revision = 0;
    }
    this.emit({
      type: "ack",
      sessionId: chunk.sessionId,
      generation: chunk.generation,
      sequence: chunk.sequence,
    });
  }
}

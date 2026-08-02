declare module "sherpa-onnx-node" {
  export interface OnlineRecognizerResult {
    text?: string;
    tokens?: string[];
    timestamps?: number[];
    is_final?: boolean;
  }

  export interface OnlineStream {
    acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void;
    inputFinished(): void;
  }

  export class OnlineRecognizer {
    constructor(config: Record<string, unknown>);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    isEndpoint(stream: OnlineStream): boolean;
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): OnlineRecognizerResult;
  }
}

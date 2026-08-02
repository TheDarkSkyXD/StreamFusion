export type LocalCaptionModelPhase = "not-installed" | "downloading" | "ready" | "integrity-error";

export interface LocalCaptionModelState {
  phase: LocalCaptionModelPhase;
  languageLabel: string;
  languageTag: string;
  downloadBytes: number;
  installedBytes: number;
  displaySize: string;
  license: string;
  sourceName: string;
  sourceUrl: string;
  downloadedBytes?: number;
  error?: string;
}

export const DEFAULT_LOCAL_CAPTION_MODEL_STATE: LocalCaptionModelState = {
  phase: "not-installed",
  languageLabel: "English",
  languageTag: "en",
  downloadBytes: 45_202_074,
  installedBytes: 45_202_074,
  displaySize: "43.11 MiB",
  license: "Apache-2.0",
  sourceName: "Hugging Face",
  sourceUrl: "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17",
  downloadedBytes: 0,
};

export interface LocalCaptionSessionIdentity {
  sessionId: string;
  generation: number;
}

export interface LocalCaptionSequencedIdentity extends LocalCaptionSessionIdentity {
  sequence: number;
  mediaTime: number;
}

export interface LocalCaptionPcmChunk extends LocalCaptionSequencedIdentity {
  sampleRate: 16_000;
  samples: ArrayBuffer;
}

export interface LocalCaptionWord {
  text: string;
  startTime: number;
  endTime: number;
}

export interface LocalCaptionResult extends LocalCaptionSequencedIdentity {
  type: "result";
  cueId: string;
  revision: number;
  text: string;
  isFinal: boolean;
  words: LocalCaptionWord[];
}

export type LocalCaptionRecognizerPhase = "starting" | "ready" | "error" | "stopped";

export interface LocalCaptionRecognizerState {
  type: "state";
  sessionId: string;
  generation: number;
  phase: LocalCaptionRecognizerPhase;
  error?: string;
}

export type LocalCaptionActionResult = { success: true } | { success: false; error: string };

export type LocalCaptionModelActionResult =
  | { success: true; state: LocalCaptionModelState }
  | { success: false; error: string; state?: LocalCaptionModelState };

export interface LocalCaptionAudioPushResult {
  accepted: boolean;
}

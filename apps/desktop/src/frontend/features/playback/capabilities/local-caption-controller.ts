import type {
  LocalCaptionActionResult,
  LocalCaptionAudioPushResult,
  LocalCaptionModelActionResult,
  LocalCaptionModelState,
  LocalCaptionPcmChunk,
  LocalCaptionRecognizerState,
  LocalCaptionResult,
} from "@shared/local-caption-types";

export interface LocalCaptionController {
  localCaptions: {
    getModelState: () => Promise<LocalCaptionModelState>;
    downloadModel: () => Promise<LocalCaptionModelActionResult>;
    cancelModelDownload: () => Promise<LocalCaptionActionResult>;
    removeModel: () => Promise<LocalCaptionModelActionResult>;
    start: (sessionId: string, generation: number) => Promise<LocalCaptionActionResult>;
    pushAudio: (chunk: LocalCaptionPcmChunk) => Promise<LocalCaptionAudioPushResult>;
    stop: (sessionId: string, generation: number) => Promise<LocalCaptionActionResult>;
    onModelState: (callback: (state: LocalCaptionModelState) => void) => () => void;
    onRecognizerState: (callback: (state: LocalCaptionRecognizerState) => void) => () => void;
    onResult: (callback: (result: LocalCaptionResult) => void) => () => void;
  };
}

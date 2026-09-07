import type {
  LoadStreamPayload,
  SlotBufferConfig,
  SlotQualityConfig,
} from "./slot-types";

export interface SlotCrashedPayload {
  slotId: string;
  reason: string;
}

export interface SlotMetricsPayload {
  slotId: string;
  rss?: number;
  heap?: number;
}

export interface SlotPlaybackEventPayload {
  slotId: string;
  type: "playing" | "stalled" | "buffering" | "ended" | "error";
  details?: string;
}

/** The narrow API exposed by the StreamSlot WebContentsView preload. */
export interface SlotAPI {
  onLoadStream(
    callback: (payload: { slotId: string; payload: LoadStreamPayload }) => void
  ): () => void;
  onSetMute(callback: (payload: { slotId: string; muted: boolean }) => void): () => void;
  onSetQuality(
    callback: (payload: { slotId: string; config: SlotQualityConfig }) => void
  ): () => void;
  onSetBufferConfig(
    callback: (payload: { slotId: string; config: SlotBufferConfig }) => void
  ): () => void;
  onUnload(callback: (payload: { slotId: string }) => void): () => void;
  reportCrash(payload: SlotCrashedPayload): void;
  reportMetrics(payload: SlotMetricsPayload): void;
  reportPlaybackEvent(payload: SlotPlaybackEventPayload): void;
}

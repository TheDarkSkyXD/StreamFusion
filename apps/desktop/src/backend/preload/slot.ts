/**
 * Slot WebContentsView preload — narrow contextBridge surface. Slice 05 of the
 * renderer-OOM PRD (#51, issue #56).
 *
 * Each StreamSlot's WebContentsView loads this preload (production wires it
 * via webcontents-view-factory). It exposes ONLY the slot IPC channels — no
 * broader electronAPI surface. The renderer running inside the WCV is the
 * slot player (HLS.js + a <video>); it has no business reading auth tokens,
 * stream URLs from cache, or any other privileged channel.
 *
 * Security posture (per ADR-0003): sandbox:true, contextIsolation:true,
 * nodeIntegration:false. The bridge below is the only seam.
 */

import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "../../shared/ipc-channels";
import type {
  LoadStreamPayload,
  SlotBufferConfig,
  SlotQualityConfig,
} from "../../shared/slot-types";

/** Payload emitted by the slot back to main on a fatal-shape crash. */
export interface SlotCrashedPayload {
  slotId: string;
  reason: string;
}

/** Per-slot metrics sample. Slice 05 reserves the shape; slice 06+ fills it. */
export interface SlotMetricsPayload {
  slotId: string;
  rss?: number;
  heap?: number;
}

/** Lifecycle event emitted by the slot player. */
export interface SlotPlaybackEventPayload {
  slotId: string;
  type: "playing" | "stalled" | "buffering" | "ended" | "error";
  details?: string;
}

const slotAPI = {
  // ===== Main → slot dispatch =====
  // The slot renderer subscribes to these to drive the embedded player. The
  // returned function is the unsubscribe handle (matches the renderer-side
  // electronAPI.slot.* pattern so the same consumer code can be reused).
  onLoadStream: (
    callback: (payload: { slotId: string; payload: LoadStreamPayload }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { slotId: string; payload: LoadStreamPayload }
    ) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.SLOT_LOAD_STREAM, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SLOT_LOAD_STREAM, handler);
  },
  onSetMute: (callback: (payload: { slotId: string; muted: boolean }) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { slotId: string; muted: boolean }
    ) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.SLOT_SET_MUTE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SLOT_SET_MUTE, handler);
  },
  onSetQuality: (
    callback: (payload: { slotId: string; config: SlotQualityConfig }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { slotId: string; config: SlotQualityConfig }
    ) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.SLOT_SET_QUALITY, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SLOT_SET_QUALITY, handler);
  },
  onSetBufferConfig: (
    callback: (payload: { slotId: string; config: SlotBufferConfig }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { slotId: string; config: SlotBufferConfig }
    ) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.SLOT_SET_BUFFER_CONFIG, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SLOT_SET_BUFFER_CONFIG, handler);
  },
  onUnload: (callback: (payload: { slotId: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { slotId: string }) =>
      callback(payload);
    ipcRenderer.on(IPC_CHANNELS.SLOT_UNLOAD, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SLOT_UNLOAD, handler);
  },

  // ===== Slot → main events =====
  // Fire-and-forget reports. Main wires SLOT_CRASHED into the crash-retry
  // policy in slice 06; SLOT_METRICS feeds the process-monitor log line from
  // slice 02; SLOT_PLAYBACK_EVENT is consumed by slice 07's presence matrix.
  reportCrash: (payload: SlotCrashedPayload): void => {
    ipcRenderer.send(IPC_CHANNELS.SLOT_CRASHED, payload);
  },
  reportMetrics: (payload: SlotMetricsPayload): void => {
    ipcRenderer.send(IPC_CHANNELS.SLOT_METRICS, payload);
  },
  reportPlaybackEvent: (payload: SlotPlaybackEventPayload): void => {
    ipcRenderer.send(IPC_CHANNELS.SLOT_PLAYBACK_EVENT, payload);
  },
};

contextBridge.exposeInMainWorld("slotAPI", slotAPI);

export type SlotAPI = typeof slotAPI;

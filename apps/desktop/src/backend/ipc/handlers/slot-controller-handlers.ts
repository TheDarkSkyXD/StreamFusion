/**
 * Slot-controller IPC bridge. Routes host→main commands (focus, cap,
 * background-quality, rebind) into the slot-controller state machine, and
 * fans out the controller's emitter to the host renderer over
 * webContents.send. Slice 04 of the renderer-OOM PRD (#51).
 *
 * Send guard mirrors platform-health-handlers: never send to a destroyed
 * window / destroyed webContents.
 */

import { type BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type { SlotEvent } from "../../../shared/slot-types";
import {
  getSlotView,
  onSlotEvent,
  setMaxSlots,
  setSlotPresence,
} from "../../api/unified/slot-controller";
import { logger } from "../../logging/logger";

function sendToWebContents(
  webContents: Electron.WebContents | undefined,
  channel: string,
  payload: unknown
): boolean {
  try {
    if (webContents && !webContents.isDestroyed()) {
      webContents.send(channel, payload);
      return true;
    }
  } catch (error) {
    logger.warn("IPC:Slot", "Could not push event", {
      channel,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return false;
}

function sendToWindow(mainWindow: BrowserWindow, channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendToWebContents(mainWindow.webContents, channel, payload);
  }
}

/**
 * True for events that target the slot's player (the WCV when one exists,
 * the host renderer otherwise). Presence transitions and any other
 * informational events stay on the host because slot chrome lives there.
 */
function isDispatchEvent(event: SlotEvent): boolean {
  switch (event.type) {
    case "load-stream":
    case "set-mute":
    case "set-quality":
    case "set-buffer-config":
    case "unload":
      return true;
    case "presence-changed":
      return false;
  }
}

function eventToChannel(event: SlotEvent): string {
  switch (event.type) {
    case "load-stream":
      return IPC_CHANNELS.SLOT_LOAD_STREAM;
    case "set-mute":
      return IPC_CHANNELS.SLOT_SET_MUTE;
    case "set-quality":
      return IPC_CHANNELS.SLOT_SET_QUALITY;
    case "set-buffer-config":
      return IPC_CHANNELS.SLOT_SET_BUFFER_CONFIG;
    case "unload":
      return IPC_CHANNELS.SLOT_UNLOAD;
    case "presence-changed":
      return IPC_CHANNELS.SLOT_PRESENCE_CHANGED;
  }
}

export function registerSlotControllerHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.SLOT_REQUEST_FOCUS, (_event, { slotId }: { slotId: string }) => {
    setSlotPresence(slotId, "focused");
  });

  ipcMain.handle(IPC_CHANNELS.SLOT_SET_MULTIVIEW_CAP, (_event, { cap }: { cap: number }) => {
    setMaxSlots(cap);
  });

  ipcMain.handle(IPC_CHANNELS.SLOT_SET_BACKGROUND_QUALITY, () => {
    // Slice 04 only acknowledges. The persisted value lives in
    // multistream-store on the renderer; slice 08 wires the read path.
  });

  ipcMain.handle(IPC_CHANNELS.SLOT_REBIND_EXISTING_SLOTS, () => {
    // After a host-renderer crash the host calls this to ask main to push the
    // current slot snapshot back. Slice 04 has no per-WCV state to rebind yet;
    // the contract is wired so slice 05+ can fill it in without changing call
    // sites.
  });

  onSlotEvent((event) => {
    const channel = eventToChannel(event);
    if (isDispatchEvent(event)) {
      // Prefer the slot's own WebContentsView when present (slice 05+ path).
      // Fall back to the host renderer when there's no per-slot WCV.
      const view = getSlotView(event.slotId);
      if (view) {
        sendToWebContents(view.webContents, channel, event);
        return;
      }
    }
    sendToWindow(mainWindow, channel, event);
  });

  // Slot → main inbound events. Slice 04 wired the channels; slice 06 will
  // consume `slot:crashed` to drive crash retries, slice 02 already feeds
  // metrics via process-monitor — these are observe-only loggers for now so
  // the per-slot WCV preload can call into them safely from slice 05 onward.
  ipcMain.on(IPC_CHANNELS.SLOT_CRASHED, (_event, payload: unknown) => {
    logger.warn("IPC:Slot", "slot reported crashed", { payload });
  });
  ipcMain.on(IPC_CHANNELS.SLOT_METRICS, (_event, payload: unknown) => {
    logger.debug("IPC:Slot", "slot reported metrics", { payload });
  });
  ipcMain.on(IPC_CHANNELS.SLOT_PLAYBACK_EVENT, (_event, payload: unknown) => {
    logger.debug("IPC:Slot", "slot reported playback event", { payload });
  });

  logger.info("IPC:Slot", "Slot-controller IPC handlers registered");
}

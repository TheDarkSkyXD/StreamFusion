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
import {
  onSlotEvent,
  setMaxSlots,
  setSlotPresence,
} from "../../api/unified/slot-controller";
import { logger } from "../../logging/logger";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type { SlotEvent } from "../../../shared/slot-types";

function sendToWindow(mainWindow: BrowserWindow, channel: string, payload: unknown): void {
  try {
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.webContents &&
      !mainWindow.webContents.isDestroyed()
    ) {
      mainWindow.webContents.send(channel, payload);
    }
  } catch (error) {
    logger.warn("IPC:Slot", "Could not push event", {
      channel,
      error: error instanceof Error ? error.message : String(error),
    });
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
    sendToWindow(mainWindow, eventToChannel(event), event);
  });

  logger.info("IPC:Slot", "Slot-controller IPC handlers registered");
}

/**
 * Slot-controller IPC bridge. Routes host→main commands (focus, playback budget,
 * background-quality, rebind) into the slot-controller state machine, and
 * fans out the controller's emitter to the host renderer over
 * webContents.send. Slice 04 of the renderer-OOM PRD (#51).
 *
 * Send guard mirrors platform-health-handlers: never send to a destroyed
 * window / destroyed webContents.
 */

import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type { LoadStreamPayload, SlotEvent, SlotQualityMode } from "../../../shared/slot-types";
import {
  createSlot,
  destroySlot,
  dispatchLoadStream,
  getSlotView,
  isWcvEnabled,
  onSlotEvent,
  rebindExistingSlots,
  requestSlotRetry,
  setBackgroundQuality,
  setPlaybackBudget,
  setSlotPresence,
} from "../../api/unified/slot-controller";
import { logger } from "../../logging/logger";
import type { MainRendererPort } from "../main-renderer-port";
import { registerLoadedFeatureCleanup } from "../../startup/loaded-feature-cleanup";

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
    case "retry-affordance":
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
    case "retry-affordance":
      return IPC_CHANNELS.SLOT_RETRY_AFFORDANCE;
  }
}

export function registerSlotControllerHandlers(renderer: MainRendererPort): void {
  ipcMain.handle(IPC_CHANNELS.SLOT_REQUEST_FOCUS, (_event, { slotId }: { slotId: string }) => {
    setSlotPresence(slotId, "focused");
  });

  ipcMain.handle(
    IPC_CHANNELS.SLOT_SET_PLAYBACK_BUDGET,
    (_event, { budget }: { budget: number }) => {
      setPlaybackBudget(budget);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SLOT_SET_BACKGROUND_QUALITY,
    (_event, { mode }: { mode: SlotQualityMode }) => {
      // Slice 07: push the user's BackgroundQuality preference into the
      // slot-controller. Every currently-background slot re-emits its config
      // synchronously so the running pickers reconfigure without a reload.
      setBackgroundQuality(mode);
    }
  );

  ipcMain.handle(IPC_CHANNELS.SLOT_IS_WCV_ENABLED, () => isWcvEnabled());

  ipcMain.handle(IPC_CHANNELS.SLOT_REBIND_EXISTING_SLOTS, () => {
    // Slice 06: after a host-renderer crash + reload, the host calls this so
    // main re-emits the current presence snapshot for every slot. The host
    // uses those events to rebuild its slot chrome from scratch.
    rebindExistingSlots();
  });

  ipcMain.handle(IPC_CHANNELS.SLOT_REQUEST_RETRY, (_event, { slotId }: { slotId: string }) => {
    // Slice 06: user clicked the retry overlay after the second crash.
    // Rebuild the slot's WCV + replay the last loadStream payload.
    requestSlotRetry(slotId);
  });

  ipcMain.handle(IPC_CHANNELS.SLOT_CREATE, (_event, { slotId }: { slotId: string }) => {
    // Slice 06: host React grid pushes its multistream-store streams into
    // main so each one gets a WCV.
    createSlot(slotId);
  });

  ipcMain.handle(IPC_CHANNELS.SLOT_DESTROY, (_event, { slotId }: { slotId: string }) => {
    // Slice 06: host React grid pushes removals into main. Tears down the
    // WCV + clears the slot record.
    destroySlot(slotId);
  });

  ipcMain.handle(
    IPC_CHANNELS.SLOT_LOAD_STREAM_REQUEST,
    (_event, { slotId, payload }: { slotId: string; payload: LoadStreamPayload }) => {
      // Slice 06: host resolved the playback URL and pushes the load-stream
      // request down. slot-controller stores it on the slot (for crash
      // recovery replay) and emits the load-stream event which the slot's
      // WCV (or fall-back host renderer) consumes.
      dispatchLoadStream(slotId, payload);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SLOT_SET_BOUNDS,
    (
      _event,
      {
        slotId,
        rect,
      }: {
        slotId: string;
        rect: { x: number; y: number; width: number; height: number };
      }
    ) => {
      // Slice 06: host ResizeObserver pushes the slot's screen rect so
      // main can pin the WCV under the React grid's placeholder div.
      const view = getSlotView(slotId);
      if (!view) return;
      try {
        view.setBounds(rect);
      } catch (error) {
        logger.warn("IPC:Slot", "setBounds failed", {
          slotId,
          rect,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  const unsubscribe = onSlotEvent((event) => {
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
    renderer.send(channel as (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS], event);
  });
  registerLoadedFeatureCleanup("slots:events", unsubscribe);

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

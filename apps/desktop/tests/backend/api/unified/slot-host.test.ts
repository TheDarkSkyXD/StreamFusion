import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetSlotControllerForTests,
  onSlotEvent,
} from "@/backend/api/unified/slot-controller";
import { createSlotHost } from "@/backend/api/unified/slot-host";
import type { SlotEvent } from "@/shared/slot-types";

// Guards: slot-host wraps a single slot. Slice 04 has no WCV yet — slot-host
// just routes player ops through slot-controller's emitter so the host renderer
// can subscribe. Slice 05 will inject the WCV behind the same shape.

beforeEach(() => __resetSlotControllerForTests());

describe("slot-host", () => {
  it("create() registers the slot on the controller", () => {
    const host = createSlotHost("slot-1");
    host.create();
    expect(host.id).toBe("slot-1");
    // Slot exists from the controller's perspective — focused since it's first.
    const events: SlotEvent[] = [];
    onSlotEvent((e) => events.push(e));
    host.dispatch.setMute(true);
    expect(events).toHaveLength(1);
  });

  it("dispatch.loadStream emits a load-stream event for this slot", () => {
    const host = createSlotHost("slot-1");
    host.create();
    const events: SlotEvent[] = [];
    onSlotEvent((e) => events.push(e));
    host.dispatch.loadStream({ platform: "twitch", channelName: "lirik" });
    expect(events).toEqual([
      { type: "load-stream", slotId: "slot-1", payload: { platform: "twitch", channelName: "lirik" } },
    ]);
  });

  it("dispatch.setQuality, setBufferConfig, unload route the slotId through", () => {
    const host = createSlotHost("slot-7");
    host.create();
    const events: SlotEvent[] = [];
    onSlotEvent((e) => events.push(e));
    host.dispatch.setQuality({ mode: "match-source" });
    host.dispatch.setBufferConfig({ maxBufferLengthSec: 30, maxMaxBufferLengthSec: 60, liveSyncDurationCount: 3 });
    host.dispatch.unload();
    expect(events.map((e) => ({ type: e.type, slotId: e.slotId }))).toEqual([
      { type: "set-quality", slotId: "slot-7" },
      { type: "set-buffer-config", slotId: "slot-7" },
      { type: "unload", slotId: "slot-7" },
    ]);
  });

  it("destroy() removes the slot — subsequent dispatch calls are no-ops", () => {
    const host = createSlotHost("slot-1");
    host.create();
    host.destroy();
    const events: SlotEvent[] = [];
    onSlotEvent((e) => events.push(e));
    host.dispatch.setMute(true);
    expect(events).toHaveLength(0);
  });
});

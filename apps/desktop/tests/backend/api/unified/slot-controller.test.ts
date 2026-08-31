import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron so webcontents-view-factory's `app.getAppPath()` / `app.isPackaged`
// + `WebContentsView` references resolve under vitest (no real Chromium).
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => "/test/app",
  },
  WebContentsView: class FakeWebContentsView {
    webContents = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      loadURL: vi.fn(),
    };
    setBounds = vi.fn();
    setVisible = vi.fn();
  },
}));

import {
  __resetSlotControllerForTests,
  createSlot,
  destroySlot,
  dispatchLoadStream,
  dispatchSetBufferConfig,
  dispatchSetMute,
  dispatchSetQuality,
  dispatchUnload,
  getBackgroundQuality,
  getFocusedSlotId,
  getSlotPresence,
  getSlotView,
  onSlotEvent,
  rebindExistingSlots,
  requestSlotRetry,
  setBackgroundQuality,
  setPlaybackBudget,
  setSlotPresence,
  setUseWebContentsViews,
} from "@backend/api/unified/slot-controller";
import type { SlotEvent } from "@shared/slot-types";
import {
  __resetWebContentsViewFactoryForTests,
  setWebContentsViewFactory,
  type SlotView,
} from "@backend/api/unified/webcontents-view-factory";

// Guards: the slot-controller is the single source of truth for slot presence on the main process.
// First created slot is "focused" — multiview always has exactly one focused slot when any slot exists.
// (Slice 04 of the renderer-OOM PRD #51; this test pins the focus-singleton invariant before any WCV lands.)

beforeEach(() => {
  __resetSlotControllerForTests();
  __resetWebContentsViewFactoryForTests();
});

function makeFakeSlotView(): SlotView & {
  __sendCalls: unknown[][];
  __destroyed: boolean;
  __triggerCrash: (reason?: string) => void;
} {
  const sendCalls: unknown[][] = [];
  let destroyed = false;
  let crashCallback: ((details: { reason: string }) => void) | null = null;
  return {
    webContents: {
      send: vi.fn((channel: string, payload: unknown) => sendCalls.push([channel, payload])),
      isDestroyed: vi.fn(() => destroyed),
      close: vi.fn(() => {
        destroyed = true;
      }),
    } as unknown as Electron.WebContents,
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    loadURL: vi.fn(async () => {}),
    onRenderProcessGone: vi.fn((cb) => {
      crashCallback = cb;
      return () => {
        if (crashCallback === cb) crashCallback = null;
      };
    }),
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    get __sendCalls() {
      return sendCalls;
    },
    get __destroyed() {
      return destroyed;
    },
    __triggerCrash(reason = "crashed") {
      crashCallback?.({ reason });
    },
  };
}

describe("slot-controller createSlot", () => {
  it("registers a new slot and makes the first one focused", () => {
    createSlot("slot-1");
    expect(getSlotPresence("slot-1")).toBe("focused");
  });

  it("defaults subsequent slots to background (one focused slot at a time)", () => {
    createSlot("slot-1");
    createSlot("slot-2");
    expect(getSlotPresence("slot-1")).toBe("focused");
    expect(getSlotPresence("slot-2")).toBe("background");
  });

  it("is idempotent on the same id", () => {
    createSlot("slot-1");
    createSlot("slot-1");
    expect(getSlotPresence("slot-1")).toBe("focused");
  });
});

describe("slot-controller setSlotPresence (focus singleton)", () => {
  it("promoting a background slot to focused demotes the previously focused slot", () => {
    createSlot("slot-1");
    createSlot("slot-2");
    setSlotPresence("slot-2", "focused");
    expect(getSlotPresence("slot-1")).toBe("background");
    expect(getSlotPresence("slot-2")).toBe("focused");
    expect(getFocusedSlotId()).toBe("slot-2");
  });

  it("setting a slot to hidden does not demote the focused slot", () => {
    createSlot("slot-1");
    createSlot("slot-2");
    setSlotPresence("slot-2", "hidden");
    expect(getSlotPresence("slot-1")).toBe("focused");
    expect(getSlotPresence("slot-2")).toBe("hidden");
    expect(getFocusedSlotId()).toBe("slot-1");
  });

  it("getFocusedSlotId is null when no slots exist", () => {
    expect(getFocusedSlotId()).toBeNull();
  });

  it("getFocusedSlotId is null when every slot is hidden or background", () => {
    createSlot("slot-1");
    setSlotPresence("slot-1", "hidden");
    expect(getFocusedSlotId()).toBeNull();
  });
});

describe("slot-controller destroySlot", () => {
  it("removes a slot by id", () => {
    createSlot("slot-1");
    destroySlot("slot-1");
    expect(getSlotPresence("slot-1")).toBeUndefined();
  });

  it("is a no-op for an unknown id", () => {
    destroySlot("ghost");
    expect(getSlotPresence("ghost")).toBeUndefined();
  });

  it("destroying the focused slot leaves no slot focused", () => {
    createSlot("slot-1");
    createSlot("slot-2");
    destroySlot("slot-1");
    // Auto-re-promoting another slot is the renderer's policy, not the
    // controller's — controller stays honest about the current state.
    expect(getFocusedSlotId()).toBeNull();
    expect(getSlotPresence("slot-2")).toBe("background");
  });
});

describe("slot-controller concurrent playback budget", () => {
  it("rejects decoder ownership beyond the budget without eviction", () => {
    setPlaybackBudget(2);
    createSlot("slot-1");
    createSlot("slot-2");
    createSlot("slot-3");
    expect(getSlotPresence("slot-1")).toBe("focused");
    expect(getSlotPresence("slot-2")).toBe("background");
    expect(getSlotPresence("slot-3")).toBeUndefined();
  });

  it("raising the budget unblocks new playback slots", () => {
    setPlaybackBudget(1);
    createSlot("slot-1");
    createSlot("slot-2");
    expect(getSlotPresence("slot-2")).toBeUndefined();
    setPlaybackBudget(3);
    createSlot("slot-2");
    expect(getSlotPresence("slot-2")).toBe("background");
  });

  it("lowering the budget does not evict existing playback slots", () => {
    setPlaybackBudget(4);
    createSlot("slot-1");
    createSlot("slot-2");
    createSlot("slot-3");
    setPlaybackBudget(2);
    expect(getSlotPresence("slot-1")).toBe("focused");
    expect(getSlotPresence("slot-2")).toBe("background");
    expect(getSlotPresence("slot-3")).toBe("background");
    // Further decoder ownership is blocked until count is back under budget.
    createSlot("slot-4");
    expect(getSlotPresence("slot-4")).toBeUndefined();
  });
});

describe("slot-controller event fan-out (slice 04 dispatch seam)", () => {
  it("emits a load-stream event when dispatchLoadStream is called", () => {
    createSlot("slot-1");
    const events: unknown[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));
    dispatchLoadStream("slot-1", { platform: "kick", channelName: "xqc" });
    unsubscribe();
    expect(events).toEqual([
      { type: "load-stream", slotId: "slot-1", payload: { platform: "kick", channelName: "xqc" } },
    ]);
  });

  it("emits set-mute, set-quality, set-buffer-config, and unload events", () => {
    createSlot("slot-1");
    const events: unknown[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));
    dispatchSetMute("slot-1", true);
    dispatchSetQuality("slot-1", { mode: "auto-low" });
    dispatchSetBufferConfig("slot-1", {
      maxBufferLengthSec: 10,
      maxMaxBufferLengthSec: 30,
      liveSyncDurationCount: 3,
    });
    dispatchUnload("slot-1");
    unsubscribe();
    expect(events.map((e) => (e as { type: string }).type)).toEqual([
      "set-mute",
      "set-quality",
      "set-buffer-config",
      "unload",
    ]);
  });

  it("emits a presence-changed event when setSlotPresence promotes a slot", () => {
    createSlot("slot-1");
    createSlot("slot-2");
    const events: unknown[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));
    setSlotPresence("slot-2", "focused");
    unsubscribe();
    // Exactly one promotion + one demotion (focus singleton).
    const presenceEvents = events.filter(
      (e) => (e as { type: string }).type === "presence-changed"
    );
    expect(presenceEvents).toHaveLength(2);
    expect(presenceEvents).toContainEqual(
      expect.objectContaining({ slotId: "slot-1", presence: "background" })
    );
    expect(presenceEvents).toContainEqual(
      expect.objectContaining({ slotId: "slot-2", presence: "focused" })
    );
  });

  it("unsubscribe stops receiving events", () => {
    createSlot("slot-1");
    const events: unknown[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));
    unsubscribe();
    dispatchSetMute("slot-1", true);
    expect(events).toHaveLength(0);
  });

  it("dispatch on an unknown slotId is a no-op (no event emitted)", () => {
    const events: unknown[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));
    dispatchSetMute("ghost", true);
    unsubscribe();
    expect(events).toHaveLength(0);
  });
});

describe("slot-controller WebContentsView feature flag (slice 05 plumbing)", () => {
  it("createSlot does NOT spawn a view by default (flag off in production)", () => {
    const created: SlotView[] = [];
    setWebContentsViewFactory({
      create: () => {
        const v = makeFakeSlotView();
        created.push(v);
        return v;
      },
    });
    createSlot("slot-1");
    expect(created).toHaveLength(0);
    expect(getSlotView("slot-1")).toBeNull();
  });

  it("with setUseWebContentsViews(true), createSlot spawns a view via the factory", () => {
    const fakeView = makeFakeSlotView();
    const factory = { create: vi.fn(() => fakeView) };
    setWebContentsViewFactory(factory);

    setUseWebContentsViews(true);
    createSlot("slot-1");

    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(getSlotView("slot-1")).toBe(fakeView);
  });

  it("destroySlot tears down the slot's view if one was spawned", () => {
    const fakeView = makeFakeSlotView();
    setWebContentsViewFactory({ create: () => fakeView });
    setUseWebContentsViews(true);
    createSlot("slot-1");

    destroySlot("slot-1");

    expect(fakeView.destroy).toHaveBeenCalledTimes(1);
    expect(getSlotView("slot-1")).toBeNull();
  });

  it("flag turned off after some slots exist does not retroactively destroy views; further creates skip the factory", () => {
    const fakeView = makeFakeSlotView();
    const factory = { create: vi.fn(() => fakeView) };
    setWebContentsViewFactory(factory);
    setUseWebContentsViews(true);

    createSlot("slot-1");
    expect(getSlotView("slot-1")).toBe(fakeView);

    setUseWebContentsViews(false);
    createSlot("slot-2");
    expect(getSlotView("slot-2")).toBeNull();
    expect(getSlotView("slot-1")).toBe(fakeView); // pre-existing slot's view survives
  });

  it("__resetSlotControllerForTests clears the flag back to off", () => {
    setUseWebContentsViews(true);
    __resetSlotControllerForTests();
    const fakeView = makeFakeSlotView();
    setWebContentsViewFactory({ create: () => fakeView });
    createSlot("slot-1");
    expect(getSlotView("slot-1")).toBeNull();
  });

  it("attaches a render-process-gone listener on the spawned WCV (slice 06 wiring)", () => {
    const fakeView = makeFakeSlotView();
    setWebContentsViewFactory({ create: () => fakeView });
    setUseWebContentsViews(true);
    createSlot("slot-1");
    expect(fakeView.onRenderProcessGone).toHaveBeenCalledTimes(1);
  });

  it("createSlot drives the WCV to load the slot-renderer URL when the flag is on (slice 05 follow-up)", () => {
    const fakeView = makeFakeSlotView();
    const factory = { create: vi.fn(() => fakeView) };
    setWebContentsViewFactory(factory);

    setUseWebContentsViews(true);
    createSlot("slot-1");

    // Factory got a preload path resolved from getSlotPreloadPath().
    expect(factory.create).toHaveBeenCalledWith(
      expect.objectContaining({ preloadPath: expect.stringContaining("preload") })
    );
    // SlotView.loadURL was called with the slot-renderer URL (dev variant
    // from the electron mock — `app.isPackaged=false` + no ELECTRON_RENDERER_URL
    // → file:// path under /test/app/out/renderer/src/frontend/slot-renderer/index.html).
    expect(fakeView.loadURL).toHaveBeenCalledTimes(1);
    const loadedUrl = (fakeView.loadURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(loadedUrl).toMatch(/slot-renderer/);
  });
});

describe("slot-controller crash recovery (slice 06)", () => {
  function setupWithFakeFactory() {
    const created: ReturnType<typeof makeFakeSlotView>[] = [];
    setWebContentsViewFactory({
      create: () => {
        const v = makeFakeSlotView();
        created.push(v);
        return v;
      },
    });
    setUseWebContentsViews(true);
    return { created };
  }

  it("first crash within the window: silently rebuilds the WCV and replays the last loadStream", () => {
    const { created } = setupWithFakeFactory();
    createSlot("slot-1");
    expect(created).toHaveLength(1);
    const initialView = created[0];

    dispatchLoadStream("slot-1", { platform: "kick", channelName: "xqc" });

    const events: unknown[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));

    initialView.__triggerCrash("oom");

    // A new view was spawned, the old one was destroyed.
    expect(created).toHaveLength(2);
    expect(initialView.__destroyed).toBe(true);

    // load-stream replayed onto the new slot lifecycle.
    const replays = events.filter(
      (e) => (e as { type: string; slotId: string }).type === "load-stream"
    );
    expect(replays).toContainEqual(
      expect.objectContaining({
        type: "load-stream",
        slotId: "slot-1",
        payload: { platform: "kick", channelName: "xqc" },
      })
    );

    // No affordance was emitted on the first crash.
    const affordances = events.filter((e) => (e as { type: string }).type === "retry-affordance");
    expect(affordances).toHaveLength(0);

    unsubscribe();
  });

  it("second crash within the window: emits retry-affordance instead of rebuilding silently", () => {
    const { created } = setupWithFakeFactory();
    createSlot("slot-1");
    dispatchLoadStream("slot-1", { platform: "twitch", channelName: "lirik" });

    // First crash → silent retry.
    created[0].__triggerCrash();
    expect(created).toHaveLength(2);

    const events: unknown[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));

    // Second crash within the same window → affordance.
    created[1].__triggerCrash();

    expect(events).toContainEqual(
      expect.objectContaining({ type: "retry-affordance", slotId: "slot-1" })
    );
    // No third view was spawned (the controller waits for the user to click retry).
    expect(created).toHaveLength(2);
    // The dead second view was torn down.
    expect(created[1].__destroyed).toBe(true);
    // Slot record still exists — the host needs it to render the overlay.
    expect(getSlotPresence("slot-1")).toBe("focused");
    expect(getSlotView("slot-1")).toBeNull();

    unsubscribe();
  });

  it("requestSlotRetry rebuilds a slot after the affordance was shown + replays the last stream", () => {
    const { created } = setupWithFakeFactory();
    createSlot("slot-1");
    dispatchLoadStream("slot-1", { platform: "kick", channelName: "moonmoon" });
    created[0].__triggerCrash();
    created[1].__triggerCrash();
    expect(getSlotView("slot-1")).toBeNull();

    const events: unknown[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));

    requestSlotRetry("slot-1");

    expect(created).toHaveLength(3);
    expect(getSlotView("slot-1")).toBe(created[2]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "load-stream",
        slotId: "slot-1",
        payload: { platform: "kick", channelName: "moonmoon" },
      })
    );

    unsubscribe();
  });

  it("requestSlotRetry on a live (un-crashed) slot is a no-op", () => {
    const { created } = setupWithFakeFactory();
    createSlot("slot-1");
    expect(created).toHaveLength(1);

    requestSlotRetry("slot-1");

    expect(created).toHaveLength(1); // No second view spawned.
  });

  it("destroySlot also unsubscribes the crash listener so a late crash callback doesn't rebuild", () => {
    const { created } = setupWithFakeFactory();
    createSlot("slot-1");
    const view = created[0];

    destroySlot("slot-1");
    view.__triggerCrash(); // Should be a no-op now (listener detached).

    // No second view was created.
    expect(created).toHaveLength(1);
    expect(getSlotPresence("slot-1")).toBeUndefined();
  });

  it("hidden→focused transition resurrects the WCV and replays the last loadStream", () => {
    const { created } = setupWithFakeFactory();
    createSlot("slot-1");
    dispatchLoadStream("slot-1", { platform: "kick", channelName: "loltyler1" });
    expect(created).toHaveLength(1);

    setSlotPresence("slot-1", "hidden");
    expect(getSlotView("slot-1")).toBeNull();
    expect(created[0].__destroyed).toBe(true);

    const events: SlotEvent[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));

    setSlotPresence("slot-1", "focused");

    expect(created).toHaveLength(2);
    expect(getSlotView("slot-1")).toBe(created[1]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "load-stream",
        slotId: "slot-1",
        payload: { platform: "kick", channelName: "loltyler1" },
      })
    );

    unsubscribe();
  });

  it("rebindExistingSlots re-emits a presence-changed event for every alive slot", () => {
    const { created } = setupWithFakeFactory();
    createSlot("slot-1");
    createSlot("slot-2");
    expect(created).toHaveLength(2);

    const events: unknown[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));

    rebindExistingSlots();

    const presenceEvents = events.filter(
      (e) => (e as { type: string }).type === "presence-changed"
    );
    expect(presenceEvents).toContainEqual(
      expect.objectContaining({ slotId: "slot-1", presence: "focused" })
    );
    expect(presenceEvents).toContainEqual(
      expect.objectContaining({ slotId: "slot-2", presence: "background" })
    );

    unsubscribe();
  });
});

describe("slot-controller SlotPresence behavior matrix (slice 07)", () => {
  function eventsOfType<T extends SlotEvent["type"]>(events: SlotEvent[], type: T) {
    return events.filter((e) => e.type === type);
  }

  it("getBackgroundQuality defaults to 'auto-low' on a fresh controller", () => {
    expect(getBackgroundQuality()).toBe("auto-low");
  });

  it("setSlotPresence(focused) emits set-mute(false) + set-quality + set-buffer-config", () => {
    createSlot("slot-1");
    createSlot("slot-2");
    // slot-1 is already focused (first created); promote slot-2.
    const events: SlotEvent[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));
    setSlotPresence("slot-2", "focused");

    const slot2Mutes = events.filter((e) => e.type === "set-mute" && e.slotId === "slot-2");
    expect(slot2Mutes).toContainEqual(
      expect.objectContaining({ type: "set-mute", slotId: "slot-2", muted: false })
    );
    // Slot-1 was demoted to background, so it got muted via the cascading
    // emitConfigForSlot call.
    const slot1Mutes = events.filter((e) => e.type === "set-mute" && e.slotId === "slot-1");
    expect(slot1Mutes).toContainEqual(
      expect.objectContaining({ type: "set-mute", slotId: "slot-1", muted: true })
    );

    // Focused slot-2 got a 30s/60s forward/max buffer.
    const slot2Buffers = events.filter(
      (e) => e.type === "set-buffer-config" && e.slotId === "slot-2"
    );
    expect(slot2Buffers[0]).toMatchObject({
      type: "set-buffer-config",
      slotId: "slot-2",
      config: { maxBufferLengthSec: 30 },
    });

    unsubscribe();
  });

  it("setSlotPresence(background) emits muted=true + clamped buffers (10s)", () => {
    createSlot("slot-1");
    createSlot("slot-2");
    const events: SlotEvent[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));
    // slot-2 starts background; transition explicit (no-op for presence, but
    // we instead promote slot-1 stay focused and demote via setSlotPresence
    // path on a new slot creation). Easier: hide then unhide slot-2.
    setSlotPresence("slot-2", "hidden");
    setSlotPresence("slot-2", "background");

    const slot2Buffers = events.filter(
      (e) => e.type === "set-buffer-config" && e.slotId === "slot-2"
    );
    // Last buffer config emitted for slot-2 should be the background tuple.
    const last = slot2Buffers[slot2Buffers.length - 1];
    expect(last).toMatchObject({
      slotId: "slot-2",
      config: { maxBufferLengthSec: 10 },
    });

    unsubscribe();
  });

  it("setSlotPresence(hidden) emits an unload event (no further config events)", () => {
    createSlot("slot-1");
    createSlot("slot-2");
    const events: SlotEvent[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));

    setSlotPresence("slot-2", "hidden");

    const unloads = events.filter((e) => e.type === "unload" && e.slotId === "slot-2");
    expect(unloads).toHaveLength(1);

    // Hidden slots get no quality / buffer dispatch (there's no player).
    const slot2Configs = events.filter(
      (e) => e.slotId === "slot-2" && (e.type === "set-quality" || e.type === "set-buffer-config")
    );
    expect(slot2Configs).toHaveLength(0);

    unsubscribe();
  });

  it("setBackgroundQuality flows the new quality to every currently-background slot live", () => {
    createSlot("slot-1");
    createSlot("slot-2");
    createSlot("slot-3");
    // slot-1 focused, slot-2 + slot-3 background.
    const events: SlotEvent[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));

    setBackgroundQuality("off");

    // Both backgrounds got re-emitted with the new quality.
    const qualityEvents = eventsOfType(events, "set-quality");
    expect(qualityEvents).toContainEqual(
      expect.objectContaining({ slotId: "slot-2", config: { mode: "off" } })
    );
    expect(qualityEvents).toContainEqual(
      expect.objectContaining({ slotId: "slot-3", config: { mode: "off" } })
    );
    // Focused slot did NOT get a re-emit — it's unaffected by the
    // background-quality setting.
    expect(qualityEvents).not.toContainEqual(
      expect.objectContaining({ slotId: "slot-1", config: { mode: "off" } })
    );

    unsubscribe();
  });

  it("setBackgroundQuality with the same value is a no-op (no thrash)", () => {
    createSlot("slot-1");
    createSlot("slot-2");
    const events: SlotEvent[] = [];
    const unsubscribe = onSlotEvent((e) => events.push(e));
    // Default is "auto-low"; re-setting to "auto-low" should emit nothing.
    setBackgroundQuality("auto-low");
    expect(events).toHaveLength(0);
    unsubscribe();
  });
});

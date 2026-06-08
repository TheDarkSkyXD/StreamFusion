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
  getFocusedSlotId,
  getSlotPresence,
  getSlotView,
  onSlotEvent,
  setMaxSlots,
  setSlotPresence,
  setUseWebContentsViews,
} from "@/backend/api/unified/slot-controller";
import {
  __resetWebContentsViewFactoryForTests,
  setWebContentsViewFactory,
  type SlotView,
} from "@/backend/api/unified/webcontents-view-factory";

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
} {
  const sendCalls: unknown[][] = [];
  let destroyed = false;
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
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    get __sendCalls() {
      return sendCalls;
    },
    get __destroyed() {
      return destroyed;
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

describe("slot-controller setMaxSlots (MultiviewCap enforcement)", () => {
  it("rejects createSlot when at the cap — hard stop, no eviction", () => {
    setMaxSlots(2);
    createSlot("slot-1");
    createSlot("slot-2");
    createSlot("slot-3");
    expect(getSlotPresence("slot-1")).toBe("focused");
    expect(getSlotPresence("slot-2")).toBe("background");
    expect(getSlotPresence("slot-3")).toBeUndefined();
  });

  it("raising the cap unblocks new creates", () => {
    setMaxSlots(1);
    createSlot("slot-1");
    createSlot("slot-2");
    expect(getSlotPresence("slot-2")).toBeUndefined();
    setMaxSlots(3);
    createSlot("slot-2");
    expect(getSlotPresence("slot-2")).toBe("background");
  });

  it("lowering the cap does not evict existing slots", () => {
    setMaxSlots(4);
    createSlot("slot-1");
    createSlot("slot-2");
    createSlot("slot-3");
    setMaxSlots(2);
    expect(getSlotPresence("slot-1")).toBe("focused");
    expect(getSlotPresence("slot-2")).toBe("background");
    expect(getSlotPresence("slot-3")).toBe("background");
    // But further creates are blocked until count is back under cap.
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
    dispatchSetBufferConfig("slot-1", { maxBufferLengthSec: 10, maxMaxBufferLengthSec: 30, liveSyncDurationCount: 3 });
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
    const presenceEvents = events.filter((e) => (e as { type: string }).type === "presence-changed");
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
    // → file:// path under /test/app/out/renderer/src/slot-renderer/index.html).
    expect(fakeView.loadURL).toHaveBeenCalledTimes(1);
    const loadedUrl = (fakeView.loadURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(loadedUrl).toMatch(/slot-renderer/);
  });
});

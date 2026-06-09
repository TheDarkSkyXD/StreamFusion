import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron's WebContentsView before importing the factory so the
// production path can construct without a real Chromium. Class-shaped so
// `new WebContentsView(...)` works; calls are tracked via a hoisted array.
const ctorCalls = vi.hoisted(() => ({ args: [] as unknown[][] }));

vi.mock("electron", () => {
  class FakeWebContentsView {
    webContents = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
    };
    setBounds = vi.fn();
    setVisible = vi.fn();
    constructor(opts?: unknown) {
      ctorCalls.args.push([opts]);
    }
  }
  return { WebContentsView: FakeWebContentsView };
});

import {
  __resetWebContentsViewFactoryForTests,
  createDefaultWebContentsViewFactory,
  getWebContentsViewFactory,
  setWebContentsViewFactory,
} from "@/backend/api/unified/webcontents-view-factory";

// Guards: slice 05 of the renderer-OOM PRD (#51, issue #56).
// The factory MUST be injectable so slot-controller tests never spin up real
// Chromium. Production-defaulted WCVs MUST use sandbox+contextIsolation+
// nodeIntegration:false per ADR-0003's security posture.

beforeEach(() => {
  __resetWebContentsViewFactoryForTests();
  ctorCalls.args.length = 0;
});

describe("webcontents-view-factory default factory", () => {
  it("constructs a WebContentsView with sandbox+contextIsolation enabled and nodeIntegration disabled", () => {
    const factory = createDefaultWebContentsViewFactory();
    factory.create({});

    expect(ctorCalls.args).toHaveLength(1);
    const opts = ctorCalls.args[0][0] as { webPreferences?: Record<string, unknown> };
    expect(opts.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
  });

  it("forwards a preloadPath into webPreferences.preload when provided", () => {
    const factory = createDefaultWebContentsViewFactory();
    factory.create({ preloadPath: "/abs/path/preload-slot.js" });

    const opts = ctorCalls.args[0][0] as { webPreferences?: Record<string, unknown> };
    expect(opts.webPreferences?.preload).toBe("/abs/path/preload-slot.js");
  });

  it("returns a SlotView wrapper that surfaces webContents and the lifecycle controls", () => {
    const factory = createDefaultWebContentsViewFactory();
    const view = factory.create({});

    expect(view.webContents).toBeDefined();
    expect(typeof view.setBounds).toBe("function");
    expect(typeof view.setVisible).toBe("function");
    expect(typeof view.destroy).toBe("function");
  });
});

describe("webcontents-view-factory injection seam", () => {
  it("getWebContentsViewFactory returns the default factory until one is injected", () => {
    const f = getWebContentsViewFactory();
    f.create({});
    expect(ctorCalls.args).toHaveLength(1);
  });

  it("setWebContentsViewFactory swaps the factory so tests can inject a fake without touching Chromium", () => {
    const fakeView = {
      webContents: { send: vi.fn(), isDestroyed: vi.fn(() => false), close: vi.fn() },
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      destroy: vi.fn(),
      loadURL: vi.fn(async () => {}),
      onRenderProcessGone: vi.fn(),
    };
    const fakeFactory = { create: vi.fn(() => fakeView) };
    setWebContentsViewFactory(fakeFactory as unknown as Parameters<typeof setWebContentsViewFactory>[0]);

    const view = getWebContentsViewFactory().create({ preloadPath: "ignored.js" });
    expect(view).toBe(fakeView);
    expect(fakeFactory.create).toHaveBeenCalledTimes(1);
    // No real WebContentsView was constructed when the factory was injected.
    expect(ctorCalls.args).toHaveLength(0);
  });

  it("__resetWebContentsViewFactoryForTests restores the default factory", () => {
    const fakeFactory = { create: vi.fn() };
    setWebContentsViewFactory(fakeFactory);
    __resetWebContentsViewFactoryForTests();

    getWebContentsViewFactory().create({});
    expect(fakeFactory.create).not.toHaveBeenCalled();
    expect(ctorCalls.args).toHaveLength(1);
  });
});

/**
 * window-manager.test.ts
 *
 * Live BrowserWindow wiring (debounced state listeners, before-quit final
 * save) is Electron-specific and exercised at runtime, not here. What we CAN
 * pin in unit tests is the pure snapshot formatter — the on-disk shape that
 * downstream log readers and the streamfusion-debug skill grep against.
 */
import { describe, expect, it, vi } from "vitest";

// Electron's `app` reads `__dirname`-style paths at import time; the test
// environment doesn't have a real Electron runtime so stub it shallowly.
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "" },
  BrowserWindow: class {},
  globalShortcut: { register: () => undefined, unregister: () => undefined },
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
    getAllDisplays: () => [],
  },
  shell: { openExternal: async () => undefined },
}));

import { formatWindowStateSnapshot } from "@/backend/window-manager";

describe("formatWindowStateSnapshot", () => {
  it("renders a snapshot as compact JSON in the exact key order the spec mandates", () => {
    const out = formatWindowStateSnapshot({
      bounds: { x: 100, y: 200, width: 1400, height: 900 },
      maximized: false,
      fullscreen: false,
    });
    expect(out).toBe(
      '{"bounds":{"x":100,"y":200,"width":1400,"height":900},"maximized":false,"fullscreen":false}'
    );
  });

  it("preserves boolean state flags", () => {
    const out = formatWindowStateSnapshot({
      bounds: { x: 0, y: 0, width: 1024, height: 768 },
      maximized: true,
      fullscreen: true,
    });
    expect(out).toContain('"maximized":true');
    expect(out).toContain('"fullscreen":true');
  });
});

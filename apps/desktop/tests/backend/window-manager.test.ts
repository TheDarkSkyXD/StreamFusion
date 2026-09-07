/**
 * window-manager.test.ts
 *
 * Live BrowserWindow wiring (debounced state listeners, before-quit final
 * save) is Electron-specific and exercised at runtime, not here. What we CAN
 * pin in unit tests is the pure snapshot formatter — the on-disk shape that
 * downstream log readers and the streamfusion-debug skill grep against.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const appMock = vi.hoisted(() => ({ isPackaged: false, getPath: () => "" }));

// Electron's `app` reads `__dirname`-style paths at import time; the test
// environment doesn't have a real Electron runtime so stub it shallowly.
vi.mock("electron", () => ({
  app: appMock,
  BrowserWindow: class {},
  globalShortcut: { register: () => undefined, unregister: () => undefined },
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
    getAllDisplays: () => [],
  },
  shell: { openExternal: async () => undefined },
}));

import {
  formatWindowStateSnapshot,
  resolveAppIconPath,
  shouldAutoOpenDevTools,
} from "@backend/window-manager";

// Guards: Windows taskbar artwork must survive cleanup of any isolated development build.
// Guards: packaged launches cannot use an inherited development icon override.
describe("resolveAppIconPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    appMock.isPackaged = false;
  });

  it("resolves the real Windows icon from the built main-process directory", () => {
    const builtMainDirectory = path.resolve(__dirname, "../../out/main");
    const iconPath = resolveAppIconPath(builtMainDirectory, "win32");

    expect(path.basename(iconPath)).toBe("icon.ico");
    expect(existsSync(iconPath)).toBe(true);
  });

  it("uses the persistent source icon across isolated development builds", () => {
    const sourceIcon = path.resolve(__dirname, "../../assets/icons/icon.ico");
    vi.stubEnv("STREAMFUSION_DEV_ICON_PATH", sourceIcon);

    for (const run of ["first", "second"]) {
      const mainDirectory = path.resolve(__dirname, `../../.cache/dev-runs/${run}/app/out/main`);
      expect(resolveAppIconPath(mainDirectory, "win32")).toBe(sourceIcon);
    }
    expect(existsSync(sourceIcon)).toBe(true);
  });

  it("ignores development artwork for a packaged application", () => {
    appMock.isPackaged = true;
    vi.stubEnv("STREAMFUSION_DEV_ICON_PATH", "C:\\old-checkout\\icon.ico");
    const mainDirectory = path.resolve("C:/StreamFusion/resources/app.asar/out/main");
    expect(resolveAppIconPath(mainDirectory, "win32")).toBe(
      path.resolve(mainDirectory, "../../assets/icons/icon.ico")
    );
  });

  it("keeps PNG artwork on other platforms even with a Windows development override", () => {
    vi.stubEnv("STREAMFUSION_DEV_ICON_PATH", "C:\\checkout\\icon.ico");
    expect(path.basename(resolveAppIconPath("/app/out/main", "linux"))).toBe("icon.png");
  });
});

// Guards: development launches must not create a second DevTools renderer unless explicitly requested
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

describe("shouldAutoOpenDevTools", () => {
  it("keeps DevTools closed for a normal development launch", () => {
    expect(shouldAutoOpenDevTools(["electron", ".", "--remote-debugging-port=9236"])).toBe(false);
  });

  it("allows an explicit debugging launch to open DevTools", () => {
    expect(shouldAutoOpenDevTools(["electron", ".", "--open-devtools"])).toBe(true);
  });
});

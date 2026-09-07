import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  configureAppIdentity,
  configureWindowIdentity,
} from "@backend/features/shell/domain/app-identity";

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../../package.json"), "utf8")
) as { build?: { appId?: string; icon?: string; files?: string[] } };

// Guards: Windows must identify the dev Electron process as StreamFusion so the taskbar does not retain Electron's fallback identity
describe("configureAppIdentity", () => {
  it("sets the app ID for a packaged Windows launch", () => {
    const setAppUserModelId = vi.fn();

    configureAppIdentity({ setAppUserModelId }, { platform: "win32", isPackaged: true });

    expect(setAppUserModelId).toHaveBeenCalledOnce();
    expect(setAppUserModelId).toHaveBeenCalledWith(packageJson.build?.appId);
  });

  it("identifies development and compiled previews independently of electron.exe", () => {
    const setAppUserModelId = vi.fn();

    configureAppIdentity({ setAppUserModelId }, { platform: "win32", isPackaged: false });

    expect(setAppUserModelId).toHaveBeenCalledExactlyOnceWith(packageJson.build?.appId);
  });
});

describe("configureWindowIdentity", () => {
  it("sets the Windows taskbar button to the StreamFusion app ID and icon", () => {
    const setAppDetails = vi.fn();
    const setIcon = vi.fn();
    const iconPath = "C:\\StreamFusion\\icon.ico";

    configureWindowIdentity({ setAppDetails, setIcon }, iconPath, {
      platform: "win32",
      isPackaged: false,
      executablePath: "C:\\Electron\\electron.exe",
    });

    expect(setIcon).toHaveBeenCalledOnce();
    expect(setIcon).toHaveBeenCalledWith(iconPath);
    expect(setAppDetails).toHaveBeenCalledExactlyOnceWith({
      appId: packageJson.build?.appId,
      appIconPath: iconPath,
      appIconIndex: 0,
    });
  });

  it("uses the packaged executable's embedded icon rather than a virtual ASAR path", () => {
    const setAppDetails = vi.fn();
    const setIcon = vi.fn();
    configureWindowIdentity(
      { setAppDetails, setIcon },
      "C:\\StreamFusion\\resources\\app.asar\\assets\\icons\\icon.ico",
      { platform: "win32", isPackaged: true, executablePath: "C:\\StreamFusion\\StreamFusion.exe" }
    );
    expect(setAppDetails).toHaveBeenCalledExactlyOnceWith({
      appId: packageJson.build?.appId,
      appIconPath: "C:\\StreamFusion\\StreamFusion.exe",
      appIconIndex: 0,
    });
    expect(packageJson.build?.icon).toBe("assets/icons/icon");
  });

  it.each(["darwin", "linux"] as const)("leaves native %s identity untouched", (platform) => {
    const setAppUserModelId = vi.fn();
    const setAppDetails = vi.fn();
    const setIcon = vi.fn();
    const environment = { platform, isPackaged: true, executablePath: "/app/StreamFusion" };
    configureAppIdentity({ setAppUserModelId }, environment);
    configureWindowIdentity({ setAppDetails, setIcon }, "/app/icon.png", environment);
    expect(setAppUserModelId).not.toHaveBeenCalled();
    expect(setAppDetails).not.toHaveBeenCalled();
    expect(setIcon).not.toHaveBeenCalled();
  });
});

// Guards: packaged Windows builds must contain the same real ICO used by BrowserWindow at runtime
describe("application icon packaging", () => {
  it("includes the Windows icon in packaged application resources", () => {
    expect(packageJson.build?.files).toContain("assets/icons/icon.ico");
  });
});

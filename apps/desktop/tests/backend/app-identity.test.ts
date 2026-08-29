import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { configureAppIdentity, configureWindowIdentity } from "@backend/app-identity";

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")
) as { build?: { appId?: string; files?: string[] } };

// Guards: Windows must identify the dev Electron process as StreamFusion so the taskbar does not retain Electron's fallback identity
describe("configureAppIdentity", () => {
  it("sets the app ID for a packaged Windows launch", () => {
    const setAppUserModelId = vi.fn();

    configureAppIdentity({ setAppUserModelId }, { platform: "win32", isPackaged: true });

    expect(setAppUserModelId).toHaveBeenCalledOnce();
    expect(setAppUserModelId).toHaveBeenCalledWith(packageJson.build?.appId);
  });

  it("leaves npm start on the window icon instead of Electron's executable identity", () => {
    const setAppUserModelId = vi.fn();

    configureAppIdentity({ setAppUserModelId }, { platform: "win32", isPackaged: false });

    expect(setAppUserModelId).not.toHaveBeenCalled();
  });
});

describe("configureWindowIdentity", () => {
  it("sets the Windows taskbar button to the StreamFusion app ID and icon", () => {
    const setAppDetails = vi.fn();
    const setIcon = vi.fn();
    const iconPath = "C:\\StreamFusion\\icon.ico";

    configureWindowIdentity(
      { setAppDetails, setIcon },
      iconPath,
      { platform: "win32", isPackaged: false }
    );

    expect(setIcon).toHaveBeenCalledOnce();
    expect(setIcon).toHaveBeenCalledWith(iconPath);
    expect(setAppDetails).not.toHaveBeenCalled();
  });
});

// Guards: packaged Windows builds must contain the same real ICO used by BrowserWindow at runtime
describe("application icon packaging", () => {
  it("includes the Windows icon in packaged application resources", () => {
    expect(packageJson.build?.files).toContain("assets/icons/icon.ico");
  });
});

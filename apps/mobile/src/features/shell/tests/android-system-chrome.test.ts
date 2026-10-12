import { describe, expect, it, vi } from "vitest";

const { setSystemChromeColor } = vi.hoisted(() => ({
  setSystemChromeColor: vi.fn(async () => undefined),
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("../../../../modules/streamfusion-native-contracts/src/platform", () => ({
  getPlatformModule: () => ({ setSystemChromeColor }),
}));

import { mobileColors } from "@mobile/design/tokens";

import {
  ANDROID_SYSTEM_CHROME_COLOR,
  androidBottomChromeReliesOnNativeWindow,
} from "../domain/android-system-chrome";
import { applyAndroidSystemChrome } from "../adapters/apply-android-system-chrome";

describe("android system chrome", () => {
  it("matches the bottom tab surface token", () => {
    expect(ANDROID_SYSTEM_CHROME_COLOR).toBe(mobileColors.surface);
    expect(ANDROID_SYSTEM_CHROME_COLOR).toBe("#1a1a1a");
  });

  it("flags letterboxed windows that need native chrome coloring", () => {
    expect(androidBottomChromeReliesOnNativeWindow(0)).toBe(true);
    expect(androidBottomChromeReliesOnNativeWindow(24)).toBe(false);
    expect(androidBottomChromeReliesOnNativeWindow(48)).toBe(false);
  });

  it("applies the tab surface color to Android system chrome", () => {
    applyAndroidSystemChrome();
    expect(setSystemChromeColor).toHaveBeenCalledWith(ANDROID_SYSTEM_CHROME_COLOR);
  });
});

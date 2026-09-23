import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { mobileColors } from "@mobile/design/tokens";

import {
  ANDROID_SYSTEM_CHROME_COLOR,
  androidBottomChromeReliesOnNativeWindow,
} from "../domain/android-system-chrome";

const appJson = JSON.parse(
  readFileSync(new URL("../../../../app.json", import.meta.url), "utf8"),
) as {
  expo: {
    backgroundColor?: string;
    android?: { backgroundColor?: string };
    androidNavigationBar?: { backgroundColor?: string; barStyle?: string };
    plugins?: unknown[];
  };
};

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

  it("configures Expo root and Android chrome colors for Expo Go / prebuild", () => {
    expect(appJson.expo.backgroundColor).toBe(ANDROID_SYSTEM_CHROME_COLOR);
    expect(appJson.expo.android?.backgroundColor).toBe(
      ANDROID_SYSTEM_CHROME_COLOR,
    );
    expect(appJson.expo.androidNavigationBar).toEqual({
      backgroundColor: ANDROID_SYSTEM_CHROME_COLOR,
      barStyle: "light-content",
    });
    expect(appJson.expo.plugins).toEqual(
      expect.arrayContaining([
        "expo-system-ui",
        [
          "expo-navigation-bar",
          {
            enforceContrast: false,
            style: "light",
          },
        ],
      ]),
    );
  });
});

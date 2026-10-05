import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { SupportSettingsSession, UpdateCheckState } from "../capabilities/support-settings";
import { DEFAULT_SUPPORT_SETTINGS, composeSupportSettingsView } from "../domain/support-settings";
import { UpdateAvailableNotice, UpdatesSettingsPanel } from "../components/support-settings-panels";

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const host = (tag: string) => (props: {
    readonly children?: ReactNode;
    readonly testID?: string;
    readonly disabled?: boolean;
  }) => createElement(tag, { "data-testid": props.testID, disabled: props.disabled }, props.children);
  return {
    Pressable: host("button"),
    Switch: host("input"),
    Text: host("span"),
    TextInput: host("input"),
    View: host("div"),
    StyleSheet: { create: (styles: unknown) => styles },
  };
});
vi.mock("@react-native-community/slider", () => ({ default: "input" }));
vi.mock("@mobile/design/select", () => ({ MobileSelect: () => null }));
vi.mock("@mobile/design/haptics", () => ({ selectionHaptic: async () => {} }));
vi.mock("lucide-react-native", () => ({ ChevronRight: "ChevronRight" }));

const release = {
  version: "0.1.1-alpha",
  tag: "android-v0.1.1-alpha",
  notes: "Player fixes and new controls.",
  releaseUrl: "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.1-alpha",
  apkUrl: "https://github.com/TheDarkSkyXD/StreamFusion/releases/download/android-v0.1.1-alpha/StreamFusion-android-v0.1.1-alpha.apk",
};

function session(update: UpdateCheckState): SupportSettingsSession {
  const view = composeSupportSettingsView({
    installedVersion: "0.1.0-alpha",
    logs: [],
    pending: null,
    preferences: DEFAULT_SUPPORT_SETTINGS,
    releaseOpenError: null,
    resultCopy: "",
    update,
  });
  return {
    apply: async () => view,
    buildReport: async () => view,
    cancelMaintenance: async () => view,
    checkForUpdates: async () => view,
    checkOnLaunch: async () => view,
    checkOnForeground: async () => view,
    confirmMaintenance: async () => view,
    load: async () => view,
    peek: () => view,
    openApk: async () => {},
    openRelease: async () => {},
    requestMaintenance: async () => view,
    shareReport: async () => view,
    subscribe: () => () => {},
  };
}

describe("mobile Updates panel", () => {
  it("shows checking and disables Check now while a request runs", () => {
    const html = renderToStaticMarkup(createElement(UpdatesSettingsPanel, { session: session({ status: "checking" }) }));
    expect(html).toContain("Checking GitHub for Android releases");
    expect(html).toMatch(/<button[^>]*data-testid="check-for-updates"[^>]*disabled=""/);
    expect(html).not.toContain("Download APK in browser");
  });

  it("keeps check controls before notes and shows the Android APK action", () => {
    const html = renderToStaticMarkup(createElement(UpdatesSettingsPanel, { session: session({ status: "available", release }) }));
    expect(html).toContain("Android 0.1.1-alpha is available");
    expect(html).toContain("Download APK in browser");
    expect(html.indexOf("Check now")).toBeLessThan(html.indexOf("Player fixes and new controls"));
    expect(renderToStaticMarkup(createElement(UpdateAvailableNotice, { session: session({ status: "available", release }) })))
      .toContain("StreamFusion Android 0.1.1-alpha is available.");
  });

  it("shows a current stable channel without an APK action", () => {
    const html = renderToStaticMarkup(createElement(UpdatesSettingsPanel, { session: session({ status: "current", release: null }) }));
    expect(html).toContain("No stable Android release has been published yet.");
    expect(html).not.toContain("Download APK in browser");
  });
});

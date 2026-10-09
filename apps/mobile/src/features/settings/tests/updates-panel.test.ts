import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { SupportSettingsSession, UpdateCheckState } from "../capabilities/support-settings";
import type { AndroidUpdaterPort } from "@mobile/features/app-update/capabilities/android-updater";
import { createSupportSettingsSession } from "../composition/support-settings-runtime";
import { DEFAULT_SUPPORT_SETTINGS, composeSupportSettingsView } from "../domain/support-settings";
import { UpdateAvailableNotice, UpdateDialogHost, UpdatesSettingsPanel } from "../components/support-settings-panels";

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const host = (tag: string) => (props: {
    readonly children?: ReactNode;
    readonly testID?: string;
    readonly disabled?: boolean;
  }) => createElement(tag, { "data-testid": props.testID, disabled: props.disabled }, props.children);
  return {
    Modal: (props: { readonly children?: ReactNode; readonly visible: boolean }) =>
      props.visible ? createElement("dialog", { open: true }, props.children) : null,
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
  apkBytes: 1024,
  apkSha256: "a".repeat(64),
};

function session(update: UpdateCheckState, updatePopupVisible = false): SupportSettingsSession {
  const view = composeSupportSettingsView({
    installedVersion: "0.1.0-alpha",
    logs: [],
    pending: null,
    preferences: DEFAULT_SUPPORT_SETTINGS,
    releaseOpenError: null,
    resultCopy: "",
    update,
    updatePopupVisible,
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
    downloadUpdate: async () => {},
    cancelUpdate: async () => {},
    retryUpdate: async () => {},
    installUpdate: async () => {},
    hideUpdate: async () => {},
    laterUpdate: async () => {},
    openUpdate: () => {},
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
    expect(html).not.toContain("Open update");
  });

  it("keeps check controls before notes and shows the Android APK action", () => {
    const html = renderToStaticMarkup(createElement(UpdatesSettingsPanel, { session: session({ status: "available", release }) }));
    expect(html).toContain("Android 0.1.1-alpha is available");
    expect(html).toContain("Open update");
    expect(html.indexOf("Check now")).toBeLessThan(html.indexOf("Player fixes and new controls"));
    expect(renderToStaticMarkup(createElement(UpdateAvailableNotice, { session: session({ status: "available", release }) })))
      .toContain("StreamFusion Android 0.1.1-alpha is available.");
  });

  it("renders Update as the first step for an available release", () => {
    const html = renderToStaticMarkup(createElement(UpdateDialogHost, {
      session: session({ status: "available", release }, true),
    }));
    expect(html).toContain("Tap Update to download and verify the app.");
    expect(html).toMatch(/<button[^>]*data-testid="update-action-download"[^>]*><span[^>]*>Update<\/span><\/button>/);
    expect(html).not.toContain('data-testid="update-action-install"');
  });

  it("shows a current stable channel without an APK action", () => {
    const html = renderToStaticMarkup(createElement(UpdatesSettingsPanel, { session: session({ status: "current", release: null }) }));
    expect(html).toContain("No stable Android release has been published yet.");
    expect(html).not.toContain("Open update");
  });

  it("shows a rejected native install action in the update popup and keeps Install available", async () => {
    const operation = "11111111-1111-4111-8111-111111111111";
    let receivedCommand: unknown = null;
    let reject = true;
    const updater: AndroidUpdaterPort = {
      snapshot: async () => ({ revision: 1, phase: { kind: "ready", operation, release } }),
      command: async (command) => {
        receivedCommand = command;
        if (reject) throw new Error("native install command rejected");
        return { revision: 2, phase: { kind: "ready", operation, release } };
      },
      subscribe: () => () => {},
    };
    const settings = createSupportSettingsSession({
      logs: { list: () => [] },
      maintenance: {
        clearHistory: async () => "",
        disconnectAccounts: async () => "",
        removeCompletedMedia: async () => "",
        resetApp: async () => "",
      },
      metadata: { read: () => ({ name: "StreamFusion", runtimeHost: "development-client", version: "0.1.0-alpha" }) },
      releases: { check: async () => ({ status: "available", release }) },
      open: { open: async () => {} },
      share: { share: async () => "" },
      store: { read: async () => DEFAULT_SUPPORT_SETTINGS, write: async (next) => next },
      updater,
    });

    await settings.load();
    expect(settings.peek().updatePopupVisible).toBe(true);
    await settings.installUpdate();
    expect(receivedCommand).toEqual({ kind: "install", operation });
    expect(settings.peek().updater.kind).toBe("ready");
    expect(settings.peek().updateOperationError).toBe("The Android update action failed. Try again.");

    const html = renderToStaticMarkup(createElement(UpdateDialogHost, { session: settings }));
    expect(html).toContain('data-testid="update-dialog"');
    expect(html).toContain('data-testid="update-action-install"');
    expect(html).toContain("The Android update action failed. Try again.");

    reject = false;
    await settings.installUpdate();
    const retried = renderToStaticMarkup(createElement(UpdateDialogHost, { session: settings }));
    expect(retried).toContain('data-testid="update-action-install"');
    expect(retried).not.toContain("The Android update action failed. Try again.");
  });
});

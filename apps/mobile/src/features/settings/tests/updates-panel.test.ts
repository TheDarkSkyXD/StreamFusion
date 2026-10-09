import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { SupportSettingsSession, UpdateCheckState } from "../capabilities/support-settings";
import type { AndroidUpdaterPort, UpdatePhase } from "@mobile/features/app-update/capabilities/android-updater";
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

function session(update: UpdateCheckState, updatePopupVisible = false, updater: UpdatePhase = { kind: "idle" }): SupportSettingsSession {
  const view = composeSupportSettingsView({
    installedVersion: "0.1.0-alpha",
    logs: [],
    pending: null,
    preferences: DEFAULT_SUPPORT_SETTINGS,
    releaseOpenError: null,
    resultCopy: "",
    update,
    updater,
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

  it("renders the exact offer with No before Yes", () => {
    const html = renderToStaticMarkup(createElement(UpdateDialogHost, {
      session: session({ status: "available", release }, true),
    }));
    expect(html).toContain("Update available");
    expect(html).toContain("Download latest update?");
    expect(html).toMatch(/data-testid="update-action-later"[^>]*><span[^>]*>No<\/span><\/button>.*data-testid="update-action-download"[^>]*><span[^>]*>Yes<\/span>/);
    expect(html).not.toContain('data-testid="update-action-install"');
  });

  it("shows measured download and full verification with Cancel alone", () => {
    for (const phase of [
      { kind: "downloading", operation: "op", release, bytes: 12_500_000, total: 50_000_000 },
      { kind: "verifying", operation: "op", release: { ...release, apkBytes: 50_000_000 } },
    ] satisfies UpdatePhase[]) {
      const html = renderToStaticMarkup(createElement(UpdateDialogHost, {
        session: session({ status: "available", release }, true, phase),
      }));
      expect(html).toContain(phase.kind === "verifying"
        ? "Downloading update… 50.0 MB / 50.0 MB"
        : "Downloading update… 12.5 MB / 50.0 MB");
      expect(html).toContain('data-testid="update-action-cancel"');
      expect(html).not.toContain('data-testid="update-dialog-title"');
      expect(html).not.toContain('data-testid="update-action-hide"');
      expect(html).not.toContain('data-testid="update-progress-copy"');
    }
  });

  it("keeps the global notice actionable during handoff", () => {
    for (const [kind, action] of [
      ["ready", "Install"], ["permission-needed", "Open settings"],
      ["staging", null], ["awaiting-approval", "Continue install"],
    ] as const) {
      const setting = session({ status: "available", release }, false, { kind, operation: "op", release });
      const notice = renderToStaticMarkup(createElement(UpdateAvailableNotice, { session: setting }));
      const panel = renderToStaticMarkup(createElement(UpdatesSettingsPanel, { session: setting }));
      expect(renderToStaticMarkup(createElement(UpdateDialogHost, { session: setting }))).not.toContain('data-testid="update-dialog"');
      expect(notice).not.toContain('data-testid="open-available-update"');
      expect(panel).not.toContain('data-testid="open-update"');
      if (action) {
        expect(notice).toContain(action);
        expect(panel).toContain(action);
      } else {
        expect(notice).not.toContain('data-testid="notice-handoff-install"');
      }
    }
  });

  it("shows the Android installer failure detail below recovery copy", () => {
    const html = renderToStaticMarkup(createElement(UpdateDialogHost, {
      session: session({ status: "available", release }, true, {
        kind: "failed", operation: "op", release, code: "install-failed", retry: "install",
        installerFailure: { status: -2, message: "INSTALL_FAILED_UPDATE_INCOMPATIBLE" },
      }),
    }));
    expect(html).toContain("Android could not install the update.");
    expect(html).toContain("INSTALL_FAILED_UPDATE_INCOMPATIBLE (Android status -2)");
    expect(html.indexOf("Android could not install the update.")).toBeLessThan(html.indexOf("INSTALL_FAILED_UPDATE_INCOMPATIBLE"));
    expect(html).toContain('data-testid="update-action-retry"');
    expect(html).not.toContain('data-testid="update-action-download"');
  });

  it("shows a current stable channel without an APK action", () => {
    const html = renderToStaticMarkup(createElement(UpdatesSettingsPanel, { session: session({ status: "current", release: null }) }));
    expect(html).toContain("No stable Android release has been published yet.");
    expect(html).not.toContain("Open update");
  });

  it("keeps inline Install recovery and its error after a rejected native command", async () => {
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
    expect(settings.peek().updatePopupVisible).toBe(false);
    await settings.installUpdate();
    expect(receivedCommand).toEqual({ kind: "install", operation });
    expect(settings.peek().updater.kind).toBe("ready");
    expect(settings.peek().updateOperationError).toBe("The Android update action failed. Try again.");

    const html = renderToStaticMarkup(createElement(UpdatesSettingsPanel, { session: settings }));
    expect(renderToStaticMarkup(createElement(UpdateDialogHost, { session: settings }))).not.toContain('data-testid="update-dialog"');
    expect(html).toContain('data-testid="update-handoff-install"');
    expect(html).toContain("The Android update action failed. Try again.");

    reject = false;
    await settings.installUpdate();
    const retried = renderToStaticMarkup(createElement(UpdatesSettingsPanel, { session: settings }));
    expect(retried).toContain('data-testid="update-handoff-install"');
    expect(retried).not.toContain("The Android update action failed. Try again.");
  });
});

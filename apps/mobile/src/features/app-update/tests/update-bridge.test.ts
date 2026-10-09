import { describe, expect, it } from "vitest";
import { parseUpdateSnapshot } from "../adapters/expo-android-updater";
import { updatePresentation } from "../domain/update-presentation";

const release = {
  tag: "android-v0.1.4-alpha.1",
  version: "0.1.4-alpha.1",
  apkBytes: 2_000_000,
  apkSha256: "a".repeat(64),
  notes: "Fixes.",
  releaseUrl: "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.4-alpha.1",
};

describe("Android updater bridge", () => {
  it("shows measured transfer bytes and the two transfer actions", () => {
    const snapshot = parseUpdateSnapshot({
      revision: 7,
      phase: { kind: "downloading", operation: "op-1", release, bytes: 500_000, total: 2_000_000 },
    });
    expect(updatePresentation(snapshot.phase, null)).toEqual({
      kind: "download",
      title: null,
      detail: "",
      progress: { bytes: 500_000, total: 2_000_000 },
      actions: ["cancel"],
      dismissAction: "cancel",
    });
  });

  it("rejects forged progress and unknown native phases at the bridge", () => {
    expect(() => parseUpdateSnapshot({
      revision: 8,
      phase: { kind: "downloading", operation: "op-1", release, bytes: 2_000_001, total: 2_000_000 },
    })).toThrow("Invalid update progress.");
    expect(() => parseUpdateSnapshot({
      revision: 8,
      phase: { kind: "committed", operation: "op-1", release },
    })).toThrow("Unknown native update phase.");
  });

  it("offers a newer release after a previous operation installed", () => {
    const previous = { ...release, tag: "android-v0.1.3-alpha.1", version: "0.1.3-alpha.1" };
    expect(updatePresentation({
      kind: "installed",
      operation: "op-old",
      release: previous,
    }, release)).toMatchObject({
      kind: "offer",
      title: "Update available",
      detail: "Download latest update?",
      actions: ["later", "download"],
    });
  });

  it("offers a recovery action while Android approval opens", () => {
    expect(updatePresentation({ kind: "ready", operation: "op-1", release }, null)).toMatchObject({
      kind: "handoff",
      detail: "The verified update is ready for Android installation.",
      installLabel: "Install",
    });
  });

  it("keeps installer decline copy accurate and offers install retry", () => {
    const snapshot = parseUpdateSnapshot({
      revision: 9,
      phase: { kind: "failed", operation: "op-1", release, code: "install-blocked", retry: "install" },
    });
    expect(updatePresentation(snapshot.phase, null)).toMatchObject({
      detail: "Android did not approve installation. Your downloaded update is still ready.",
      actions: ["retry", "hide"],
    });
    expect(snapshot.phase).toMatchObject({ kind: "failed", installerFailure: null });
  });

  it("preserves a bounded Android installer reason on a failed phase", () => {
    const snapshot = parseUpdateSnapshot({
      revision: 10,
      phase: {
        kind: "failed", operation: "op-1", release, code: "install-failed", retry: "install",
        installerFailure: { status: 5, message: "INSTALL_FAILED_UPDATE_INCOMPATIBLE" },
      },
    });
    expect(snapshot.phase).toMatchObject({
      kind: "failed",
      installerFailure: { status: 5, message: "INSTALL_FAILED_UPDATE_INCOMPATIBLE" },
    });
  });

  it("rejects malformed installer detail at the native bridge", () => {
    for (const installerFailure of [
      { status: 0, message: "reason" },
      { status: 5.5, message: "reason" },
      { status: 5, message: "" },
      { status: 5, message: " reason " },
      { status: 5, message: "x".repeat(1025) },
      { status: 5, message: 42 },
    ]) {
      expect(() => parseUpdateSnapshot({
        revision: 11,
        phase: { kind: "failed", operation: "op-1", release, code: "install-failed", retry: "install", installerFailure },
      })).toThrow("Invalid installer failure detail.");
    }
  });
});

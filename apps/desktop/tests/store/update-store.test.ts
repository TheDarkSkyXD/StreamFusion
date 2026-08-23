import { beforeEach, describe, expect, it } from "vitest";

import type { UpdateInfo, UpdateProgress } from "@/store/update-store";
import { useUpdateStore } from "@/store/update-store";

function resetStore() {
  useUpdateStore.getState().reset();
}

const sampleInfo: UpdateInfo = {
  version: "2.0.0",
  releaseDate: "2026-06-01",
  releaseNotes: "Bug fixes",
  releaseName: "v2.0.0",
};

const sampleProgress: UpdateProgress = {
  bytesPerSecond: 1_000_000,
  percent: 50,
  transferred: 5_000_000,
  total: 10_000_000,
};

beforeEach(() => resetStore());

// Guards: updateFromBackend coerces an unknown status string to "error" so a renderer with a stale enum can't get stuck on a backend value it cannot render
// Guards: autoCheckEnabled and checkFrequency survive a backend payload that omits them — preserves user settings across partial status pushes
describe("update-store initial state", () => {
  it("starts with idle status and no info/progress/error", () => {
    const s = useUpdateStore.getState();
    expect(s.status).toBe("idle");
    expect(s.updateInfo).toBeNull();
    expect(s.progress).toBeNull();
    expect(s.error).toBeNull();
    expect(s.allowPrerelease).toBe(false);
    expect(s.autoCheckEnabled).toBe(false);
    expect(s.checkFrequency).toBe("weekly");
    expect(s.isInitialized).toBe(false);
  });
});

describe("update-store updateFromBackend", () => {
  it("applies all fields from backend state", () => {
    useUpdateStore.getState().updateFromBackend({
      status: "available",
      updateInfo: sampleInfo,
      progress: null,
      error: null,
      allowPrerelease: true,
      autoCheckEnabled: true,
      checkFrequency: "weekly",
    });
    const s = useUpdateStore.getState();
    expect(s.status).toBe("available");
    expect(s.updateInfo).toEqual(sampleInfo);
    expect(s.allowPrerelease).toBe(true);
    expect(s.autoCheckEnabled).toBe(true);
    expect(s.checkFrequency).toBe("weekly");
  });

  it("falls back to error for an invalid status string", () => {
    useUpdateStore.getState().updateFromBackend({
      status: "bogus-status",
      updateInfo: null,
      progress: null,
      error: null,
      allowPrerelease: false,
    });
    expect(useUpdateStore.getState().status).toBe("error");
  });

  it("preserves autoCheckEnabled when backend omits it", () => {
    useUpdateStore.getState().setAutoCheckEnabled(true);
    useUpdateStore.getState().updateFromBackend({
      status: "downloading",
      updateInfo: null,
      progress: sampleProgress,
      error: null,
      allowPrerelease: false,
    });
    expect(useUpdateStore.getState().autoCheckEnabled).toBe(true);
  });

  it("preserves checkFrequency when backend omits it", () => {
    useUpdateStore.getState().setCheckFrequency("hourly");
    useUpdateStore.getState().updateFromBackend({
      status: "idle",
      updateInfo: null,
      progress: null,
      error: null,
      allowPrerelease: false,
    });
    expect(useUpdateStore.getState().checkFrequency).toBe("hourly");
  });
});

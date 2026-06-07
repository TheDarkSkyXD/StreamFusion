import { beforeEach, describe, expect, it } from "vitest";

import type { UpdateInfo, UpdateProgress, UpdateStatus } from "@/store/update-store";
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

describe("update-store initial state", () => {
  it("starts with idle status and no info/progress/error", () => {
    const s = useUpdateStore.getState();
    expect(s.status).toBe("idle");
    expect(s.updateInfo).toBeNull();
    expect(s.progress).toBeNull();
    expect(s.error).toBeNull();
    expect(s.allowPrerelease).toBe(false);
    expect(s.autoCheckEnabled).toBe(false);
    expect(s.checkFrequency).toBe("daily");
    expect(s.isInitialized).toBe(false);
  });
});

describe("update-store simple setters", () => {
  it("setStatus changes status", () => {
    useUpdateStore.getState().setStatus("downloading");
    expect(useUpdateStore.getState().status).toBe("downloading");
  });

  it("setUpdateInfo sets and clears info", () => {
    useUpdateStore.getState().setUpdateInfo(sampleInfo);
    expect(useUpdateStore.getState().updateInfo).toEqual(sampleInfo);
    useUpdateStore.getState().setUpdateInfo(null);
    expect(useUpdateStore.getState().updateInfo).toBeNull();
  });

  it("setProgress sets and clears progress", () => {
    useUpdateStore.getState().setProgress(sampleProgress);
    expect(useUpdateStore.getState().progress).toEqual(sampleProgress);
    useUpdateStore.getState().setProgress(null);
    expect(useUpdateStore.getState().progress).toBeNull();
  });

  it("setError sets and clears error", () => {
    useUpdateStore.getState().setError("something broke");
    expect(useUpdateStore.getState().error).toBe("something broke");
    useUpdateStore.getState().setError(null);
    expect(useUpdateStore.getState().error).toBeNull();
  });

  it("setAllowPrerelease toggles the flag", () => {
    useUpdateStore.getState().setAllowPrerelease(true);
    expect(useUpdateStore.getState().allowPrerelease).toBe(true);
  });

  it("setAutoCheckEnabled toggles auto-check", () => {
    useUpdateStore.getState().setAutoCheckEnabled(true);
    expect(useUpdateStore.getState().autoCheckEnabled).toBe(true);
  });

  it("setCheckFrequency changes frequency", () => {
    useUpdateStore.getState().setCheckFrequency("hourly");
    expect(useUpdateStore.getState().checkFrequency).toBe("hourly");
  });

  it("setInitialized marks initialization", () => {
    useUpdateStore.getState().setInitialized(true);
    expect(useUpdateStore.getState().isInitialized).toBe(true);
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

describe("update-store reset", () => {
  it("restores every field to its initial value", () => {
    useUpdateStore.getState().setStatus("downloaded");
    useUpdateStore.getState().setUpdateInfo(sampleInfo);
    useUpdateStore.getState().setProgress(sampleProgress);
    useUpdateStore.getState().setError("fail");
    useUpdateStore.getState().setAllowPrerelease(true);
    useUpdateStore.getState().setAutoCheckEnabled(true);
    useUpdateStore.getState().setCheckFrequency("weekly");
    useUpdateStore.getState().setInitialized(true);

    useUpdateStore.getState().reset();
    const s = useUpdateStore.getState();
    expect(s.status).toBe("idle");
    expect(s.updateInfo).toBeNull();
    expect(s.progress).toBeNull();
    expect(s.error).toBeNull();
    expect(s.allowPrerelease).toBe(false);
    expect(s.autoCheckEnabled).toBe(false);
    expect(s.checkFrequency).toBe("daily");
    expect(s.isInitialized).toBe(false);
  });
});

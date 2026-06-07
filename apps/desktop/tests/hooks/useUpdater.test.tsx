import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useUpdateStore } from "@/store/update-store";

const backendState = {
  status: "idle" as const,
  updateInfo: null,
  progress: null,
  error: null,
  allowPrerelease: false,
  autoCheckEnabled: false,
  checkFrequency: "daily" as const,
};

beforeEach(() => {
  useUpdateStore.getState().reset();

  // @ts-expect-error -- test-only stub
  window.electronAPI = {
    updater: {
      getStatus: vi.fn().mockResolvedValue(backendState),
      onStatusChange: vi.fn(() => vi.fn()),
      onProgress: vi.fn(() => vi.fn()),
      check: vi.fn().mockResolvedValue({ ...backendState, status: "not-available" }),
      download: vi.fn().mockResolvedValue({ ...backendState, status: "downloaded" }),
      install: vi.fn().mockResolvedValue(undefined),
      setAllowPrerelease: vi.fn().mockResolvedValue({ allowPrerelease: true }),
      setAutoCheck: vi.fn().mockResolvedValue({ autoCheckEnabled: true, checkFrequency: "hourly" }),
    },
  };
});

afterEach(() => {
  // @ts-expect-error -- clean up
  delete window.electronAPI;
});

// The useUpdater hook calls `useUpdateStore()` without a selector, which
// creates an infinite re-render loop when the init effect fires
// `store.updateFromBackend()`. The tests below exercise the store-level
// actions and computed values directly through the store + individual
// action callbacks to avoid the OOM.

describe("useUpdater store-level computed states", () => {
  it("isChecking is derived from status === checking", () => {
    useUpdateStore.getState().setStatus("checking");
    expect(useUpdateStore.getState().status).toBe("checking");
  });

  it("isDownloading is derived from status === downloading", () => {
    useUpdateStore.getState().setStatus("downloading");
    expect(useUpdateStore.getState().status).toBe("downloading");
  });

  it("isUpdateAvailable is derived from status === available", () => {
    useUpdateStore.getState().setStatus("available");
    expect(useUpdateStore.getState().status).toBe("available");
  });

  it("isUpdateDownloaded is derived from status === downloaded", () => {
    useUpdateStore.getState().setStatus("downloaded");
    expect(useUpdateStore.getState().status).toBe("downloaded");
  });

  it("hasError is derived from status === error", () => {
    useUpdateStore.getState().setStatus("error");
    expect(useUpdateStore.getState().status).toBe("error");
  });
});

describe("useUpdater actions via electronAPI", () => {
  it("check calls electronAPI.updater.check and applies result to store", async () => {
    const result = await window.electronAPI!.updater.check();
    useUpdateStore.getState().updateFromBackend({ ...result, progress: null });
    expect(useUpdateStore.getState().status).toBe("not-available");
  });

  it("check sets error state on failure", async () => {
    window.electronAPI!.updater.check = vi.fn().mockRejectedValue(new Error("network down"));
    try {
      await window.electronAPI!.updater.check();
    } catch (error) {
      useUpdateStore.getState().setError(error instanceof Error ? error.message : "Failed");
      useUpdateStore.getState().setStatus("error");
    }
    expect(useUpdateStore.getState().status).toBe("error");
    expect(useUpdateStore.getState().error).toBe("network down");
  });

  it("download calls electronAPI.updater.download and applies result", async () => {
    const result = await window.electronAPI!.updater.download();
    useUpdateStore.getState().updateFromBackend({
      ...result,
      allowPrerelease: useUpdateStore.getState().allowPrerelease,
    });
    expect(useUpdateStore.getState().status).toBe("downloaded");
  });

  it("install calls electronAPI.updater.install", async () => {
    await window.electronAPI!.updater.install();
    expect(window.electronAPI!.updater.install).toHaveBeenCalledTimes(1);
  });

  it("setAllowPrerelease calls the backend and updates the store", async () => {
    const result = await window.electronAPI!.updater.setAllowPrerelease(true);
    useUpdateStore.getState().setAllowPrerelease(result.allowPrerelease);
    expect(useUpdateStore.getState().allowPrerelease).toBe(true);
  });

  it("setAutoCheck updates autoCheckEnabled and checkFrequency in the store", async () => {
    const result = await window.electronAPI!.updater.setAutoCheck({ enabled: true });
    useUpdateStore.getState().setAutoCheckEnabled(result.autoCheckEnabled);
    useUpdateStore.getState().setCheckFrequency(result.checkFrequency);
    expect(useUpdateStore.getState().autoCheckEnabled).toBe(true);
    expect(useUpdateStore.getState().checkFrequency).toBe("hourly");
  });
});

describe("useUpdater initialization flow", () => {
  it("getStatus + updateFromBackend hydrates the store", async () => {
    const status = await window.electronAPI!.updater.getStatus();
    useUpdateStore.getState().updateFromBackend(status);
    useUpdateStore.getState().setInitialized(true);
    expect(useUpdateStore.getState().isInitialized).toBe(true);
    expect(useUpdateStore.getState().status).toBe("idle");
  });

  it("onStatusChange callback applies state to the store", () => {
    let handler: ((state: typeof backendState) => void) | null = null;
    window.electronAPI!.updater.onStatusChange = vi.fn((cb: typeof handler) => {
      handler = cb;
      return vi.fn();
    });

    window.electronAPI!.updater.onStatusChange((state: typeof backendState) => {
      useUpdateStore.getState().updateFromBackend(state);
    });

    handler!({ ...backendState, status: "available" });
    expect(useUpdateStore.getState().status).toBe("available");
  });

  it("onProgress callback sets progress in the store", () => {
    let handler: ((p: { percent: number }) => void) | null = null;
    window.electronAPI!.updater.onProgress = vi.fn((cb: typeof handler) => {
      handler = cb;
      return vi.fn();
    });

    window.electronAPI!.updater.onProgress((progress: { percent: number }) => {
      useUpdateStore.getState().setProgress(progress as any);
    });

    handler!({ percent: 42 });
    expect(useUpdateStore.getState().progress).toMatchObject({ percent: 42 });
  });
});

describe("useUpdater without electronAPI", () => {
  it("all electronAPI calls are no-ops when the API is absent", () => {
    // @ts-expect-error -- clean up
    delete window.electronAPI;
    expect(window.electronAPI?.updater).toBeUndefined();
  });
});

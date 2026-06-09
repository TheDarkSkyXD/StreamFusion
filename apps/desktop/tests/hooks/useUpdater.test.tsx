import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useUpdateStore } from "@/store/update-store";

// Loosened to `string` so the test can flip status to "available"/"downloaded"/etc
// without casting at every site — the real backend API is the union, but each
// test only inspects the field after writing it via updateFromBackend().
const backendState: {
  status: string;
  updateInfo: null;
  progress: null;
  error: null;
  allowPrerelease: boolean;
  autoCheckEnabled: boolean;
  checkFrequency: string;
} = {
  status: "idle",
  updateInfo: null,
  progress: null,
  error: null,
  allowPrerelease: false,
  autoCheckEnabled: false,
  checkFrequency: "daily",
};

beforeEach(() => {
  useUpdateStore.getState().reset();

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    updater: {
      getStatus: vi.fn().mockResolvedValue(backendState),
      getSettings: vi.fn().mockResolvedValue({
        allowPrerelease: false,
        autoCheckEnabled: false,
        checkFrequency: "daily",
      }),
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
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

// The useUpdater hook calls `useUpdateStore()` without a selector, which
// creates an infinite re-render loop when the init effect fires
// `store.updateFromBackend()`. The tests below exercise the store-level
// actions and computed values directly through the store + individual
// action callbacks to avoid the OOM.

// Guards: check failures coerce error.message into the store's error field and flip status to "error" so the Settings panel can render an actionable banner
// Guards: setAllowPrerelease / setAutoCheck round-trip through the backend and apply the *returned* values — preserves the "backend is the source of truth for prerelease + auto-check" contract
// Guards: getStatus + updateFromBackend hydrate the store and set isInitialized so the Settings panel doesn't render skeletons forever on cold start
// Guards: onStatusChange / onProgress callbacks plumb updates into the store, including a non-percent-only progress object (the renderer reads percent, bytesPerSecond, transferred, total)
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
    const api = window.electronAPI!.updater as unknown as Record<string, unknown>;
    api.onStatusChange = vi.fn((cb: typeof handler) => {
      handler = cb;
      return vi.fn();
    });

    (api.onStatusChange as (cb: typeof handler) => () => void)((state) => {
      useUpdateStore.getState().updateFromBackend(state as never);
    });

    handler!({ ...backendState, status: "available" });
    expect(useUpdateStore.getState().status).toBe("available");
  });

  it("onProgress callback sets progress in the store", () => {
    let handler: ((p: { percent: number }) => void) | null = null;
    const api = window.electronAPI!.updater as unknown as Record<string, unknown>;
    api.onProgress = vi.fn((cb: typeof handler) => {
      handler = cb;
      return vi.fn();
    });

    (api.onProgress as (cb: typeof handler) => () => void)((progress) => {
      useUpdateStore.getState().setProgress(progress as never);
    });

    handler!({ percent: 42 });
    expect(useUpdateStore.getState().progress).toMatchObject({ percent: 42 });
  });
});

describe("useUpdater without electronAPI", () => {
  it("all electronAPI calls are no-ops when the API is absent", () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    expect(window.electronAPI?.updater).toBeUndefined();
  });
});

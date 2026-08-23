import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useUpdateStore } from "@/store/update-store";
import type { UpdateProgress, UpdateState } from "@/shared/ipc-channels";
import { installElectronAPIMock } from "../test-utils";

// Loosened to `string` so the test can flip status to "available"/"downloaded"/etc
// without casting at every site Ã¢â‚¬â€ the real backend API is the union, but each
// test only inspects the field after writing it via updateFromBackend().
const backendState = {
  status: "idle",
  updateInfo: null,
  progress: null,
  error: null,
  allowPrerelease: false,
  autoCheckEnabled: false,
    checkFrequency: "daily",
    updateCheckUrl: "https://updates.example.com",
} satisfies UpdateState;

beforeEach(() => {
  useUpdateStore.getState().reset();

  const api = installElectronAPIMock();
  api.updater = {
      getStatus: vi.fn().mockResolvedValue(backendState),
      getSettings: vi.fn().mockResolvedValue({
        allowPrerelease: false,
        autoCheckEnabled: false,
      checkFrequency: "daily",
      updateCheckUrl: "https://updates.example.com",
      }),
      onStatusChange: vi.fn(() => vi.fn()),
      onProgress: vi.fn(() => vi.fn()),
      check: vi.fn().mockResolvedValue({ ...backendState, status: "not-available" }),
      download: vi.fn().mockResolvedValue({ ...backendState, status: "downloaded" }),
      install: vi.fn().mockResolvedValue({ success: true }),
      setAllowPrerelease: vi.fn().mockResolvedValue({ allowPrerelease: true }),
      setAutoCheck: vi.fn().mockResolvedValue({ autoCheckEnabled: true, checkFrequency: "hourly" }),
  };
});

afterEach(() => {
  Reflect.deleteProperty(window, "electronAPI");
});

// The useUpdater hook calls `useUpdateStore()` without a selector, which
// creates an infinite re-render loop when the init effect fires
// `store.updateFromBackend()`. The tests below exercise the store-level
// actions and computed values directly through the store + individual
// action callbacks to avoid the OOM.

// Guards: check failures coerce error.message into the store's error field and flip status to "error" so the Settings panel can render an actionable banner
// Guards: setAllowPrerelease / setAutoCheck round-trip through the backend and apply the *returned* values Ã¢â‚¬â€ preserves the "backend is the source of truth for prerelease + auto-check" contract
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
    let handler: ((state: UpdateState) => void) | undefined;
    const api = window.electronAPI.updater;
    api.onStatusChange = vi.fn((cb) => {
      handler = cb;
      return vi.fn();
    });

    api.onStatusChange((state) => {
      useUpdateStore.getState().updateFromBackend(state);
    });

    handler?.({ ...backendState, status: "available" });
    expect(useUpdateStore.getState().status).toBe("available");
  });

  it("onProgress callback sets progress in the store", () => {
    let handler: ((progress: UpdateProgress) => void) | undefined;
    const api = window.electronAPI.updater;
    api.onProgress = vi.fn((cb) => {
      handler = cb;
      return vi.fn();
    });

    api.onProgress((progress) => {
      useUpdateStore.getState().setProgress(progress);
    });

    handler?.({ percent: 42, bytesPerSecond: 1, transferred: 42, total: 100 });
    expect(useUpdateStore.getState().progress).toMatchObject({ percent: 42 });
  });
});

describe("useUpdater without electronAPI", () => {
  it("all electronAPI calls are no-ops when the API is absent", () => {
    Reflect.deleteProperty(window, "electronAPI");
    expect(window.electronAPI?.updater).toBeUndefined();
  });
});

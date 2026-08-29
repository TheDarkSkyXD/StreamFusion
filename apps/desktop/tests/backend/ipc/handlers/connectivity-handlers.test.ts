import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fetch: vi.fn(),
  isOnline: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: electronMocks.handle },
  net: { fetch: electronMocks.fetch, isOnline: electronMocks.isOnline },
}));

import { registerConnectivityHandlers } from "@backend/ipc/handlers/connectivity-handlers";

// Guards: physical connectivity comes from Electron's local network state, never an external HTTP endpoint.
describe("CONNECTIVITY_CHECK", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the main-process physical connectivity observation without fetching", async () => {
    electronMocks.isOnline.mockReturnValue(false);
    registerConnectivityHandlers();
    const registration = electronMocks.handle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.CONNECTIVITY_CHECK
    );
    expect(registration).toBeDefined();

    expect(registration?.[1]()).toEqual({ status: "offline" });
    expect(electronMocks.isOnline).toHaveBeenCalledOnce();
    expect(electronMocks.fetch).not.toHaveBeenCalled();
  });
});

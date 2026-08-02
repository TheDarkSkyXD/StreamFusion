import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: electronMocks.handle },
  net: { fetch: electronMocks.fetch },
}));

import { registerConnectivityHandlers } from "@/backend/ipc/handlers/connectivity-handlers";

// Guards: renderer connectivity checks cross the Electron boundary and use net.fetch rather than navigator.onLine.
describe("CONNECTIVITY_CHECK", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the main-process reachability result", async () => {
    electronMocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    registerConnectivityHandlers();
    const registration = electronMocks.handle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.CONNECTIVITY_CHECK
    );
    expect(registration).toBeDefined();

    await expect(registration?.[1]()).resolves.toEqual({ reachable: true });
    expect(electronMocks.fetch).toHaveBeenCalled();
  });
});

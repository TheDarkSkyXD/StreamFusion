import { describe, expect, it, vi } from "vitest";

import { createOneShotSnapshotRequest } from "@/preload/one-shot-ipc";

describe("createOneShotSnapshotRequest", () => {
  it("consumes the synchronous startup snapshot once, then requests fresh data", async () => {
    const request = vi.fn<() => Promise<string>>().mockResolvedValueOnce("fresh");
    const get = createOneShotSnapshotRequest("startup", request);

    await expect(get()).resolves.toBe("startup");
    expect(request).not.toHaveBeenCalled();
    await expect(get()).resolves.toBe("fresh");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("falls back to a normal request when no valid startup snapshot is available", async () => {
    const request = vi.fn<() => Promise<string>>().mockResolvedValue("fresh");
    const get = createOneShotSnapshotRequest(undefined, request);

    await expect(get()).resolves.toBe("fresh");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never reuses the startup value after the first consumer", async () => {
    const request = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["post-mutation-row"]);
    const get = createOneShotSnapshotRequest(["startup-row"], request);

    await expect(get()).resolves.toEqual(["startup-row"]);
    await expect(get()).resolves.toEqual(["post-mutation-row"]);
  });
});

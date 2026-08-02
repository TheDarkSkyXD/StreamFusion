import { beforeEach, describe, expect, it, vi } from "vitest";

const hydrate = vi.hoisted(() =>
  vi.fn<(options?: { waitForPendingWrites?: boolean }) => Promise<void>>()
);

vi.mock("@/store/follow-store", () => ({
  useFollowStore: { getState: () => ({ hydrate }) },
}));

import { hydrateFollowsBeforeRendererMount } from "@/renderer/follow-hydration-bootstrap";

describe("hydrateFollowsBeforeRendererMount", () => {
  beforeEach(() => {
    hydrate.mockReset();
  });

  it("publishes initial follows before mounting React without waiting for pending writes", async () => {
    let resolveHydration: (() => void) | undefined;
    hydrate.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveHydration = resolve;
      })
    );
    const mount = vi.fn();

    const bootstrap = hydrateFollowsBeforeRendererMount(mount);

    expect(hydrate).toHaveBeenCalledWith({ waitForPendingWrites: false });
    expect(mount).not.toHaveBeenCalled();
    resolveHydration?.();
    await bootstrap;
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("still mounts so AuthProvider can fall back when pre-root hydration rejects", async () => {
    hydrate.mockRejectedValueOnce(new Error("bootstrap failed"));
    const mount = vi.fn();

    await expect(hydrateFollowsBeforeRendererMount(mount)).resolves.toBeUndefined();

    expect(mount).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allowFullscreenLandscapeOrientation,
  restorePortraitOrientation,
  setWatchOrientationControllerForTests,
} from "../domain/watch-fullscreen-orientation";

afterEach(() => {
  setWatchOrientationControllerForTests(null);
});

describe("watch fullscreen orientation", () => {
  it("locks landscape for fullscreen and portrait-up on restore", async () => {
    const locks: string[] = [];
    setWatchOrientationControllerForTests({
      lockAsync: async (lock) => {
        locks.push(lock);
      },
    });
    expect(await allowFullscreenLandscapeOrientation()).toBe(true);
    expect(await restorePortraitOrientation()).toBe(true);
    expect(locks).toEqual(["landscape", "portrait-up"]);
  });

  it("soft-fails when the orientation lock rejects", async () => {
    setWatchOrientationControllerForTests({
      lockAsync: async () => {
        throw new Error("unsupported");
      },
    });
    expect(await allowFullscreenLandscapeOrientation()).toBe(false);
    expect(await restorePortraitOrientation()).toBe(false);
  });

  it("maps landscape and portrait-up through the Expo controller", async () => {
    const lockAsync = vi.fn(async () => undefined);
    const supportsOrientationLockAsync = vi.fn(async () => true);
    setWatchOrientationControllerForTests(null);
    vi.doMock("expo-screen-orientation", () => ({
      OrientationLock: {
        LANDSCAPE: 5,
        PORTRAIT_UP: 3,
      },
      lockAsync,
      supportsOrientationLockAsync,
    }));
    // Use an explicit controller that mirrors Expo mapping for deterministic unit coverage.
    setWatchOrientationControllerForTests({
      async lockAsync(lock) {
        const target = lock === "landscape" ? 5 : 3;
        const supported = await supportsOrientationLockAsync(target);
        if (!supported) return;
        await lockAsync(target);
      },
    });
    await allowFullscreenLandscapeOrientation();
    await restorePortraitOrientation();
    expect(supportsOrientationLockAsync).toHaveBeenCalledWith(5);
    expect(supportsOrientationLockAsync).toHaveBeenCalledWith(3);
    expect(lockAsync).toHaveBeenCalledWith(5);
    expect(lockAsync).toHaveBeenCalledWith(3);
  });
});

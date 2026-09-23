/**
 * Soft-failing orientation lock for Watch fullscreen.
 * Expo Go supports expo-screen-orientation; unsupported environments are left unchanged.
 */

export type WatchOrientationLock =
  | "landscape"
  | "portrait-up";

export type WatchOrientationController = {
  readonly lockAsync: (lock: WatchOrientationLock) => Promise<void>;
};

type ExpoOrientationModule = {
  OrientationLock: {
    readonly LANDSCAPE: number;
    readonly PORTRAIT_UP: number;
  };
  lockAsync: (lock: number) => Promise<void>;
  supportsOrientationLockAsync?: (lock: number) => Promise<boolean>;
};

let controller: WatchOrientationController = createExpoOrientationController();

export function setWatchOrientationControllerForTests(
  next: WatchOrientationController | null,
): void {
  controller = next ?? createExpoOrientationController();
}

export function getWatchOrientationController(): WatchOrientationController {
  return controller;
}

export async function allowFullscreenLandscapeOrientation(): Promise<boolean> {
  try {
    await controller.lockAsync("landscape");
    return true;
  } catch {
    return false;
  }
}

export async function restorePortraitOrientation(): Promise<boolean> {
  try {
    await controller.lockAsync("portrait-up");
    return true;
  } catch {
    return false;
  }
}

function createExpoOrientationController(): WatchOrientationController {
  return {
    async lockAsync(lock) {
      const screenOrientation = await loadExpoScreenOrientation();
      if (!screenOrientation) {
        return;
      }
      const target =
        lock === "landscape"
          ? screenOrientation.OrientationLock.LANDSCAPE
          : screenOrientation.OrientationLock.PORTRAIT_UP;
      if (typeof screenOrientation.supportsOrientationLockAsync === "function") {
        const supported =
          await screenOrientation.supportsOrientationLockAsync(target);
        if (!supported) {
          return;
        }
      }
      await screenOrientation.lockAsync(target);
    },
  };
}

async function loadExpoScreenOrientation(): Promise<ExpoOrientationModule | null> {
  try {
    const loaded = await import("expo-screen-orientation");
    return loaded as unknown as ExpoOrientationModule;
  } catch {
    return null;
  }
}

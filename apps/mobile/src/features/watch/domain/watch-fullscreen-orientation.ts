export type WatchOrientationLock = "landscape" | "portrait-up";

export type WatchOrientationController = {
  readonly lockAsync: (lock: WatchOrientationLock) => Promise<void>;
};

let controller: WatchOrientationController | null = null;
let previousLock: Promise<void> = Promise.resolve();

export function setWatchOrientationController(
  next: WatchOrientationController | null,
): void {
  controller = next;
  previousLock = Promise.resolve();
}

export const setWatchOrientationControllerForTests = setWatchOrientationController;

export function getWatchOrientationController(): WatchOrientationController | null {
  return controller;
}

export async function allowFullscreenLandscapeOrientation(): Promise<boolean> {
  return requestOrientationLock("landscape");
}

export async function restorePortraitOrientation(): Promise<boolean> {
  return requestOrientationLock("portrait-up");
}

function requestOrientationLock(lock: WatchOrientationLock): Promise<boolean> {
  const activeController = controller;
  if (!activeController) return Promise.resolve(false);
  const requested = previousLock.then(() => activeController.lockAsync(lock));
  previousLock = requested.then(
    () => undefined,
    () => undefined,
  );
  return requested.then(
    () => true,
    () => false,
  );
}

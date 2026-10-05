import type { MultistreamResourceMonitor } from "../capabilities/resource-admission";

export interface ForegroundState {
  isForeground(): boolean;
  subscribe(listener: (foreground: boolean) => void): () => void;
}

export function createForegroundMultistreamResourceMonitor(
  foreground: ForegroundState,
): MultistreamResourceMonitor {
  let release: (() => void) | null = null;
  let disposed = false;
  return {
    subscribe(recheck) {
      release?.();
      if (disposed) return () => {};
      let active = true;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let checking = false;
      const cancelTimer = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      };
      const sample = () => {
        if (!active || checking || !foreground.isForeground()) return;
        checking = true;
        const finish = () => {
          checking = false;
          schedule();
        };
        void recheck().then(finish, finish);
      };
      const schedule = () => {
        if (!active || checking || !foreground.isForeground() || timer !== null)
          return;
        timer = setTimeout(() => {
          timer = null;
          sample();
        }, 30_000);
      };
      const unsubscribe = foreground.subscribe((isForeground) => {
        if (isForeground) {
          cancelTimer();
          sample();
        } else cancelTimer();
      });
      schedule();
      const stop = () => {
        if (!active) return;
        active = false;
        cancelTimer();
        unsubscribe();
        if (release === stop) release = null;
      };
      release = stop;
      return stop;
    },
    dispose() {
      disposed = true;
      release?.();
    },
  };
}

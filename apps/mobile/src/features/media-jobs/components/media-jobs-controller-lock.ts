import { toSerializedTimestamp } from "@streamfusion/core/activity";
import type { MediaJobSnapshot } from "@streamfusion/core/media-jobs";

import type { MediaJobWorkflow } from "../capabilities/media-jobs";

export const MEDIA_JOB_RECOVERY_FAILED =
  "Recovery failed. Recover again to retry.";

export type ExclusiveGate = {
  readonly run: <T>(work: () => Promise<T>) => Promise<T>;
};

export type UserLockResult<T> =
  | { readonly kind: "busy" }
  | { readonly kind: "done"; readonly value: T };

export function createExclusiveGate(): ExclusiveGate {
  let tail: Promise<void> = Promise.resolve();
  return {
    run: async <T>(work: () => Promise<T>): Promise<T> => {
      const previous = tail;
      let release: () => void = () => undefined;
      tail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await work();
      } finally {
        release();
      }
    },
  };
}

export async function withUserLock<T>(
  persistGate: ExclusiveGate,
  userLock: { current: boolean },
  setBusy: (busy: boolean) => void,
  work: () => Promise<T>,
): Promise<UserLockResult<T>> {
  if (userLock.current) return { kind: "busy" };
  userLock.current = true;
  setBusy(true);
  try {
    return { kind: "done", value: await persistGate.run(work) };
  } finally {
    userLock.current = false;
    setBusy(false);
  }
}

export async function recoverInBackground(options: {
  readonly active?: () => boolean;
  readonly persistGate: ExclusiveGate;
  readonly recoverInFlight: { current: boolean };
  readonly setJobs: (jobs: readonly MediaJobSnapshot[]) => void;
  readonly setStatus: (status: string) => void;
  readonly userLock: { current: boolean };
  readonly workflow: MediaJobWorkflow;
}): Promise<void> {
  if (options.userLock.current || options.recoverInFlight.current) return;
  options.recoverInFlight.current = true;
  try {
    const next = await options.persistGate.run(() =>
      options.workflow.recoverAll(
        toSerializedTimestamp(new Date().toISOString()),
      ),
    );
    if (options.active && !options.active()) return;
    options.setJobs(next);
  } catch {
    if (options.active && !options.active()) return;
    options.setStatus(MEDIA_JOB_RECOVERY_FAILED);
  } finally {
    options.recoverInFlight.current = false;
  }
}

/**
 * Resolve after `ms` milliseconds. The single sanctioned `setTimeout` for genuinely
 * imperative async delays (e.g. exponential backoff before a retry). Do NOT use it
 * to fake-await a signal that is actually observable — await that signal instead.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type CancellableSleepResult = { ok: true } | { ok: false; reason: "cancelled" };

export interface CancellableSleep {
  readonly result: Promise<CancellableSleepResult>;
  cancel(): boolean;
}

/**
 * Start a one-shot delay that can be physically cancelled. Cancellation settles
 * `result` as `{ ok: false, reason: "cancelled" }`; completion settles it as
 * `{ ok: true }`.
 *
 * `options.unref` is for Node/Electron-main callers whose delay must not keep
 * the process alive. Browser timers have no `.unref()` and remain supported.
 */
export function createCancellableSleep(
  ms: number,
  options?: { unref?: boolean }
): CancellableSleep {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let resolveResult!: (result: CancellableSleepResult) => void;

  const result = new Promise<CancellableSleepResult>((resolve) => {
    resolveResult = resolve;
  });

  timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    timer = undefined;
    resolveResult({ ok: true });
  }, ms);

  if (options?.unref) {
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  return {
    result,
    cancel: () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      timer = undefined;
      resolveResult({ ok: false, reason: "cancelled" });
      return true;
    },
  };
}

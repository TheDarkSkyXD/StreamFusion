/**
 * Resolve after `ms` milliseconds. The single sanctioned `setTimeout` for genuinely
 * imperative async delays (e.g. exponential backoff before a retry). Do NOT use it
 * to fake-await a signal that is actually observable — await that signal instead.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

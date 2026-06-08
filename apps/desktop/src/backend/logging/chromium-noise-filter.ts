/**
 * chromium-noise-filter.ts
 *
 * Predicate that flags two classes of harmless Chromium ERROR lines so the
 * logger pipeline can demote them to debug. They are not actionable: the GPU
 * probe always misses on hardware without that DirectComposition revision,
 * and DevTools' Autofill domain isn't implemented in Electron's Chromium.
 * Leaving them at ERROR drowns real failures in the session log.
 */

const IDCOMPOSITION_PROBE = /QueryInterface to IDComposition(Device|Visual)\d+ failed/;
const AUTOFILL_NOT_FOUND = /Request Autofill\.\w+ failed\. \{"code":-32601/;

export function isHarmlessChromiumNoise(line: string): boolean {
  return IDCOMPOSITION_PROBE.test(line) || AUTOFILL_NOT_FOUND.test(line);
}

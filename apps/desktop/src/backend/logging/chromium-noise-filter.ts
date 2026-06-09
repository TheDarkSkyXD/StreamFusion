/**
 * chromium-noise-filter.ts
 *
 * Predicate that flags known-harmless Chromium ERROR lines so the
 * logger pipeline can demote them to debug. They are not actionable: the GPU
 * probe always misses on hardware without that DirectComposition revision,
 * DevTools' Autofill domain isn't implemented in Electron's Chromium, and
 * transient SharedImageManager mailbox misses are compositor cleanup races,
 * disk-cache size mismatches and invalid-entry cleanup self-heal when Chromium
 * rebuilds cache metadata,
 * hostless SSL net_error -101 lines are connection resets from remote peers
 * with no URL context to action, VizNullHypothesis' own message explicitly
 * says it is not a warning, and dev-only Vite/React DevTools console banners
 * do not help runtime stream diagnosis.
 */

const IDCOMPOSITION_PROBE = /QueryInterface to IDComposition(Device|Visual)\d+ failed/;
const AUTOFILL_NOT_FOUND = /Request Autofill\.\w+ failed\. \{"code":-32601/;
const SHARED_IMAGE_MAILBOX_MISS =
  /SharedImageManager::ProduceSkia: Trying to Produce a Skia representation from a non-existent mailbox\./;
const DISK_CACHE_INVALID_CURRENT_SIZE = /backend_impl\.cc\(\d+\).*Invalid cache \(current\) size/;
const DISK_CACHE_DESTROYING_INVALID_ENTRY = /backend_impl\.cc\(\d+\).*Destroying invalid entry\./;
const SSL_CONNECTION_RESET = /ssl_client_socket_impl\.cc\(\d+\).*net_error -101\b/;
const VIZ_NULL_HYPOTHESIS = /VizNullHypothesis is disabled \(not a warning\)/;
const VITE_DEV_CLIENT = /\[vite\] (connecting|connected)\.{1,3}/;
const REACT_DEVTOOLS_RECOMMENDATION =
  /Download the React DevTools for a better development experience/;

export function isHarmlessChromiumNoise(line: string): boolean {
  return (
    IDCOMPOSITION_PROBE.test(line) ||
    AUTOFILL_NOT_FOUND.test(line) ||
    SHARED_IMAGE_MAILBOX_MISS.test(line) ||
    DISK_CACHE_INVALID_CURRENT_SIZE.test(line) ||
    DISK_CACHE_DESTROYING_INVALID_ENTRY.test(line) ||
    SSL_CONNECTION_RESET.test(line) ||
    VIZ_NULL_HYPOTHESIS.test(line) ||
    VITE_DEV_CLIENT.test(line) ||
    REACT_DEVTOOLS_RECOMMENDATION.test(line)
  );
}

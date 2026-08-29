/**
 * useChatSettingsSync — test-only inspection helpers.
 *
 * This module is the ONLY supported entry point for tests that need to peek
 * at or reset the hook's module-scoped state (`inFlight` Set, provenance
 * Map). Importing these helpers from `useChatSettingsSync.ts` directly is
 * forbidden — they don't live there anymore. Production code MUST NOT
 * import this file; only tests should.
 *
 * Why a sibling: the four `__`-prefixed helpers used to live on the hook
 * module itself, which meant they shipped as part of every production
 * bundle and any consumer could find them via auto-import. Moving them
 * here keeps the production export surface clean (just the hook +
 * translator) without losing test introspection.
 *
 * Source: ce-code-review run 20260519-000238-9dcc1f38, finding R10
 * (cross-reviewer: maintainability M6 + project-standards PS-004 +
 * kieran-typescript K-08).
 */

import type { Provenance } from "./useChatSettingsSync";
import { __debugProvenance, inFlight } from "./useChatSettingsSync";

/** Read the last recorded write provenance for a room-state key. */
export function getProvenance(key: string): Provenance | undefined {
  return __debugProvenance.get(key);
}

/** Clear all recorded provenance entries between tests. */
export function resetProvenance(): void {
  __debugProvenance.clear();
}

/** Whether the in-flight guard currently holds the given key. */
export function isInFlight(key: string): boolean {
  return inFlight.has(key);
}

/** Clear the in-flight guard between tests. */
export function resetInFlight(): void {
  inFlight.clear();
}

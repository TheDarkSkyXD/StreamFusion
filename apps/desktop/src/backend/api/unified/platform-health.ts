/**
 * Per-Platform health tracker. See ADR-0002 + PRD #50.
 *
 * `healthy → degraded` flips when the rolling failure-rate threshold is met.
 * Recovery and the local-burst `down` state arrive in later slices and are
 * absent here. Failure classification + excluded shapes (401/403/404/429/parse)
 * are enforced at the call site, not in this module. In-memory only.
 */

import type { Platform } from "../../../shared/auth-types";

export type PlatformHealth = "healthy" | "degraded" | "down";

export type PlatformFailureClass = "timeout" | "server-5xx" | "net-error";

/** Failure-rate threshold to trip `healthy → degraded`. Hysteresis target for slice 02 recovery is the asymmetric 40%. */
export const DEGRADED_FAILURE_RATE = 0.6;
/** Minimum number of attempts in the rolling window before the trip evaluator can fire. */
export const DEGRADED_MIN_SAMPLE = 8;
/** Rolling-window length the failure-rate evaluator looks back over. */
export const ROLLING_WINDOW_MS = 60_000;

export interface PlatformHealthEvent {
  platform: Platform;
  status: PlatformHealth;
  startedAt: number;
}

type Outcome = { ts: number; failed: boolean };

interface PlatformState {
  outcomes: Outcome[];
  status: PlatformHealth;
  startedAt: number;
}

const states: Record<Platform, PlatformState> = {
  kick: { outcomes: [], status: "healthy", startedAt: 0 },
  twitch: { outcomes: [], status: "healthy", startedAt: 0 },
};

const listeners = new Set<(event: PlatformHealthEvent) => void>();

function pruneWindow(state: PlatformState, now: number): void {
  const cutoff = now - ROLLING_WINDOW_MS;
  while (state.outcomes.length > 0 && state.outcomes[0].ts < cutoff) {
    state.outcomes.shift();
  }
}

function evaluate(platform: Platform, now: number): void {
  const state = states[platform];
  if (state.status !== "healthy") return;

  if (state.outcomes.length < DEGRADED_MIN_SAMPLE) return;

  const failures = state.outcomes.reduce((n, o) => n + (o.failed ? 1 : 0), 0);
  const rate = failures / state.outcomes.length;
  if (rate < DEGRADED_FAILURE_RATE) return;

  state.status = "degraded";
  state.startedAt = now;
  emit({ platform, status: "degraded", startedAt: now });
}

function emit(event: PlatformHealthEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

export function recordPlatformFailure(platform: Platform, _errorClass: PlatformFailureClass): void {
  const now = Date.now();
  const state = states[platform];
  pruneWindow(state, now);
  state.outcomes.push({ ts: now, failed: true });
  evaluate(platform, now);
}

export function recordPlatformSuccess(platform: Platform): void {
  const now = Date.now();
  const state = states[platform];
  pruneWindow(state, now);
  state.outcomes.push({ ts: now, failed: false });
  evaluate(platform, now);
}

export function getPlatformHealth(platform: Platform): PlatformHealth {
  return states[platform].status;
}

export function isPlatformHealthy(platform: Platform): boolean {
  return states[platform].status === "healthy";
}

export function onPlatformHealthChanged(
  listener: (event: PlatformHealthEvent) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset; `vi.resetModules` doesn't re-evaluate ESM under vite-node reliably. */
export function __resetPlatformHealthForTests(): void {
  for (const key of Object.keys(states) as Platform[]) {
    states[key].outcomes.length = 0;
    states[key].status = "healthy";
    states[key].startedAt = 0;
  }
  listeners.clear();
}

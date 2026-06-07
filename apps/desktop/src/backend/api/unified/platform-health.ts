/**
 * Per-Platform health tracker. See ADR-0002 + PRD #50.
 *
 * `healthy → degraded` trips on rolling failure-rate exceeding 60% over ≥8
 * samples. `degraded → healthy` recovers after a 30s cooldown when the rate
 * drops below 40% (asymmetric hysteresis). `down` state triggers on a burst
 * of 3+ local net::ERR_* errors within 2s, or an explicit crash signal;
 * self-clears 3s after the last error. In-memory only.
 */

import { logger } from "../../logging/logger";
import type { Platform } from "../../../shared/auth-types";

export type PlatformHealth = "healthy" | "degraded" | "down";

export type PlatformFailureClass = "timeout" | "server-5xx" | "net-error";

/** Failure-rate threshold to trip `healthy → degraded`. */
export const DEGRADED_FAILURE_RATE = 0.6;
/** Minimum number of attempts in the rolling window before the trip evaluator can fire. */
export const DEGRADED_MIN_SAMPLE = 8;
/** Rolling-window length the failure-rate evaluator looks back over. */
export const ROLLING_WINDOW_MS = 60_000;
/** Failure-rate threshold below which `degraded → healthy` recovery can fire (asymmetric hysteresis). */
export const RECOVERY_FAILURE_RATE = 0.4;
/** Minimum time in `degraded` before the recovery evaluator can fire. */
export const RECOVERY_WINDOW_MS = 30_000;

/** Rolling window for net::ERR_* burst detection. */
export const ERROR_BURST_WINDOW_MS = 2_000;
/** Number of net::ERR_* errors within the burst window to trip `down`. */
export const ERROR_BURST_THRESHOLD = 3;
/** Duration (ms) the `down` state persists after the last triggering error. */
export const DOWN_DURATION_MS = 3_000;

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
  /** Timestamp (epoch ms) until which the `down` state is active. 0 = not down. */
  downUntil: number;
  /** Rolling timestamps of recent net::ERR_* errors for burst detection. */
  netErrorTimestamps: number[];
}

const states: Record<Platform, PlatformState> = {
  kick: { outcomes: [], status: "healthy", startedAt: 0, downUntil: 0, netErrorTimestamps: [] },
  twitch: { outcomes: [], status: "healthy", startedAt: 0, downUntil: 0, netErrorTimestamps: [] },
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
  logger.warn("PlatformHealth", `${platform} degraded: ${failures}/${state.outcomes.length} requests failed in last 60s. Backing off.`);
  emit({ platform, status: "degraded", startedAt: now });
}

function evaluateRecovery(platform: Platform, now: number): void {
  const state = states[platform];
  if (state.status !== "degraded") return;
  if (now - state.startedAt < RECOVERY_WINDOW_MS) return;
  if (state.outcomes.length === 0) return;

  const failures = state.outcomes.reduce((n, o) => n + (o.failed ? 1 : 0), 0);
  const rate = failures / state.outcomes.length;
  if (rate >= RECOVERY_FAILURE_RATE) return;

  const degradedDurationSec = Math.round((now - state.startedAt) / 1000);
  state.status = "healthy";
  state.startedAt = now;
  logger.warn("PlatformHealth", `${platform} recovered after ${degradedDurationSec}s`);
  emit({ platform, status: "healthy", startedAt: now });
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
  evaluateRecovery(platform, now);
}

export function recordPlatformSuccess(platform: Platform): void {
  const now = Date.now();
  const state = states[platform];
  pruneWindow(state, now);
  state.outcomes.push({ ts: now, failed: false });
  evaluate(platform, now);
  evaluateRecovery(platform, now);
}

/**
 * Record a local net::ERR_* error for burst detection. When 3+ errors arrive
 * within 2s, the platform transitions to `down` for 3s after the last error.
 * Each call while already down extends `downUntil` by 3s from now.
 */
export function recordPlatformLocalNetError(platform: Platform): void {
  const now = Date.now();
  const state = states[platform];

  // Prune errors outside the burst window.
  state.netErrorTimestamps.push(now);
  while (
    state.netErrorTimestamps.length > 0 &&
    now - state.netErrorTimestamps[0] > ERROR_BURST_WINDOW_MS
  ) {
    state.netErrorTimestamps.shift();
  }

  if (state.netErrorTimestamps.length >= ERROR_BURST_THRESHOLD) {
    const wasDown = state.downUntil > 0 && now < state.downUntil;
    state.downUntil = now + DOWN_DURATION_MS;
    if (!wasDown) {
      logger.warn("PlatformHealth", `${platform} down: local network crash detected`);
      emit({ platform, status: "down", startedAt: now });
    }
  }
}

/**
 * Immediately transition to `down` for 3s. Used by the crash handler in main.ts
 * for explicit GPU/Utility process crash signals that don't need burst detection.
 */
export function recordPlatformCrash(platform: Platform): void {
  const now = Date.now();
  const state = states[platform];
  const wasDown = state.downUntil > 0 && now < state.downUntil;
  state.downUntil = now + DOWN_DURATION_MS;
  if (!wasDown) {
    logger.warn("PlatformHealth", `${platform} down: local network crash detected`);
    emit({ platform, status: "down", startedAt: now });
  }
}

/**
 * Resolve the effective health status. `down` is time-boxed: if `downUntil`
 * has expired, fall back to whatever the failure-rate signal says.
 */
export function getPlatformHealth(platform: Platform): PlatformHealth {
  const state = states[platform];
  if (state.downUntil > 0) {
    if (Date.now() < state.downUntil) return "down";
    state.downUntil = 0;
    state.netErrorTimestamps.length = 0;
  }
  return state.status;
}

export function isPlatformHealthy(platform: Platform): boolean {
  return getPlatformHealth(platform) === "healthy";
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
    states[key].downUntil = 0;
    states[key].netErrorTimestamps.length = 0;
  }
  listeners.clear();
}

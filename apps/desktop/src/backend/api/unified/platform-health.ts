/**
 * Per-Platform health tracker. See ADR-0002 + PRD #50.
 *
 * `healthy → degraded` trips on rolling failure-rate exceeding 60% over ≥8
 * samples. `degraded → healthy` recovers after a 30s cooldown when the rate
 * drops below 40% (asymmetric hysteresis). The local-burst `down` state
 * arrives in a later slice. In-memory only.
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

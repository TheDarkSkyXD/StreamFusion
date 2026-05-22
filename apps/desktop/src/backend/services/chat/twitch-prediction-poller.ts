/**
 * Twitch Prediction Poller (U3)
 *
 * 5s GQL polling loop that reads `channel.latestPrediction` and emits
 * `predictionUpdate` through `twitchChatService` on material change. Replaces
 * the broadcaster-scope EventSub path for viewers (predictions cannot be
 * read via EventSub without `channel:read:predictions`, which is the
 * broadcaster's own scope) and complements the anonymous Hermes WebSocket in
 * `twitch-hermes-client.ts` for two reasons:
 *
 *   1. Hermes is anonymous-only; the GQL read path carries the viewer's
 *      self-state (`viewerOutcomeId` / `viewerStake`) when a Bearer token is
 *      attached.
 *   2. GQL polling is a backstop when the WebSocket can't connect (proxy,
 *      transient network, Twitch rotating the Hermes endpoint).
 *
 * Lifecycle (per-channelLogin Map):
 *   - `startTwitchPredictionPolling(login)` fires a poll immediately, then
 *     sets a 5s interval. Idempotent on repeated calls for the same login.
 *   - `stopTwitchPredictionPolling(login)` clears the interval and drops state.
 *   - Two consecutive null responses → poller stops (no active prediction);
 *     a fresh `start` call re-arms the loop.
 *   - Visibility-aware: scheduled tick is skipped when
 *     `document.visibilityState === "hidden"` (mirror `useHelixPoll.ts`).
 *   - 401 handling: one refresh-and-retry via
 *     `window.electronAPI.auth.getValidTwitchToken()`. Failure pauses the poll
 *     until external lifecycle re-triggers `start`.
 *
 * Emit-on-change posture: previous `UnifiedPrediction` snapshot kept per
 * login. A "material" change is any of: new prediction id, status change,
 * winning_outcome_id change, or a tally delta on any outcome (totalAmount
 * delta > 0).
 *
 * Patterns mirrored from:
 *   - `apps/desktop/src/backend/services/chat/twitch-pin-poller.ts` (Map-keyed
 *     state, interval lifecycle, emit-on-change, `__reset` test helper)
 *   - `apps/desktop/src/hooks/useHelixPoll.ts` (visibility-aware polling)
 *   - `apps/desktop/src/backend/api/platforms/twitch/twitch-requestor.ts:206-215`
 *     (401 → refresh + one retry)
 */

import type { UnifiedPrediction } from "../../../shared/chat-types";

import { fetchChannelPrediction } from "../../api/platforms/twitch/twitch-gql-predictions";
import { twitchChatService } from "./twitch-chat";

const POLL_INTERVAL_MS = 5_000;
/** Stop polling after this many consecutive null responses. Resumed externally
 *  by another `start` call. */
const NULL_RESPONSES_BEFORE_STOP = 2;

interface PollState {
  /** Channel login (lowercased) this poller targets. */
  login: string;
  /** Active interval timer. */
  timer: ReturnType<typeof setInterval>;
  /** Last emitted snapshot. Diffing key for emit-on-change. */
  lastSnapshot: UnifiedPrediction | null;
  /** Consecutive null responses since the last non-null. Hits
   *  NULL_RESPONSES_BEFORE_STOP → poller stops. */
  nullStreak: number;
  /** Tracks 401-retry attempts within a single tick so we don't loop. */
  pendingRefresh: boolean;
  /** Set by stop() to prevent an in-flight poll from emitting after teardown. */
  cancelled: boolean;
}

const pollers = new Map<string, PollState>();

/** Start polling a channel's prediction. Safe to call repeatedly for the
 *  same channel — duplicate calls are ignored. */
export function startTwitchPredictionPolling(channelLogin: string): void {
  const login = channelLogin.toLowerCase();
  if (pollers.has(login)) return;

  const state: PollState = {
    login,
    // Timer set below — needs the state object to exist first for `poll` to
    // look it up by login.
    timer: 0 as unknown as ReturnType<typeof setInterval>,
    lastSnapshot: null,
    nullStreak: 0,
    pendingRefresh: false,
    cancelled: false,
  };
  pollers.set(login, state);
  state.timer = setInterval(() => {
    if (!isVisible()) return;
    void poll(login);
  }, POLL_INTERVAL_MS);
  // Fire once immediately so the banner appears on mount if a prediction is
  // active, not five seconds later. Visibility check only applies to the
  // scheduled tick — the initial fire mirrors the pin poller (the user
  // explicitly triggered the start, so they expect the bootstrap fetch).
  void poll(login);
}

/** Stop polling and clear state for a channel. */
export function stopTwitchPredictionPolling(channelLogin: string): void {
  const login = channelLogin.toLowerCase();
  const state = pollers.get(login);
  if (!state) return;
  state.cancelled = true;
  clearInterval(state.timer);
  pollers.delete(login);
}

/** Test helper — drop all pollers between test cases. */
export function __resetTwitchPredictionPollers(): void {
  for (const state of pollers.values()) {
    state.cancelled = true;
    clearInterval(state.timer);
  }
  pollers.clear();
}

async function poll(login: string): Promise<void> {
  const state = pollers.get(login);
  if (!state || state.cancelled) return;

  let prediction: UnifiedPrediction | null;
  try {
    prediction = await fetchWithAuthRetry(login, state);
  } catch (error) {
    // Network blip / Twitch hiccup — silent skip; try again on the next tick.
    if (process.env.NODE_ENV !== "production") {
      console.debug("[twitch-prediction-poller] fetch failed:", login, error);
    }
    return;
  }

  // Re-check after the async hop — `stop` may have fired while we awaited.
  if (state.cancelled || !pollers.has(login)) return;

  if (prediction === null) {
    state.nullStreak += 1;
    // If we had a snapshot before and now it's gone, the prediction ended
    // server-side and was reaped from `latestPrediction`. We emit nothing
    // because the last-known snapshot already shows the RESOLVED / CANCELED
    // status; the widget's TTL handles dismissal. Two consecutive nulls →
    // stop polling. The poller can be re-armed by a fresh `start` call
    // (chat reconnect, channel re-mount, page visible after long sleep).
    if (state.nullStreak >= NULL_RESPONSES_BEFORE_STOP) {
      stopTwitchPredictionPolling(login);
    }
    return;
  }

  state.nullStreak = 0;
  if (!hasMaterialChange(state.lastSnapshot, prediction)) return;
  state.lastSnapshot = prediction;
  twitchChatService.emit("predictionUpdate", prediction);
}

/**
 * Wrapper around `fetchChannelPrediction` that handles the 401 → refresh +
 * one retry path. The poller runs in the renderer, so `twitchAuthService`
 * (main-process) cannot be imported directly; the refresh is routed through
 * the preload bridge `window.electronAPI.auth.getValidTwitchToken()`.
 *
 * On the first call, the token is grabbed via `getValidTwitchToken` (which
 * itself refreshes if expired). If the call returns 401 anyway (token rotated
 * server-side between fetch and now), we retry once with a freshly-fetched
 * token. If the retry also fails, the error bubbles to the caller.
 */
async function fetchWithAuthRetry(
  login: string,
  state: PollState,
): Promise<UnifiedPrediction | null> {
  const token = await getValidTwitchTokenSafe();
  try {
    return await fetchChannelPrediction(login, { accessToken: token ?? undefined });
  } catch (error) {
    if (!is401(error) || state.pendingRefresh) throw error;
    state.pendingRefresh = true;
    try {
      const fresh = await getValidTwitchTokenSafe();
      // If we had no token to begin with, a 401 from the anonymous call is
      // surprising — Twitch's GQL read may have started requiring auth.
      // Re-attempt anonymously once anyway so the failure mode is visible at
      // the next tick.
      return await fetchChannelPrediction(login, {
        accessToken: fresh ?? undefined,
      });
    } finally {
      state.pendingRefresh = false;
    }
  }
}

async function getValidTwitchTokenSafe(): Promise<string | null> {
  // Guard against unit-test contexts that don't stub the preload bridge.
  if (
    typeof window === "undefined" ||
    !window.electronAPI?.auth?.getValidTwitchToken
  ) {
    return null;
  }
  try {
    return await window.electronAPI.auth.getValidTwitchToken();
  } catch {
    return null;
  }
}

function is401(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // `fetchChannelPrediction` throws `ChannelPredictionContext 401` on non-2xx.
  return error.message.includes("401");
}

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * Material-change detector. Returns true when the new payload differs from
 * the previous snapshot in a way the widget should re-render for:
 *   - First non-null response (last snapshot is null)
 *   - Different prediction id
 *   - Different status
 *   - Different winningOutcomeId
 *   - Any outcome's totalAmount changed
 *
 * Returns false when only ephemeral fields differ (e.g. unchanged tallies
 * across ticks) — keeps render churn low and avoids re-firing the banner's
 * 60s auto-dismiss timer.
 */
function hasMaterialChange(
  prev: UnifiedPrediction | null,
  next: UnifiedPrediction,
): boolean {
  if (!prev) return true;
  if (prev.id !== next.id) return true;
  if (prev.status !== next.status) return true;
  if (prev.winningOutcomeId !== next.winningOutcomeId) return true;
  if (prev.viewerOutcomeId !== next.viewerOutcomeId) return true;
  // Outcome-level diff: any tally change.
  const prevByOutcome = new Map(
    prev.outcomes.map((o) => [o.id, o.totalAmount] as const),
  );
  for (const o of next.outcomes) {
    const prior = prevByOutcome.get(o.id);
    if (prior === undefined) return true; // new outcome
    if (prior !== o.totalAmount) return true;
  }
  return false;
}

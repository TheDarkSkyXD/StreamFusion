/**
 * Kick — Predictions REST Read
 *
 * `GET /api/v2/channels/{channelSlug}/predictions/latest` — returns the
 * channel's currently active or most-recently-ended prediction. Used by
 * `kick-predictions-service` to seed the widget on chat acquire so viewers
 * who join mid-prediction see the banner without waiting for the next
 * Pusher event.
 *
 * Auth posture (per discovery notes, 2026-05-22): anonymous-first. The kick.com
 * UI gates its Pusher subscription on `session.status === "authenticated"`,
 * but the REST read appears to accept anonymous callers — verify at runtime
 * by attempting the call without a Bearer header first; if the server
 * returns 401 and the caller supplied a token, retry authed.
 *
 * Returns `null` for 404 / 204 / explicitly-null bodies. Wraps non-success
 * results in a discriminated error result mirroring `kick-pin-mutations.ts`.
 *
 * Endpoint shape derived from `assets.kick.com/main/_next/static/chunks/00d8vh9mhsenj.js`
 * — see `docs/brainstorms/2026-05-22-kick-predictions-discovery-notes.md`.
 */

import type { KickPredictionPayload } from "./kick-types";

const KICK_API_BASE = "https://kick.com/api/v2";
const REQUEST_TIMEOUT_MS = 10_000;

export type KickPredictionsErrorKind =
  "unauthenticated" | "forbidden" | "not-found" | "network" | "unknown";

export type KickPredictionsResult =
  | { ok: true; payload: KickPredictionPayload | null }
  | { ok: false; kind: KickPredictionsErrorKind; message: string };

interface GetLatestOptions {
  /** Optional OAuth Bearer token from our Kick auth flow. Used only on the
   *  authed-retry path when the anonymous call returns 401. */
  accessToken?: string;
}

function classify(status: number): KickPredictionsErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status >= 500) return "network";
  return "unknown";
}

/**
 * Attempt one REST call against the predictions/latest endpoint. The auth
 * header is included only when `bearer` is non-null — keeping anonymous and
 * authed flavors clearly separated so the caller can pick the retry posture.
 */
async function fetchOnce(
  channelSlug: string,
  bearer: string | null
): Promise<KickPredictionsResult> {
  const url = `${KICK_API_BASE}/channels/${encodeURIComponent(channelSlug)}/predictions/latest`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message };
  }

  // 404 means "no active or recent prediction" on this surface — model that
  // as a clean null rather than an error so callers can branch on `payload`.
  if (res.status === 404) return { ok: true, payload: null };
  // 204 (no content) → same treatment.
  if (res.status === 204) return { ok: true, payload: null };

  if (!res.ok) {
    return { ok: false, kind: classify(res.status), message: `${res.status}` };
  }

  // Body may be:
  //   - { data: <Prediction> } (Kick's standard envelope on many v2 routes)
  //   - <Prediction> directly
  //   - null / empty (no active prediction)
  // Tolerate all three; return null when no recognizable prediction shape.
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: true, payload: null };
  }

  const prediction = extractPrediction(body);
  return { ok: true, payload: prediction };
}

function extractPrediction(body: unknown): KickPredictionPayload | null {
  if (body === null || body === undefined) return null;
  if (typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  // Prefer the wrapped `data` envelope when present.
  const candidate =
    obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>) : obj;
  if (typeof candidate.id !== "string" || typeof candidate.state !== "string") {
    // Doesn't look like a Prediction — treat as "no prediction".
    return null;
  }
  return candidate as unknown as KickPredictionPayload;
}

/**
 * Read the most recent active-or-ended prediction for a channel.
 *
 * Tries anonymously first. If the server returns 401 AND the caller supplied
 * an `accessToken`, retries once with the Bearer header set. Any other
 * non-success result is surfaced as-is — the caller decides whether to retry.
 */
export async function getLatestPrediction(
  channelSlug: string,
  opts: GetLatestOptions = {}
): Promise<KickPredictionsResult> {
  const anonResult = await fetchOnce(channelSlug, null);
  if (anonResult.ok) return anonResult;
  if (anonResult.kind === "unauthenticated" && opts.accessToken) {
    return fetchOnce(channelSlug, opts.accessToken);
  }
  return anonResult;
}

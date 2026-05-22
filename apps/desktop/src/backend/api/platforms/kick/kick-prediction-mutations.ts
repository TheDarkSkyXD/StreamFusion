/**
 * Kick — Prediction Vote Mutation
 *
 * Endpoint (from discovery, 2026-05-22):
 *
 *   POST /api/v2/channels/{channelSlug}/predictions/vote
 *     body: { outcomeId, amount }
 *
 * Auth: Bearer token from our Kick OAuth flow. Mirrors `kick-pin-mutations.ts`
 * end-to-end (request shape, classify-on-status, discriminated result,
 * AbortSignal handling). P0a confirmed Bearer auth in the renderer context
 * works fine — Cloudflare lets the real Chromium fingerprint through.
 *
 * Source: `assets.kick.com/main/_next/static/chunks/00d8vh9mhsenj.js` — see
 * `docs/brainstorms/2026-05-22-kick-predictions-discovery-notes.md`.
 */

const KICK_API_BASE = "https://kick.com/api/v2";
const REQUEST_TIMEOUT_MS = 10_000;
/** Kick's documented stake range per help center: 10 – 250,000 channel points. */
const KICK_VOTE_AMOUNT_MAX = 250_000;
/** Max length for raw response-body text we surface in error `message`. */
const MESSAGE_BODY_TRUNCATE = 200;

export type KickPredictionVoteErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "outcomeLocked"
  | "insufficientBalance"
  | "predictionGone"
  | "invalidInput"
  | "network"
  | "unknown";

export type KickPredictionVoteResult =
  | { ok: true; payload?: unknown }
  | { ok: false; kind: KickPredictionVoteErrorKind; message: string };

export interface KickPredictionVotePayload {
  channelSlug: string;
  /** Used by callers for the in-flight gate key; not part of the request body. */
  predictionId: string;
  outcomeId: string;
  amount: number;
  accessToken: string;
}

/**
 * Strip token-shaped substrings (40+ char alphanumeric runs, JWT-like
 * base64 triplets) and clamp to a fixed length. Belt-and-suspenders for
 * the `kind: "unknown"` / `kind: "network"` paths even though Kick's REST
 * responses are unlikely to echo tokens.
 */
function sanitizeMessage(raw: string): string {
  // JWT-like: three base64url segments separated by dots, each 10+ chars.
  const jwtStripped = raw.replace(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted]");
  // Bare 40+ char alphanumeric run.
  const alnumStripped = jwtStripped.replace(/[A-Za-z0-9]{40,}/g, "[redacted]");
  return alnumStripped.length > MESSAGE_BODY_TRUNCATE
    ? alnumStripped.slice(0, MESSAGE_BODY_TRUNCATE)
    : alnumStripped;
}

/**
 * Stringify an arbitrary parsed response body for error messages. Returns a
 * sanitized, truncated string suitable for `message`. Falsy / empty inputs
 * collapse to the bare status string supplied by the caller.
 */
function bodyToMessage(body: unknown, fallback: string): string {
  if (body === null || body === undefined) return fallback;
  let raw: string;
  if (typeof body === "string") {
    raw = body;
  } else if (typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (typeof obj.message === "string") raw = obj.message;
    else if (typeof obj.error === "string") raw = obj.error;
    else {
      try {
        raw = JSON.stringify(body);
      } catch {
        return fallback;
      }
    }
  } else {
    raw = String(body);
  }
  if (!raw) return fallback;
  return sanitizeMessage(raw);
}

/**
 * Classify a non-success response. 422 splits three ways based on body text;
 * everything else is a clean status-to-kind map.
 */
function classify(status: number, body: unknown): KickPredictionVoteErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "predictionGone";
  if (status >= 500) return "network";
  if (status === 422) {
    const haystack = extractBodyText(body).toLowerCase();
    if (
      haystack.includes("insufficient") ||
      haystack.includes("balance") ||
      haystack.includes("points") ||
      haystack.includes("funds")
    ) {
      return "insufficientBalance";
    }
    if (
      haystack.includes("locked") ||
      haystack.includes("closed") ||
      haystack.includes("ended")
    ) {
      return "outcomeLocked";
    }
    return "unknown";
  }
  return "unknown";
}

/** Surface a single searchable text blob from whatever shape the body has. */
function extractBodyText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const pieces: string[] = [];
    if (typeof obj.message === "string") pieces.push(obj.message);
    if (typeof obj.error === "string") pieces.push(obj.error);
    if (typeof obj.detail === "string") pieces.push(obj.detail);
    if (pieces.length > 0) return pieces.join(" ");
    try {
      return JSON.stringify(body);
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * Validate the payload before firing the HTTP request. Returns a result on
 * failure or `null` when the inputs look fine.
 */
function validateInput(payload: KickPredictionVotePayload): KickPredictionVoteResult | null {
  if (!payload.outcomeId) {
    return { ok: false, kind: "invalidInput", message: "outcomeId required" };
  }
  if (payload.amount <= 0) {
    return { ok: false, kind: "invalidInput", message: "amount must be positive" };
  }
  if (payload.amount > KICK_VOTE_AMOUNT_MAX) {
    return {
      ok: false,
      kind: "invalidInput",
      message: `amount exceeds Kick maximum of ${KICK_VOTE_AMOUNT_MAX}`,
    };
  }
  return null;
}

export async function voteOnPrediction(
  payload: KickPredictionVotePayload,
): Promise<KickPredictionVoteResult> {
  const inputError = validateInput(payload);
  if (inputError) return inputError;

  const url = `${KICK_API_BASE}/channels/${encodeURIComponent(payload.channelSlug)}/predictions/vote`;
  const body = {
    outcomeId: payload.outcomeId,
    amount: payload.amount,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${payload.accessToken}`,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) {
      const payloadBody = await res.json().catch(() => undefined);
      return payloadBody === undefined ? { ok: true } : { ok: true, payload: payloadBody };
    }
    const respBody = await res.json().catch(() => null);
    const kind = classify(res.status, respBody);
    const message =
      kind === "unknown"
        ? bodyToMessage(respBody, `${res.status}`)
        : `${res.status}`;
    return { ok: false, kind, message };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, kind: "network", message: "timeout" };
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, kind: "network", message: "timeout" };
    }
    const raw = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message: sanitizeMessage(raw) };
  }
}

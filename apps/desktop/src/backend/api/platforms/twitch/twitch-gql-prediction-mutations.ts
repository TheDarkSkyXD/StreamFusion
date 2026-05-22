/**
 * Twitch GQL — MakePrediction Mutation (viewer-side vote)
 *
 * Casts a viewer vote on a Twitch prediction. Twitch's vote mutation is
 * GraphQL (gql.twitch.tv/gql), NOT Helix — only the broadcaster's
 * channel-points operations live in Helix. Auth uses Twitch's GQL `OAuth`
 * scheme (not Helix's `Bearer`).
 *
 * Persisted query path:
 *   hash:  b44682ecc88358817009f20e69d75081b1e58825bb40aa53d5dbadcc17c881d8
 *   vars:  { input: { eventID, outcomeID, points, transactionID } }
 *
 * All four variables MUST appear in the typed interface — Twitch persisted
 * queries silently drop unlisted variables (see
 * docs/solutions/integration-issues/twitch-gql-search-pagination-skeleton-flicker-loop-2026-05-17.md).
 *
 * Hash is from Tkd-Alex/Twitch-Channel-Points-Miner-v2/constants.py; Twitch
 * rotated GQL hashes on 2025-11-11 so we re-verify before ship. If the hash
 * is rotated again the persisted-query path returns `PersistedQueryNotFound`,
 * at which point we fall back to a document-string mutation with the same
 * variable shape.
 *
 * Android Client-Id `kd1unb4b3q4t58fwlpcbzcbnm76a8fp` — same one used
 * elsewhere in the codebase to bypass Twitch's Client-Integrity pairing.
 *
 * transactionID is auto-generated per call via `crypto.getRandomValues`.
 * The renderer runs with `webSecurity: false` (window-manager.ts:132), so
 * predictable PRNG (`Math.random`) is unsafe — `crypto.getRandomValues`
 * gives us a fresh cryptographically-strong 16-byte hex string each call.
 */

import type { GqlError } from "./twitch-types";

const GQL_ENDPOINT = "https://gql.twitch.tv/gql";
const GQL_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const REQUEST_TIMEOUT_MS = 10_000;
const MAKE_PREDICTION_HASH =
  "b44682ecc88358817009f20e69d75081b1e58825bb40aa53d5dbadcc17c881d8";

/** Twitch's documented maximum stake per vote. */
const TWITCH_MAX_POINTS = 250_000;
/** Cap on raw response text that ends up in `message`. */
const MESSAGE_BODY_TRUNCATE = 200;

const MAKE_PREDICTION_DOC = `mutation MakePrediction($input: MakePredictionInput!) {
  makePrediction(input: $input) {
    prediction {
      id
      status
      points
    }
    error {
      code
    }
  }
}`;

export type MakePredictionErrorKind =
  | "unauthenticated"
  | "outcomeLocked"
  | "insufficientBalance"
  | "predictionGone"
  | "integrity"
  | "invalidInput"
  | "network"
  | "unknown";

export type MakePredictionResult =
  | { ok: true; payload?: unknown }
  | { ok: false; kind: MakePredictionErrorKind; message: string };

export interface MakePredictionPayload {
  accessToken: string;
  eventID: string;
  outcomeID: string;
  points: number;
  /** Optional — auto-generated via crypto.getRandomValues if omitted. */
  transactionID?: string;
}

interface MakePredictionVariables {
  input: {
    eventID: string;
    outcomeID: string;
    points: number;
    transactionID: string;
  };
}

interface MakePredictionResponse {
  data?: {
    makePrediction?: {
      prediction?: unknown;
      error?: { code?: string } | null;
    } | null;
  };
  errors?: GqlError[];
}

/**
 * Generate a fresh 16-byte hex transactionID. NEVER use Math.random — the
 * renderer runs with webSecurity:false and a predictable PRNG could expose
 * the transaction key to malicious content loaded into the renderer.
 */
function generateTransactionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Detect Twitch's integrity-rejection shape. Same predicate used in
 * twitch-gql-client.ts:849 — bare `integrity` substring is too broad
 * (false-positives on schema errors mentioning a `clientIntegrity` field),
 * so we require co-occurrence with `check` / `failed` / `rejected`, OR an
 * `extensions.code` containing `INTEGRITY`.
 */
function isIntegrityRejectionError(err: GqlError): boolean {
  const code = err.extensions?.code ?? "";
  if (code.toUpperCase().includes("INTEGRITY")) return true;
  const msg = err.message.toLowerCase();
  if (!msg.includes("integrity")) return false;
  return msg.includes("check") || msg.includes("failed") || msg.includes("rejected");
}

/**
 * Strip token-shaped substrings and clamp to a fixed length. Matches the
 * U2 hygiene pattern (kick-prediction-mutations.ts). Keeps the renderer
 * from echoing OAuth tokens or JWTs into UI surfaces if Twitch ever
 * happens to reflect headers in error bodies.
 */
function sanitizeMessage(raw: string): string {
  // JWT-like: three base64url segments separated by dots, each 10+ chars.
  const jwtStripped = raw.replace(
    /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    "[redacted]",
  );
  // Bare 40+ char alphanumeric run.
  const alnumStripped = jwtStripped.replace(/[A-Za-z0-9]{40,}/g, "[redacted]");
  return alnumStripped.length > MESSAGE_BODY_TRUNCATE
    ? alnumStripped.slice(0, MESSAGE_BODY_TRUNCATE)
    : alnumStripped;
}

function validateInput(payload: MakePredictionPayload): MakePredictionResult | null {
  if (!payload.eventID) {
    return { ok: false, kind: "invalidInput", message: "eventID required" };
  }
  if (!payload.outcomeID) {
    return { ok: false, kind: "invalidInput", message: "outcomeID required" };
  }
  if (payload.points <= 0) {
    return { ok: false, kind: "invalidInput", message: "points must be positive" };
  }
  if (payload.points > TWITCH_MAX_POINTS) {
    return {
      ok: false,
      kind: "invalidInput",
      message: `points exceeds Twitch maximum of ${TWITCH_MAX_POINTS}`,
    };
  }
  return null;
}

/**
 * Map a `data.makePrediction.error.code` value to our discriminated kind.
 * Returns null when the code is unrecognized — callers surface that as
 * `kind: "unknown"` with the raw (sanitized) code in `message`.
 */
function mapErrorCode(code: string): MakePredictionErrorKind | null {
  switch (code) {
    case "INSUFFICIENT_CHANNEL_POINTS":
      return "insufficientBalance";
    case "EVENT_LOCKED":
    case "OUTCOME_LOCKED":
      return "outcomeLocked";
    case "EVENT_NOT_FOUND":
    case "PREDICTION_NOT_FOUND":
      return "predictionGone";
    default:
      return null;
  }
}

/**
 * Inspect a non-2xx response and decide whether it's an integrity rejection
 * (HTTP 403 plus a body matching the integrity shape). Falls back to a
 * generic network classification otherwise.
 */
function classifyHttpFailure(
  status: number,
  body: unknown,
): { kind: MakePredictionErrorKind; message: string } {
  if (status === 401) {
    return { kind: "unauthenticated", message: `${status}` };
  }
  if (status === 403) {
    // Integrity rejection can surface either as a GQL error in the body or
    // as an `extensions.code` value on the envelope. Same predicate as the
    // 200-with-errors path so the classification is consistent.
    const envelope = (body ?? {}) as MakePredictionResponse;
    const hasIntegrityError = envelope.errors?.some(isIntegrityRejectionError) ?? false;
    if (hasIntegrityError) {
      return { kind: "integrity", message: "integrity" };
    }
    // Some integrity rejections come back as raw HTML or non-GQL JSON — fall
    // back to substring matching on the stringified body.
    const haystack = stringifyForMatch(body).toLowerCase();
    const mentionsIntegrity = haystack.includes("integrity");
    const mentionsTrigger =
      haystack.includes("check") ||
      haystack.includes("failed") ||
      haystack.includes("rejected");
    if (mentionsIntegrity && mentionsTrigger) {
      return { kind: "integrity", message: "integrity" };
    }
  }
  if (status >= 500) {
    return { kind: "network", message: `${status}` };
  }
  return { kind: "unknown", message: sanitizeMessage(`${status}`) };
}

function stringifyForMatch(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    try {
      return JSON.stringify(body);
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * POST the mutation, honoring the persisted-query → document-string fallback
 * order. Returns the parsed envelope or a discriminated error result if the
 * request itself failed (HTTP non-2xx, network, timeout).
 */
async function postMutation(
  accessToken: string,
  variables: MakePredictionVariables,
  options: { useDocString: boolean },
): Promise<{ ok: true; body: MakePredictionResponse } | MakePredictionResult> {
  const body = options.useDocString
    ? {
        operationName: "MakePrediction",
        query: MAKE_PREDICTION_DOC,
        variables,
      }
    : {
        operationName: "MakePrediction",
        variables,
        extensions: {
          persistedQuery: { version: 1, sha256Hash: MAKE_PREDICTION_HASH },
        },
      };

  try {
    const res = await fetch(GQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Client-Id": GQL_CLIENT_ID,
        "Content-Type": "application/json",
        // Twitch GQL uses `OAuth <token>`, NOT `Bearer` (Helix's scheme).
        Authorization: `OAuth ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const parsed = await res.json().catch(() => null);
      const { kind, message } = classifyHttpFailure(res.status, parsed);
      return { ok: false, kind, message };
    }

    const json = (await res.json().catch(() => null)) as MakePredictionResponse | null;
    if (!json) {
      return { ok: false, kind: "unknown", message: "invalid response body" };
    }
    return { ok: true, body: json };
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

/**
 * True when the envelope reports `PersistedQueryNotFound` — the signal to
 * retry with a document-string body. Twitch rotates persisted hashes; this
 * is the recovery path for the rotated-hash window.
 */
function isPersistedQueryNotFound(body: MakePredictionResponse): boolean {
  if (!body.errors) return false;
  return body.errors.some((e) => {
    if (e.message?.includes("PersistedQueryNotFound")) return true;
    const code = e.extensions?.code ?? "";
    return code === "PERSISTED_QUERY_NOT_FOUND" || code === "PersistedQueryNotFound";
  });
}

/**
 * Interpret a 200-OK GQL envelope. Order: integrity > GQL-level errors >
 * inner `error.code` > success. Returns null when the envelope is the
 * special `PersistedQueryNotFound` signal — callers retry with the doc
 * string in that case.
 */
function classifyEnvelope(body: MakePredictionResponse): MakePredictionResult | null {
  if (isPersistedQueryNotFound(body)) return null;

  if (body.errors && body.errors.length > 0) {
    const integrity = body.errors.find(isIntegrityRejectionError);
    if (integrity) {
      return { ok: false, kind: "integrity", message: "integrity" };
    }
    const first = body.errors[0];
    const lower = first.message.toLowerCase();
    if (lower.includes("unauthenticat") || lower.includes("unauthorized")) {
      return { ok: false, kind: "unauthenticated", message: first.message };
    }
    return {
      ok: false,
      kind: "unknown",
      message: sanitizeMessage(first.message),
    };
  }

  const inner = body.data?.makePrediction;
  if (inner?.error?.code) {
    const mapped = mapErrorCode(inner.error.code);
    if (mapped) {
      return { ok: false, kind: mapped, message: inner.error.code };
    }
    return {
      ok: false,
      kind: "unknown",
      message: sanitizeMessage(inner.error.code),
    };
  }

  return { ok: true, payload: inner ?? body.data };
}

/**
 * Cast a viewer prediction vote.
 *
 * Persisted-query first, document-string fallback on `PersistedQueryNotFound`.
 * Input validation runs before any HTTP fires. The `transactionID` is
 * auto-generated per call if the caller omits it; each call gets a fresh
 * cryptographically-strong 16-byte hex string.
 */
export async function makePrediction(
  payload: MakePredictionPayload,
): Promise<MakePredictionResult> {
  const inputError = validateInput(payload);
  if (inputError) return inputError;

  const variables: MakePredictionVariables = {
    input: {
      eventID: payload.eventID,
      outcomeID: payload.outcomeID,
      points: payload.points,
      transactionID: payload.transactionID ?? generateTransactionId(),
    },
  };

  // Try the persisted-query path first.
  const persistedRes = await postMutation(payload.accessToken, variables, {
    useDocString: false,
  });
  if (!("ok" in persistedRes && persistedRes.ok === true && "body" in persistedRes)) {
    // postMutation returned a discriminated error result (HTTP failure /
    // network / timeout) — propagate directly without doc-string retry.
    return persistedRes as MakePredictionResult;
  }

  const classified = classifyEnvelope(persistedRes.body);
  if (classified !== null) return classified;

  // PersistedQueryNotFound — retry with the document-string body.
  const docStringRes = await postMutation(payload.accessToken, variables, {
    useDocString: true,
  });
  if (!("ok" in docStringRes && docStringRes.ok === true && "body" in docStringRes)) {
    return docStringRes as MakePredictionResult;
  }

  const retryClassified = classifyEnvelope(docStringRes.body);
  if (retryClassified !== null) return retryClassified;

  // Document-string still returned PersistedQueryNotFound (shouldn't happen
  // — the doc-string path doesn't carry a hash). Treat as unknown.
  return { ok: false, kind: "unknown", message: "persisted query retry failed" };
}

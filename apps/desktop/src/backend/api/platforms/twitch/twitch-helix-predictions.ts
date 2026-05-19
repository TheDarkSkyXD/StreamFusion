/**
 * Twitch Helix — Predictions (authenticated)
 *
 * Thin wrappers around `/helix/predictions` (GET / POST / PATCH). The shape
 * mirrors `twitch-helix-moderation-mutations.ts` (U6) deliberately — same
 * discriminated-union result type, same Client-Id / Bearer / timeout / 401
 * scope-parsing classifier — so the channel-management console can branch on
 * `result.kind` without parsing strings.
 *
 * Token-scope requirements: `channel:manage:predictions` for create / lock /
 * resolve / cancel; `channel:read:predictions` (or manage) for the GET.
 *
 * Synchronous validation throws on invalid arguments before any network I/O.
 */

import type { HelixModResult } from "./twitch-helix-moderation-mutations";

// Re-export for callers that want the type without pulling in the mod helpers.
export type { HelixModResult };

const HELIX_BASE = "https://api.twitch.tv/helix";
const REQUEST_TIMEOUT_MS = 10_000;

const MIN_PREDICTION_WINDOW_S = 1;
const MAX_PREDICTION_WINDOW_S = 1800;
const MIN_OUTCOMES = 2;
const MAX_OUTCOMES = 10;

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface PredictionOutcomePredictor {
  user_id: string;
  user_login: string;
  user_name: string;
  channel_points_used: number;
  channel_points_won: number | null;
}

export interface PredictionOutcome {
  id: string;
  title: string;
  users: number;
  channel_points: number;
  color: "BLUE" | "PINK";
  top_predictors?: PredictionOutcomePredictor[];
}

export interface PredictionPayload {
  id: string;
  broadcaster_id: string;
  title: string;
  winning_outcome_id: string | null;
  outcomes: PredictionOutcome[];
  prediction_window: number;
  status: "ACTIVE" | "LOCKED" | "RESOLVED" | "CANCELED";
  created_at: string;
  ended_at: string | null;
  locked_at: string | null;
}

export interface PredictionsListPayload {
  data: PredictionPayload[];
}

interface PredictionEnvelope {
  data: PredictionPayload[];
}

// ---------------------------------------------------------------------------
// Internal helper — mirrors U6's `helixRequest`. Duplicated intentionally:
// the U6 helper is non-exported and decoupling is more churn than the
// duplication is worth.
// ---------------------------------------------------------------------------

type QueryDict = Record<string, string | number | undefined>;

interface HelixRequestArgs {
  accessToken: string;
  clientId: string;
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  path: string;
  query?: QueryDict;
  body?: unknown;
}

interface HelixErrorBody {
  error?: string;
  status?: number;
  message?: string;
}

function buildUrl(path: string, query?: QueryDict): string {
  if (!query) return `${HELIX_BASE}${path}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${HELIX_BASE}${path}?${qs}` : `${HELIX_BASE}${path}`;
}

function parseMissingScopes(message: string): string[] {
  const match = /missing scope[s]?:\s*(.+)$/i.exec(message);
  if (!match) return [];
  return match[1]
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function is401MissingScope(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("missing scope") || lower.includes("scope is missing");
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed.length === 0) return null;
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

async function helixPredictionsRequest<T>(
  args: HelixRequestArgs,
): Promise<HelixModResult<T>> {
  const { accessToken, clientId, method, path, query, body } = args;
  const url = buildUrl(path, query);

  const headers: Record<string, string> = {
    "Client-Id": clientId,
    Authorization: `Bearer ${accessToken}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message };
  }

  if (res.status === 204) {
    return { ok: true, payload: undefined as T };
  }

  if (res.status >= 200 && res.status < 300) {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      return { ok: true, payload: undefined as T };
    }
    return { ok: true, payload: parsed as T };
  }

  let errBody: HelixErrorBody = {};
  try {
    errBody = (await res.json()) as HelixErrorBody;
  } catch {
    // Body wasn't JSON; fall through with whatever we have.
  }
  const message = errBody.message ?? `${res.status} ${res.statusText}`;

  if (res.status === 401) {
    if (is401MissingScope(message)) {
      return {
        ok: false,
        kind: "missing-scopes",
        message,
        missingScopes: parseMissingScopes(message),
      };
    }
    return { ok: false, kind: "unauthorized", message };
  }

  if (res.status === 403) {
    return { ok: false, kind: "forbidden", message };
  }

  if (res.status === 404) {
    return { ok: false, kind: "not-found", message };
  }

  if (res.status === 429) {
    return {
      ok: false,
      kind: "rate-limited",
      message,
      retryAfterSeconds: parseRetryAfter(res.headers.get("Retry-After")),
    };
  }

  return { ok: false, kind: "network", message };
}

// ---------------------------------------------------------------------------
// 1. getPredictions
// ---------------------------------------------------------------------------

export interface GetPredictionsArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
}

export function getPredictions(
  args: GetPredictionsArgs,
): Promise<HelixModResult<PredictionsListPayload>> {
  return helixPredictionsRequest<PredictionsListPayload>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "GET",
    path: "/predictions",
    query: { broadcaster_id: args.broadcasterId },
  });
}

// ---------------------------------------------------------------------------
// 2. createPrediction
// ---------------------------------------------------------------------------

export interface CreatePredictionArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
  title: string;
  outcomes: Array<{ title: string }>;
  /** Window in seconds; Twitch caps at 1..1800. */
  predictionWindow: number;
}

export function createPrediction(
  args: CreatePredictionArgs,
): Promise<HelixModResult<PredictionPayload>> {
  if (
    !Number.isInteger(args.predictionWindow) ||
    args.predictionWindow < MIN_PREDICTION_WINDOW_S ||
    args.predictionWindow > MAX_PREDICTION_WINDOW_S
  ) {
    throw new Error(
      `createPrediction: predictionWindow must be an integer in [${MIN_PREDICTION_WINDOW_S}, ${MAX_PREDICTION_WINDOW_S}], got ${args.predictionWindow}`,
    );
  }
  if (
    !Array.isArray(args.outcomes) ||
    args.outcomes.length < MIN_OUTCOMES ||
    args.outcomes.length > MAX_OUTCOMES
  ) {
    throw new Error(
      `createPrediction: outcomes must have ${MIN_OUTCOMES}..${MAX_OUTCOMES} entries, got ${args.outcomes?.length ?? 0}`,
    );
  }
  for (const o of args.outcomes) {
    if (!o || typeof o.title !== "string" || o.title.trim().length === 0) {
      throw new Error("createPrediction: every outcome must have a non-empty title");
    }
  }
  return helixPredictionsRequest<PredictionEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "POST",
    path: "/predictions",
    body: {
      broadcaster_id: args.broadcasterId,
      title: args.title,
      outcomes: args.outcomes.map((o) => ({ title: o.title })),
      prediction_window: args.predictionWindow,
    },
  }).then((result) => {
    if (!result.ok) return result;
    const first = result.payload?.data?.[0];
    return { ok: true, payload: first as PredictionPayload };
  });
}

// ---------------------------------------------------------------------------
// 3. lockPrediction
// ---------------------------------------------------------------------------

export interface LockPredictionArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
  predictionId: string;
}

export async function lockPrediction(
  args: LockPredictionArgs,
): Promise<HelixModResult<PredictionPayload>> {
  const result = await helixPredictionsRequest<PredictionEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "PATCH",
    path: "/predictions",
    body: {
      broadcaster_id: args.broadcasterId,
      id: args.predictionId,
      status: "LOCKED",
    },
  });
  if (!result.ok) return result;
  const first = result.payload?.data?.[0];
  return { ok: true, payload: first as PredictionPayload };
}

// ---------------------------------------------------------------------------
// 4. resolvePrediction
// ---------------------------------------------------------------------------

export interface ResolvePredictionArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
  predictionId: string;
  winningOutcomeId: string;
}

export async function resolvePrediction(
  args: ResolvePredictionArgs,
): Promise<HelixModResult<PredictionPayload>> {
  const result = await helixPredictionsRequest<PredictionEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "PATCH",
    path: "/predictions",
    body: {
      broadcaster_id: args.broadcasterId,
      id: args.predictionId,
      status: "RESOLVED",
      winning_outcome_id: args.winningOutcomeId,
    },
  });
  if (!result.ok) return result;
  const first = result.payload?.data?.[0];
  return { ok: true, payload: first as PredictionPayload };
}

// ---------------------------------------------------------------------------
// 5. cancelPrediction
// ---------------------------------------------------------------------------

export interface CancelPredictionArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
  predictionId: string;
}

export async function cancelPrediction(
  args: CancelPredictionArgs,
): Promise<HelixModResult<PredictionPayload>> {
  const result = await helixPredictionsRequest<PredictionEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "PATCH",
    path: "/predictions",
    body: {
      broadcaster_id: args.broadcasterId,
      id: args.predictionId,
      status: "CANCELED",
    },
  });
  if (!result.ok) return result;
  const first = result.payload?.data?.[0];
  return { ok: true, payload: first as PredictionPayload };
}

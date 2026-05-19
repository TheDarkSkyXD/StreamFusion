/**
 * Twitch Helix — Unban requests (read + resolve).
 *
 *   • GET   /moderation/unban_requests
 *   • PATCH /moderation/unban_requests
 *
 * Twitch requires a `status` filter on the GET (one of pending / approved /
 * denied / acknowledged / canceled). Pagination is cursor-driven on `after`.
 * The PATCH accepts an optional `resolution_text` which we send only when
 * the caller provided one — Helix is picky about empty-string body params.
 *
 * Same anti-abstraction pattern as the other twitch-helix-* helpers: the
 * small `helixRequest` is copy-pasted in rather than shared.
 */

import type { HelixModResult } from "./twitch-helix-moderation-mutations";

const HELIX_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const HELIX_BASE = "https://api.twitch.tv/helix";
const REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type UnbanRequestStatus =
  | "pending"
  | "approved"
  | "denied"
  | "acknowledged"
  | "canceled";

export interface UnbanRequest {
  id: string;
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  moderator_id: string | null;
  moderator_login: string | null;
  moderator_name: string | null;
  user_id: string;
  user_login: string;
  user_name: string;
  text: string;
  status: UnbanRequestStatus;
  created_at: string;
  resolved_at: string | null;
  resolution_text: string | null;
}

export interface UnbanRequestsPage {
  data: UnbanRequest[];
  pagination: { cursor?: string };
}

// ---------------------------------------------------------------------------
// Internal helper (copy-paste; do not generalize)
// ---------------------------------------------------------------------------

type QueryDict = Record<string, string | number | undefined>;

interface HelixRequestArgs {
  accessToken: string;
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  path: string;
  query?: QueryDict;
  body?: unknown;
  fetchImpl?: typeof fetch;
  clientId?: string;
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

async function helixRequest<T>(args: HelixRequestArgs): Promise<HelixModResult<T>> {
  const { accessToken, method, path, query, body, fetchImpl, clientId } = args;
  const url = buildUrl(path, query);
  const doFetch = fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    "Client-Id": clientId ?? HELIX_CLIENT_ID,
    Authorization: `Bearer ${accessToken}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await doFetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message };
  }

  if (res.status === 204) return { ok: true, payload: undefined as T };

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
    // fall through
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
  if (res.status === 403) return { ok: false, kind: "forbidden", message };
  if (res.status === 404) return { ok: false, kind: "not-found", message };
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
// Public API
// ---------------------------------------------------------------------------

export interface GetUnbanRequestsArgs {
  accessToken: string;
  broadcasterId: string;
  moderatorId: string;
  status: UnbanRequestStatus;
  userId?: string;
  after?: string;
  fetchImpl?: typeof fetch;
  clientId?: string;
}

interface UnbanRequestsEnvelope {
  data?: UnbanRequest[];
  pagination?: { cursor?: string };
}

export async function getUnbanRequests(
  args: GetUnbanRequestsArgs,
): Promise<HelixModResult<UnbanRequestsPage>> {
  const result = await helixRequest<UnbanRequestsEnvelope>({
    accessToken: args.accessToken,
    method: "GET",
    path: "/moderation/unban_requests",
    query: {
      broadcaster_id: args.broadcasterId,
      moderator_id: args.moderatorId,
      status: args.status,
      user_id: args.userId,
      after: args.after,
      first: 20,
    },
    fetchImpl: args.fetchImpl,
    clientId: args.clientId,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    payload: {
      data: result.payload?.data ?? [],
      pagination: { cursor: result.payload?.pagination?.cursor },
    },
  };
}

export interface ResolveUnbanRequestArgs {
  accessToken: string;
  broadcasterId: string;
  moderatorId: string;
  unbanRequestId: string;
  status: "approved" | "denied";
  resolutionText?: string;
  fetchImpl?: typeof fetch;
  clientId?: string;
}

interface ResolveEnvelope {
  data?: UnbanRequest[];
}

export async function resolveUnbanRequest(
  args: ResolveUnbanRequestArgs,
): Promise<HelixModResult<UnbanRequest>> {
  const query: QueryDict = {
    broadcaster_id: args.broadcasterId,
    moderator_id: args.moderatorId,
    unban_request_id: args.unbanRequestId,
    status: args.status,
  };
  if (args.resolutionText !== undefined) {
    query.resolution_text = args.resolutionText;
  }
  const result = await helixRequest<ResolveEnvelope>({
    accessToken: args.accessToken,
    method: "PATCH",
    path: "/moderation/unban_requests",
    query,
    fetchImpl: args.fetchImpl,
    clientId: args.clientId,
  });
  if (!result.ok) return result;
  const first = result.payload?.data?.[0];
  return { ok: true, payload: first as UnbanRequest };
}

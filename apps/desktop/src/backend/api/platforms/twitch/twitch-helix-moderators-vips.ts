/**
 * Twitch Helix — Moderators & VIPs list reads.
 *
 * Companion to `twitch-helix-moderation-mutations.ts` (which already exposes
 * the add/remove mutations). These helpers read the current rosters for a
 * broadcaster:
 *   • GET /moderation/moderators?broadcaster_id=...&first=100
 *   • GET /channels/vips?broadcaster_id=...&first=100
 *
 * Pagination: caller gets exactly one page (cap 100). Bigger channels would
 * need cursor-driven follow-up calls; UI surfaces a "showing first 100" hint.
 *
 * Result shape and error classification mirror the U6 mutation helpers; we
 * copy-paste the small `helixRequest` helper rather than generalizing it
 * (matches the existing anti-abstraction pattern across U6 / U25 / U26).
 */

import type { HelixModResult } from "./twitch-helix-moderation-mutations";

const HELIX_BASE = "https://api.twitch.tv/helix";
const REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChannelMember {
  user_id: string;
  user_login: string;
  user_name: string;
}

export interface ChannelMembersPage {
  data: ChannelMember[];
  pagination: { cursor?: string };
}

// ---------------------------------------------------------------------------
// Internal helper (copy-paste of the U6 pattern; do not generalize)
// ---------------------------------------------------------------------------

type QueryDict = Record<string, string | number | undefined>;

interface HelixRequestArgs {
  accessToken: string;
  clientId: string;
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  path: string;
  query?: QueryDict;
  body?: unknown;
  fetchImpl?: typeof fetch;
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
    "Client-Id": clientId,
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

export interface GetMembersArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
  fetchImpl?: typeof fetch;
}

interface HelixMembersEnvelope {
  data?: ChannelMember[];
  pagination?: { cursor?: string };
}

export async function getModerators(
  args: GetMembersArgs,
): Promise<HelixModResult<ChannelMembersPage>> {
  const result = await helixRequest<HelixMembersEnvelope>({
    accessToken: args.accessToken,
    method: "GET",
    path: "/moderation/moderators",
    query: { broadcaster_id: args.broadcasterId, first: 100 },
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

export async function getVips(
  args: GetMembersArgs,
): Promise<HelixModResult<ChannelMembersPage>> {
  const result = await helixRequest<HelixMembersEnvelope>({
    accessToken: args.accessToken,
    method: "GET",
    path: "/channels/vips",
    query: { broadcaster_id: args.broadcasterId, first: 100 },
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

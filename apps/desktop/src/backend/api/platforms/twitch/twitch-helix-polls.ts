/**
 * Twitch Helix — Polls (authenticated)
 *
 * Thin wrappers around `/helix/polls` (GET / POST / PATCH). Same idiom as
 * the predictions helper — result-discriminated-union, inlined helixRequest,
 * synchronous arg validation.
 *
 * Token-scope requirements: `channel:manage:polls` for create / terminate /
 * archive; `channel:read:polls` (or manage) for the GET.
 */

import type { HelixModResult } from "./twitch-helix-moderation-mutations";

export type { HelixModResult };

const HELIX_BASE = "https://api.twitch.tv/helix";
const REQUEST_TIMEOUT_MS = 10_000;

const MAX_TITLE = 60;
const MIN_CHOICES = 2;
const MAX_CHOICES = 5;
const MIN_CHOICE_LEN = 1;
const MAX_CHOICE_LEN = 25;
const MIN_DURATION_S = 15;
const MAX_DURATION_S = 1800;
const MIN_POINTS_PER_VOTE = 1;
const MAX_POINTS_PER_VOTE = 1_000_000;
const MIN_BITS_PER_VOTE = 1;
const MAX_BITS_PER_VOTE = 10_000;

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface PollChoice {
  id: string;
  title: string;
  votes: number;
  channel_points_votes: number;
  bits_votes: number;
}

export interface PollPayload {
  id: string;
  broadcaster_id: string;
  broadcaster_name?: string;
  broadcaster_login?: string;
  title: string;
  choices: PollChoice[];
  bits_voting_enabled: boolean;
  bits_per_vote: number;
  channel_points_voting_enabled: boolean;
  channel_points_per_vote: number;
  status: "ACTIVE" | "COMPLETED" | "TERMINATED" | "ARCHIVED" | "MODERATED" | "INVALID";
  duration: number;
  started_at: string;
  ended_at: string | null;
}

export interface PollsListPayload {
  data: PollPayload[];
}

interface PollEnvelope {
  data: PollPayload[];
}

// ---------------------------------------------------------------------------
// Internal helper — mirrors U6/U25.
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

async function helixPollsRequest<T>(
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
    // body wasn't JSON
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
// 1. getPolls
// ---------------------------------------------------------------------------

export interface GetPollsArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
}

export function getPolls(
  args: GetPollsArgs,
): Promise<HelixModResult<PollsListPayload>> {
  return helixPollsRequest<PollsListPayload>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "GET",
    path: "/polls",
    query: { broadcaster_id: args.broadcasterId },
  });
}

// ---------------------------------------------------------------------------
// 2. createPoll
// ---------------------------------------------------------------------------

export interface CreatePollArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
  title: string;
  choices: Array<{ title: string }>;
  /** Seconds — Twitch requires 15..1800. */
  duration: number;
  channelPointsVotingEnabled?: boolean;
  channelPointsPerVote?: number;
  bitsVotingEnabled?: boolean;
  bitsPerVote?: number;
}

export function createPoll(
  args: CreatePollArgs,
): Promise<HelixModResult<PollPayload>> {
  if (typeof args.title !== "string" || args.title.trim().length === 0) {
    throw new Error("createPoll: title must be a non-empty string");
  }
  if (args.title.length > MAX_TITLE) {
    throw new Error(
      `createPoll: title length must be <= ${MAX_TITLE}, got ${args.title.length}`,
    );
  }
  if (
    !Array.isArray(args.choices) ||
    args.choices.length < MIN_CHOICES ||
    args.choices.length > MAX_CHOICES
  ) {
    throw new Error(
      `createPoll: choices must have ${MIN_CHOICES}..${MAX_CHOICES} entries, got ${args.choices?.length ?? 0}`,
    );
  }
  for (const c of args.choices) {
    const len = c?.title?.length ?? 0;
    if (
      !c ||
      typeof c.title !== "string" ||
      len < MIN_CHOICE_LEN ||
      len > MAX_CHOICE_LEN
    ) {
      throw new Error(
        `createPoll: every choice title must be ${MIN_CHOICE_LEN}..${MAX_CHOICE_LEN} chars`,
      );
    }
  }
  if (
    !Number.isInteger(args.duration) ||
    args.duration < MIN_DURATION_S ||
    args.duration > MAX_DURATION_S
  ) {
    throw new Error(
      `createPoll: duration must be an integer in [${MIN_DURATION_S}, ${MAX_DURATION_S}], got ${args.duration}`,
    );
  }
  if (args.channelPointsPerVote !== undefined) {
    if (
      !Number.isInteger(args.channelPointsPerVote) ||
      args.channelPointsPerVote < MIN_POINTS_PER_VOTE ||
      args.channelPointsPerVote > MAX_POINTS_PER_VOTE
    ) {
      throw new Error(
        `createPoll: channelPointsPerVote must be an integer in [${MIN_POINTS_PER_VOTE}, ${MAX_POINTS_PER_VOTE}]`,
      );
    }
  }
  if (args.bitsPerVote !== undefined) {
    if (
      !Number.isInteger(args.bitsPerVote) ||
      args.bitsPerVote < MIN_BITS_PER_VOTE ||
      args.bitsPerVote > MAX_BITS_PER_VOTE
    ) {
      throw new Error(
        `createPoll: bitsPerVote must be an integer in [${MIN_BITS_PER_VOTE}, ${MAX_BITS_PER_VOTE}]`,
      );
    }
  }

  const body: Record<string, unknown> = {
    broadcaster_id: args.broadcasterId,
    title: args.title,
    choices: args.choices.map((c) => ({ title: c.title })),
    duration: args.duration,
  };
  if (args.channelPointsVotingEnabled !== undefined) {
    body.channel_points_voting_enabled = args.channelPointsVotingEnabled;
  }
  if (args.channelPointsPerVote !== undefined) {
    body.channel_points_per_vote = args.channelPointsPerVote;
  }
  if (args.bitsVotingEnabled !== undefined) {
    body.bits_voting_enabled = args.bitsVotingEnabled;
  }
  if (args.bitsPerVote !== undefined) {
    body.bits_per_vote = args.bitsPerVote;
  }

  return helixPollsRequest<PollEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "POST",
    path: "/polls",
    body,
  }).then((result) => {
    if (!result.ok) return result;
    const first = result.payload?.data?.[0];
    return { ok: true, payload: first as PollPayload };
  });
}

// ---------------------------------------------------------------------------
// 3. terminatePoll
// ---------------------------------------------------------------------------

export interface TerminatePollArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
  pollId: string;
}

export async function terminatePoll(
  args: TerminatePollArgs,
): Promise<HelixModResult<PollPayload>> {
  const result = await helixPollsRequest<PollEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "PATCH",
    path: "/polls",
    body: {
      broadcaster_id: args.broadcasterId,
      id: args.pollId,
      status: "TERMINATED",
    },
  });
  if (!result.ok) return result;
  const first = result.payload?.data?.[0];
  return { ok: true, payload: first as PollPayload };
}

// ---------------------------------------------------------------------------
// 4. archivePoll
// ---------------------------------------------------------------------------

export interface ArchivePollArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
  pollId: string;
}

export async function archivePoll(
  args: ArchivePollArgs,
): Promise<HelixModResult<PollPayload>> {
  const result = await helixPollsRequest<PollEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "PATCH",
    path: "/polls",
    body: {
      broadcaster_id: args.broadcasterId,
      id: args.pollId,
      status: "ARCHIVED",
    },
  });
  if (!result.ok) return result;
  const first = result.payload?.data?.[0];
  return { ok: true, payload: first as PollPayload };
}

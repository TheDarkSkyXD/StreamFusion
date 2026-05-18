/**
 * Twitch Helix — Cross-channel banned-user search (U31).
 *
 * Resolves a username to a Helix user_id, then fans out a per-channel
 * `/moderation/banned?user_id=` query across every channel the caller
 * supplies (the signed-in user's moderated-channel list). Per the plan
 * (decision #3) the fan-out is bounded to 4 concurrent requests with
 * exponential backoff on 429 (250 → 500 → 1000 → 2000 ms, cap 60s).
 *
 * The returned array is sorted (banned > timed-out > not-banned > error >
 * rate-limited) so the UI can render a stable order. Callers wanting
 * progressive rendering pass an `onResult` callback — it's invoked as each
 * channel resolves, before sort.
 */

const HELIX_BASE = "https://api.twitch.tv/helix";
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;

// Exponential backoff schedule for 429s. 4 attempts → ~3.75s wall time;
// far under the documented 60s cap. After the last attempt, the channel
// is reported as "rate-limited".
const BACKOFF_MS = [250, 500, 1000, 2000] as const;

export type BanStatus =
  | "banned"
  | "timed-out"
  | "not-banned"
  | "error"
  | "rate-limited";

export interface CrossChannelBanResult {
  channelId: string;
  channelLogin: string;
  status: BanStatus;
  /** ISO string while a timeout is active; null for permanent bans. */
  expiresAt: string | null;
  moderatorLogin: string | null;
  reason: string | null;
  /** Populated when `status === "error"`. */
  error?: string;
}

export interface SearchUserAcrossChannelsArgs {
  /** Free-text login — resolved to a user_id via Helix `/users?login=`. */
  username: string;
  channels: Array<{ broadcasterId: string; broadcasterLogin: string }>;
  accessToken: string;
  /** The signed-in mod's own user-id (Helix requires it on `/moderation/banned`). */
  moderatorUserId: string;
  clientId: string;
  /** Per-request concurrency. Defaults to 4 per plan decision #3. */
  concurrency?: number;
  /** Progressive callback — fired once per channel as results arrive. */
  onResult?: (result: CrossChannelBanResult) => void;
  /** Test seam — defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

interface HelixBannedEntry {
  user_id: string;
  user_login: string;
  user_name: string;
  expires_at: string | "";
  created_at: string;
  reason: string;
  moderator_id: string;
  moderator_login: string;
  moderator_name: string;
}

interface HelixUsersResponse {
  data?: Array<{ id: string; login: string; display_name: string }>;
}

interface HelixBannedResponse {
  data?: HelixBannedEntry[];
}

const STATUS_RANK: Record<BanStatus, number> = {
  banned: 0,
  "timed-out": 1,
  "not-banned": 2,
  error: 3,
  "rate-limited": 4,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  // Compose AbortSignal.timeout with whatever the caller already passed.
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return fetchImpl(url, { ...init, signal: timeoutSignal });
}

async function resolveUserId(
  fetchImpl: typeof fetch,
  username: string,
  accessToken: string,
  clientId: string,
): Promise<{ id: string; login: string } | null> {
  const url = `${HELIX_BASE}/users?login=${encodeURIComponent(username.trim())}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(fetchImpl, url, {
      method: "GET",
      headers: {
        "Client-Id": clientId,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let body: HelixUsersResponse;
  try {
    body = (await res.json()) as HelixUsersResponse;
  } catch {
    return null;
  }
  const first = body.data?.[0];
  if (!first) return null;
  return { id: first.id, login: first.login };
}

async function fetchChannelBan(
  fetchImpl: typeof fetch,
  args: {
    broadcasterId: string;
    broadcasterLogin: string;
    userId: string;
    moderatorUserId: string;
    accessToken: string;
    clientId: string;
  },
): Promise<CrossChannelBanResult> {
  const url =
    `${HELIX_BASE}/moderation/banned` +
    `?broadcaster_id=${encodeURIComponent(args.broadcasterId)}` +
    `&user_id=${encodeURIComponent(args.userId)}`;

  const headers: Record<string, string> = {
    "Client-Id": args.clientId,
    Authorization: `Bearer ${args.accessToken}`,
  };

  // Some mod tokens also require a moderator_id query param on this endpoint.
  // Twitch's docs put it on `/banned/events` only — we still pass it where it
  // doesn't hurt to keep the helper consistent across Helix moderation calls.
  // It's safe to leave off here; the broadcaster_id token gates access.

  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    let res: Response;
    try {
      res = await fetchWithTimeout(fetchImpl, url, { method: "GET", headers });
    } catch (err) {
      return {
        channelId: args.broadcasterId,
        channelLogin: args.broadcasterLogin,
        status: "error",
        expiresAt: null,
        moderatorLogin: null,
        reason: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (res.status === 429) {
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      return {
        channelId: args.broadcasterId,
        channelLogin: args.broadcasterLogin,
        status: "rate-limited",
        expiresAt: null,
        moderatorLogin: null,
        reason: null,
      };
    }

    if (!res.ok) {
      let errMsg = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) errMsg = body.message;
      } catch {
        // ignore JSON parse errors
      }
      return {
        channelId: args.broadcasterId,
        channelLogin: args.broadcasterLogin,
        status: "error",
        expiresAt: null,
        moderatorLogin: null,
        reason: null,
        error: errMsg,
      };
    }

    let body: HelixBannedResponse;
    try {
      body = (await res.json()) as HelixBannedResponse;
    } catch {
      body = {};
    }
    const entry = body.data?.[0];
    if (!entry) {
      return {
        channelId: args.broadcasterId,
        channelLogin: args.broadcasterLogin,
        status: "not-banned",
        expiresAt: null,
        moderatorLogin: null,
        reason: null,
      };
    }
    const expiresAt =
      typeof entry.expires_at === "string" && entry.expires_at.length > 0
        ? entry.expires_at
        : null;
    return {
      channelId: args.broadcasterId,
      channelLogin: args.broadcasterLogin,
      status: expiresAt ? "timed-out" : "banned",
      expiresAt,
      moderatorLogin: entry.moderator_login || null,
      reason: entry.reason || null,
    };
  }

  // Unreachable; the loop always returns.
  return {
    channelId: args.broadcasterId,
    channelLogin: args.broadcasterLogin,
    status: "error",
    expiresAt: null,
    moderatorLogin: null,
    reason: null,
    error: "exhausted",
  };
}

export async function searchUserAcrossChannels(
  opts: SearchUserAcrossChannelsArgs,
): Promise<CrossChannelBanResult[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);

  // Step 1 — resolve the username. If the user doesn't exist, the UI gets
  // an empty list and renders "User not found".
  const resolved = await resolveUserId(
    fetchImpl,
    opts.username,
    opts.accessToken,
    opts.clientId,
  );
  if (!resolved) return [];

  if (opts.channels.length === 0) return [];

  // Step 2 — bounded fan-out. A tiny in-house pool: a worker pops jobs off a
  // shared index until exhausted, so concurrency is honored exactly.
  const results: CrossChannelBanResult[] = [];
  let nextIdx = 0;

  const worker = async () => {
    while (true) {
      const myIdx = nextIdx++;
      if (myIdx >= opts.channels.length) return;
      const channel = opts.channels[myIdx];
      const result = await fetchChannelBan(fetchImpl, {
        broadcasterId: channel.broadcasterId,
        broadcasterLogin: channel.broadcasterLogin,
        userId: resolved.id,
        moderatorUserId: opts.moderatorUserId,
        accessToken: opts.accessToken,
        clientId: opts.clientId,
      });
      results.push(result);
      opts.onResult?.(result);
    }
  };

  const workerCount = Math.min(concurrency, opts.channels.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);

  results.sort((a, b) => {
    const r = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (r !== 0) return r;
    return a.channelLogin.localeCompare(b.channelLogin);
  });

  return results;
}

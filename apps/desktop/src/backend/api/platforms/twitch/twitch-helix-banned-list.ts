/**
 * Twitch Helix — Single-channel banned-user list.
 *
 * Wraps `GET /moderation/banned?broadcaster_id=...&first=100` for the
 * per-channel `/mod/twitch/$channel` admin page. Read-only; returns the
 * page's `data` array on success or throws on error so the caller can
 * branch on HTTP status without parsing strings.
 *
 * Pagination is exposed via the optional `cursor` arg + returned cursor —
 * callers that want a single page can ignore it.
 */

const HELIX_BASE = "https://api.twitch.tv/helix";
const REQUEST_TIMEOUT_MS = 10_000;

export interface BannedUserEntry {
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

export interface GetBannedUsersArgs {
  accessToken: string;
  broadcasterId: string;
  /** Moderator's user_id (required by Helix). */
  moderatorUserId: string;
  clientId: string;
  cursor?: string;
  /** Page size, 1..100. Defaults to 100. */
  first?: number;
  /** Test seam — defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

export interface GetBannedUsersResult {
  data: BannedUserEntry[];
  cursor: string | null;
}

export type GetBannedUsersError =
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "rate-limited" }
  | { kind: "network"; message: string };

interface HelixBannedResponse {
  data?: BannedUserEntry[];
  pagination?: { cursor?: string };
}

export class BannedUsersFetchError extends Error {
  readonly info: GetBannedUsersError;
  constructor(info: GetBannedUsersError) {
    super(`getBannedUsers failed: ${info.kind}`);
    this.info = info;
  }
}

export async function getBannedUsers(
  args: GetBannedUsersArgs,
): Promise<GetBannedUsersResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const first = Math.max(1, Math.min(100, args.first ?? 100));

  const params = new URLSearchParams();
  params.set("broadcaster_id", args.broadcasterId);
  params.set("first", String(first));
  if (args.cursor) params.set("after", args.cursor);

  const url = `${HELIX_BASE}/moderation/banned?${params.toString()}`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: {
        "Client-Id": args.clientId,
        Authorization: `Bearer ${args.accessToken}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new BannedUsersFetchError({
      kind: "network",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (res.status === 401) throw new BannedUsersFetchError({ kind: "unauthorized" });
  if (res.status === 403) throw new BannedUsersFetchError({ kind: "forbidden" });
  if (res.status === 404) throw new BannedUsersFetchError({ kind: "not-found" });
  if (res.status === 429) throw new BannedUsersFetchError({ kind: "rate-limited" });
  if (!res.ok) {
    throw new BannedUsersFetchError({
      kind: "network",
      message: `${res.status} ${res.statusText}`,
    });
  }

  let body: HelixBannedResponse;
  try {
    body = (await res.json()) as HelixBannedResponse;
  } catch {
    body = {};
  }
  return {
    data: body.data ?? [],
    cursor: body.pagination?.cursor ?? null,
  };
}

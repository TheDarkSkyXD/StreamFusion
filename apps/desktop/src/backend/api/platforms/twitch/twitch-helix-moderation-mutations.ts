/**
 * Twitch Helix — Moderation Mutations (authenticated)
 *
 * Thin wrappers around the Helix `/moderation/*`, `/raids`, `/channels/*`,
 * and `/chat/settings` write endpoints used by the channel-management
 * console (toolbar / inline strip / user popout). Each function returns a
 * result-discriminated-union (mirroring the GQL pin mutations) so the UI
 * layer can branch on the error kind without parsing strings.
 *
 * Token-scope requirements vary per endpoint — see Twitch's Helix reference.
 * 401 responses are split into `missing-scopes` vs generic `unauthorized`
 * based on the Helix error-body shape:
 *   { "error":"Unauthorized","status":401,"message":"Missing scope: ..." }
 *
 * U6 ships the helpers in isolation; U11 wires them into call-sites.
 */

const HELIX_BASE = "https://api.twitch.tv/helix";
const REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type HelixModErrorKind =
  | "missing-scopes"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "network";

export type HelixModResult<TPayload = void> =
  | { ok: true; payload: TPayload }
  | { ok: false; kind: "missing-scopes"; message: string; missingScopes: string[] }
  | {
      ok: false;
      kind: "unauthorized" | "forbidden" | "not-found" | "network";
      message: string;
    }
  | { ok: false; kind: "rate-limited"; message: string; retryAfterSeconds: number | null };

// ---------------------------------------------------------------------------
// Per-endpoint payload types (modeled after Twitch's documented shapes;
// fields kept loose — callers should treat as opaque unless they need them).
// ---------------------------------------------------------------------------

export interface BanPayload {
  broadcaster_id: string;
  moderator_id: string;
  user_id: string;
  created_at: string;
  end_time: string | null;
}

export interface ShieldPayload {
  is_active: boolean;
  moderator_id: string;
  moderator_login: string;
  moderator_name: string;
  last_activated_at: string | null;
}

export interface RaidPayload {
  created_at: string;
  is_mature: boolean;
}

export interface CommercialPayload {
  length: number;
  message: string;
  retry_after: number;
}

// Twitch returns the resolved settings object — we mirror the request shape.
export interface ChatSettingsPayload {
  broadcaster_id: string;
  moderator_id?: string;
  slow_mode?: boolean;
  slow_mode_wait_time?: number | null;
  follower_mode?: boolean;
  follower_mode_duration?: number | null;
  subscriber_mode?: boolean;
  emote_mode?: boolean;
  unique_chat_mode?: boolean;
  non_moderator_chat_delay?: boolean;
  non_moderator_chat_delay_duration?: number | null;
}

// ---------------------------------------------------------------------------
// Internal helper
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
  // Twitch responses look like: "Missing scope: moderator:manage:banned_users"
  // Multiple scopes (defensive — Twitch docs only show one): comma-separated.
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

  // 204 No Content → ok with undefined payload.
  if (res.status === 204) {
    return { ok: true, payload: undefined as T };
  }

  if (res.status >= 200 && res.status < 300) {
    // 200-class with body. Helix returns `{ data: [...] }` for the
    // mutation endpoints; callers expect the *parsed JSON* — the wrapper
    // doesn't pre-unwrap `data` so callers see the canonical Twitch shape.
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      // Some 2xx responses (e.g. odd 200-with-empty-body) — treat as ok-no-body.
      return { ok: true, payload: undefined as T };
    }
    return { ok: true, payload: parsed as T };
  }

  // Non-2xx — try to parse the Helix error envelope to extract a message.
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
// Shared arg shapes
// ---------------------------------------------------------------------------

export interface RequestContext {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
  moderatorId: string;
}

// ---------------------------------------------------------------------------
// 1. banUser
// ---------------------------------------------------------------------------

export interface BanUserArgs extends RequestContext {
  userId: string;
  reason?: string;
}

interface BanResponseEnvelope {
  data: BanPayload[];
}

export async function banUser(args: BanUserArgs): Promise<HelixModResult<BanPayload>> {
  const result = await helixRequest<BanResponseEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "POST",
    path: "/moderation/bans",
    query: { broadcaster_id: args.broadcasterId, moderator_id: args.moderatorId },
    body: {
      data: {
        user_id: args.userId,
        ...(args.reason !== undefined ? { reason: args.reason } : {}),
      },
    },
  });
  if (!result.ok) return result;
  const first = result.payload?.data?.[0];
  return { ok: true, payload: first as BanPayload };
}

// ---------------------------------------------------------------------------
// 2. timeoutUser
// ---------------------------------------------------------------------------

export interface TimeoutUserArgs extends RequestContext {
  userId: string;
  durationSeconds: number;
  reason?: string;
}

const MAX_TIMEOUT_SECONDS = 1_209_600; // 14 days per Twitch docs; plan caps at 7d but Helix allows 14d. Plan says 1..1_209_600 — follow the plan.

export function timeoutUser(
  args: TimeoutUserArgs,
): Promise<HelixModResult<BanPayload>> {
  if (
    !Number.isInteger(args.durationSeconds) ||
    args.durationSeconds < 1 ||
    args.durationSeconds > MAX_TIMEOUT_SECONDS
  ) {
    throw new Error(
      `timeoutUser: durationSeconds must be an integer in [1, ${MAX_TIMEOUT_SECONDS}], got ${args.durationSeconds}`,
    );
  }
  return helixRequest<BanResponseEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "POST",
    path: "/moderation/bans",
    query: { broadcaster_id: args.broadcasterId, moderator_id: args.moderatorId },
    body: {
      data: {
        user_id: args.userId,
        duration: args.durationSeconds,
        ...(args.reason !== undefined ? { reason: args.reason } : {}),
      },
    },
  }).then((result) => {
    if (!result.ok) return result;
    const first = result.payload?.data?.[0];
    return { ok: true, payload: first as BanPayload };
  });
}

// ---------------------------------------------------------------------------
// 3. unbanUser
// ---------------------------------------------------------------------------

export interface UnbanUserArgs extends RequestContext {
  userId: string;
}

export function unbanUser(args: UnbanUserArgs): Promise<HelixModResult<void>> {
  return helixRequest<void>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "DELETE",
    path: "/moderation/bans",
    query: {
      broadcaster_id: args.broadcasterId,
      moderator_id: args.moderatorId,
      user_id: args.userId,
    },
  });
}

// ---------------------------------------------------------------------------
// 4. deleteChatMessage
// ---------------------------------------------------------------------------

export interface DeleteChatMessageArgs extends RequestContext {
  messageId: string;
}

export function deleteChatMessage(
  args: DeleteChatMessageArgs,
): Promise<HelixModResult<void>> {
  return helixRequest<void>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "DELETE",
    path: "/moderation/chat",
    query: {
      broadcaster_id: args.broadcasterId,
      moderator_id: args.moderatorId,
      message_id: args.messageId,
    },
  });
}

// ---------------------------------------------------------------------------
// 5. clearChat
// ---------------------------------------------------------------------------

export function clearChat(args: RequestContext): Promise<HelixModResult<void>> {
  return helixRequest<void>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "DELETE",
    path: "/moderation/chat",
    query: {
      broadcaster_id: args.broadcasterId,
      moderator_id: args.moderatorId,
    },
  });
}

// ---------------------------------------------------------------------------
// 6. setShieldMode
// ---------------------------------------------------------------------------

export interface SetShieldModeArgs extends RequestContext {
  active: boolean;
}

interface ShieldEnvelope {
  data: ShieldPayload[];
}

export async function setShieldMode(
  args: SetShieldModeArgs,
): Promise<HelixModResult<ShieldPayload>> {
  const result = await helixRequest<ShieldEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "PUT",
    path: "/moderation/shield_mode",
    query: { broadcaster_id: args.broadcasterId, moderator_id: args.moderatorId },
    body: { is_active: args.active },
  });
  if (!result.ok) return result;
  const first = result.payload?.data?.[0];
  return { ok: true, payload: first as ShieldPayload };
}

// ---------------------------------------------------------------------------
// 7. startRaid (broadcaster only — no moderatorId)
// ---------------------------------------------------------------------------

export interface StartRaidArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  fromBroadcasterId: string;
  toBroadcasterId: string;
}

interface RaidEnvelope {
  data: RaidPayload[];
}

export async function startRaid(args: StartRaidArgs): Promise<HelixModResult<RaidPayload>> {
  const result = await helixRequest<RaidEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "POST",
    path: "/raids",
    query: {
      from_broadcaster_id: args.fromBroadcasterId,
      to_broadcaster_id: args.toBroadcasterId,
    },
  });
  if (!result.ok) return result;
  const first = result.payload?.data?.[0];
  return { ok: true, payload: first as RaidPayload };
}

// ---------------------------------------------------------------------------
// 8. runCommercial (broadcaster only)
// ---------------------------------------------------------------------------

export interface RunCommercialArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
  length: number;
}

const VALID_COMMERCIAL_LENGTHS = new Set([30, 60, 90, 120, 150, 180]);

interface CommercialEnvelope {
  data: CommercialPayload[];
}

export function runCommercial(
  args: RunCommercialArgs,
): Promise<HelixModResult<CommercialPayload>> {
  if (!VALID_COMMERCIAL_LENGTHS.has(args.length)) {
    throw new Error(
      `runCommercial: length must be one of 30/60/90/120/150/180, got ${args.length}`,
    );
  }
  return helixRequest<CommercialEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "POST",
    path: "/channels/commercial",
    body: { broadcaster_id: args.broadcasterId, length: args.length },
  }).then((result) => {
    if (!result.ok) return result;
    const first = result.payload?.data?.[0];
    return { ok: true, payload: first as CommercialPayload };
  });
}

// ---------------------------------------------------------------------------
// 9. updateChatSettings
// ---------------------------------------------------------------------------

export interface ChatSettingsInput {
  slow_mode?: boolean;
  slow_mode_wait_time?: number | null;
  follower_mode?: boolean;
  follower_mode_duration?: number | null;
  subscriber_mode?: boolean;
  emote_mode?: boolean;
  unique_chat_mode?: boolean;
  non_moderator_chat_delay?: boolean;
  non_moderator_chat_delay_duration?: number | null;
}

export interface UpdateChatSettingsArgs extends RequestContext {
  settings: ChatSettingsInput;
}

interface ChatSettingsEnvelope {
  data: ChatSettingsPayload[];
}

export async function updateChatSettings(
  args: UpdateChatSettingsArgs,
): Promise<HelixModResult<ChatSettingsPayload>> {
  // Send only the keys the caller actually provided — drop `undefined` so we
  // don't accidentally clobber server-side defaults.
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args.settings)) {
    if (value !== undefined) body[key] = value;
  }
  const result = await helixRequest<ChatSettingsEnvelope>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "PATCH",
    path: "/chat/settings",
    query: { broadcaster_id: args.broadcasterId, moderator_id: args.moderatorId },
    body,
  });
  if (!result.ok) return result;
  const first = result.payload?.data?.[0];
  return { ok: true, payload: first as ChatSettingsPayload };
}

// ---------------------------------------------------------------------------
// 10. addModerator / removeModerator (broadcaster only)
// ---------------------------------------------------------------------------

export interface ModeratorMembershipArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
  userId: string;
}

export function addModerator(
  args: ModeratorMembershipArgs,
): Promise<HelixModResult<void>> {
  return helixRequest<void>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "POST",
    path: "/moderation/moderators",
    query: { broadcaster_id: args.broadcasterId, user_id: args.userId },
  });
}

export function removeModerator(
  args: ModeratorMembershipArgs,
): Promise<HelixModResult<void>> {
  return helixRequest<void>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "DELETE",
    path: "/moderation/moderators",
    query: { broadcaster_id: args.broadcasterId, user_id: args.userId },
  });
}

// ---------------------------------------------------------------------------
// 11. addVip / removeVip (broadcaster only)
// ---------------------------------------------------------------------------

export interface VipMembershipArgs {
  accessToken: string;
  /** Must match the client_id that minted `accessToken`. */
  clientId: string;
  broadcasterId: string;
  userId: string;
}

export function addVip(args: VipMembershipArgs): Promise<HelixModResult<void>> {
  return helixRequest<void>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "POST",
    path: "/channels/vips",
    query: { broadcaster_id: args.broadcasterId, user_id: args.userId },
  });
}

export function removeVip(args: VipMembershipArgs): Promise<HelixModResult<void>> {
  return helixRequest<void>({
    accessToken: args.accessToken,
    clientId: args.clientId,
    method: "DELETE",
    path: "/channels/vips",
    query: { broadcaster_id: args.broadcasterId, user_id: args.userId },
  });
}

/**
 * Twitch Helix - Chat Pin Mutations (authenticated)
 *
 * Official Helix chat-pin endpoints:
 *   PUT    /helix/chat/pins
 *   PATCH  /helix/chat/pins
 *   DELETE /helix/chat/pins
 *
 * The user access token must include `moderator:manage:chat_messages`, and
 * `moderator_id` must match the user id in that token. Timed pins accept
 * 30..1800 seconds; omitting duration pins until the stream ends.
 */

const HELIX_BASE = "https://api.twitch.tv/helix";
const REQUEST_TIMEOUT_MS = 10_000;
const REQUIRED_SCOPE = "moderator:manage:chat_messages";

export type PinMutationErrorKind =
  | "missing-scopes"
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "rate-limited"
  | "network"
  | "unknown";

export type PinMutationResult =
  | { ok: true }
  | { ok: false; kind: "missing-scopes"; message: string; missingScopes: string[] }
  | {
      ok: false;
      kind: Exclude<PinMutationErrorKind, "missing-scopes">;
      message: string;
    };

interface HelixErrorBody {
  error?: string;
  status?: number;
  message?: string;
}

function buildUrl(query: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    params.set(key, String(value));
  }
  return `${HELIX_BASE}/chat/pins?${params.toString()}`;
}

function parseMissingScopes(message: string): string[] {
  const match = /missing scope[s]?:\s*(.+)$/i.exec(message);
  if (!match) return [REQUIRED_SCOPE];
  const scopes = match[1]
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return scopes.length > 0 ? scopes : [REQUIRED_SCOPE];
}

function isMissingScope(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("missing scope") || lower.includes("scope is missing");
}

async function helixPinRequest(
  method: "PUT" | "PATCH" | "DELETE",
  query: Record<string, string | number | null | undefined>,
  accessToken: string,
  clientId: string
): Promise<PinMutationResult> {
  let res: Response;
  try {
    res = await fetch(buildUrl(query), {
      method,
      headers: {
        "Client-Id": clientId,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message };
  }

  if (res.status === 204) {
    return { ok: true };
  }

  let body: HelixErrorBody = {};
  try {
    body = (await res.json()) as HelixErrorBody;
  } catch {
    // Some failure bodies are not JSON; fall through with status text.
  }

  const message = body.message ?? `${res.status} ${res.statusText}`;

  if (res.status === 401) {
    if (isMissingScope(message)) {
      return {
        ok: false,
        kind: "missing-scopes",
        message,
        missingScopes: parseMissingScopes(message),
      };
    }
    return { ok: false, kind: "unauthenticated", message };
  }

  if (res.status === 403) return { ok: false, kind: "forbidden", message };
  if (res.status === 404) return { ok: false, kind: "not-found", message };
  if (res.status === 409) return { ok: false, kind: "conflict", message };
  if (res.status === 429) return { ok: false, kind: "rate-limited", message };
  if (res.status >= 500) return { ok: false, kind: "network", message };
  return { ok: false, kind: "unknown", message };
}

/**
 * Pin a chat message on a Twitch channel.
 */
export function pinChatMessage(
  broadcasterId: string,
  moderatorId: string,
  messageId: string,
  durationSeconds: number | null,
  accessToken: string,
  clientId: string
): Promise<PinMutationResult> {
  return helixPinRequest(
    "PUT",
    {
      broadcaster_id: broadcasterId,
      moderator_id: moderatorId,
      message_id: messageId,
      duration_seconds: durationSeconds,
    },
    accessToken,
    clientId
  );
}

/**
 * Update the duration of the current Twitch pinned chat message.
 */
export function updatePinnedChatMessage(
  broadcasterId: string,
  moderatorId: string,
  messageId: string,
  durationSeconds: number | null,
  accessToken: string,
  clientId: string
): Promise<PinMutationResult> {
  return helixPinRequest(
    "PATCH",
    {
      broadcaster_id: broadcasterId,
      moderator_id: moderatorId,
      message_id: messageId,
      duration_seconds: durationSeconds,
    },
    accessToken,
    clientId
  );
}

/**
 * Unpin a Twitch chat message by chat message id.
 */
export function unpinChatMessage(
  broadcasterId: string,
  moderatorId: string,
  messageId: string,
  accessToken: string,
  clientId: string
): Promise<PinMutationResult> {
  return helixPinRequest(
    "DELETE",
    {
      broadcaster_id: broadcasterId,
      moderator_id: moderatorId,
      message_id: messageId,
    },
    accessToken,
    clientId
  );
}

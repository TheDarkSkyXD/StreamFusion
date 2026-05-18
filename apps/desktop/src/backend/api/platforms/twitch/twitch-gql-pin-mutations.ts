/**
 * Twitch GQL — Pin / Unpin Mutations (authenticated)
 *
 * Twitch's pin/unpin operations are GraphQL mutations on `gql.twitch.tv/gql`,
 * NOT Helix endpoints. They require an authenticated Bearer token with the
 * `moderator:manage:chat_messages` scope.
 *
 * Schema captured via field-name probing on 2026-05-18:
 *
 *   mutation PinChatMessage($input: PinChatMessageInput!) {
 *     pinChatMessage(input: $input) { __typename }
 *   }
 *   input: {
 *     channelID: ID!
 *     messageID: ID!
 *     durationSeconds: Int            # null/omitted = no expiry
 *     type: PinnedChatMessageType!    # MOD
 *   }
 *
 *   mutation UnpinChatMessage($input: UnpinChatMessageInput!) {
 *     unpinChatMessage(input: $input) { __typename }
 *   }
 *   input: {
 *     id: ID!                          # PinnedChatMessage.id (NOT chat message id)
 *     reason: UnpinChatMessageReason!  # UNPIN
 *   }
 *
 * Errors are surfaced as `{ message: "unauthenticated" | "..." }` and we
 * map them to a small typed result so callers can branch on the kind.
 */

const GQL_ENDPOINT = "https://gql.twitch.tv/gql";
// Same anonymous Client-Id used elsewhere — Twitch accepts it for
// authenticated mutations too as long as a valid Bearer token is attached.
const GQL_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const REQUEST_TIMEOUT_MS = 10_000;

export type PinMutationErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "network"
  | "unknown";

export type PinMutationResult =
  | { ok: true }
  | { ok: false; kind: PinMutationErrorKind; message: string };

interface GqlErrorEnvelope {
  errors?: Array<{ message?: string; path?: string[] }>;
  data?: unknown;
}

function classifyError(message: string): PinMutationErrorKind {
  const lower = message.toLowerCase();
  if (lower.includes("unauthenticat")) return "unauthenticated";
  if (lower.includes("forbid") || lower.includes("permission")) return "forbidden";
  if (lower.includes("not found") || lower.includes("not_found")) return "not-found";
  return "unknown";
}

async function gqlMutation(
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  accessToken: string,
): Promise<PinMutationResult> {
  try {
    const res = await fetch(GQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Client-Id": GQL_CLIENT_ID,
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ operationName, query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, kind: "network", message: `${res.status} ${res.statusText}` };
    }
    const body = (await res.json()) as GqlErrorEnvelope;
    const firstErr = body.errors?.[0]?.message;
    if (firstErr) {
      return { ok: false, kind: classifyError(firstErr), message: firstErr };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message };
  }
}

/**
 * Pin a chat message on a Twitch channel.
 *
 * @param channelId   - Twitch broadcaster id (numeric string).
 * @param messageId   - The chat message's id (the UUID Twitch's IRC stream uses).
 * @param durationSeconds - Null/undefined means "no expiry"; otherwise one of 3600 / 43200 / 86400.
 * @param accessToken - OAuth Bearer token with `moderator:manage:chat_messages`.
 */
export function pinChatMessage(
  channelId: string,
  messageId: string,
  durationSeconds: number | null,
  accessToken: string,
): Promise<PinMutationResult> {
  return gqlMutation(
    "PinChatMessage",
    `mutation PinChatMessage($input: PinChatMessageInput!) {
      pinChatMessage(input: $input) { __typename }
    }`,
    {
      input: {
        channelID: channelId,
        messageID: messageId,
        ...(durationSeconds !== null ? { durationSeconds } : {}),
        type: "MOD",
      },
    },
    accessToken,
  );
}

/**
 * Unpin the currently pinned message on a Twitch channel.
 *
 * @param pinRecordId - The PinnedChatMessage.id from the read schema
 *                      (`channel.pinnedChatMessages.edges[].node.id`).
 * @param accessToken - OAuth Bearer token with `moderator:manage:chat_messages`.
 */
export function unpinChatMessage(
  pinRecordId: string,
  accessToken: string,
): Promise<PinMutationResult> {
  return gqlMutation(
    "UnpinChatMessage",
    `mutation UnpinChatMessage($input: UnpinChatMessageInput!) {
      unpinChatMessage(input: $input) { __typename }
    }`,
    {
      input: { id: pinRecordId, reason: "UNPIN" },
    },
    accessToken,
  );
}

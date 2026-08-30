/**
 * Kick - Pin / Unpin Mutations
 *
 * Legacy/internal endpoints:
 *
 *   POST   /api/v2/channels/{slug}/pinned-message
 *     body: { duration, message: { id, content, chatroom_id, created_at, sender, type: "message" } }
 *   DELETE /api/v2/channels/{slug}/pinned-message
 *
 * Kick returns 401 when these routes are called with the OAuth bearer token.
 * They must run through the main-process Kick web send-window so the hidden
 * kick.com page supplies session cookies, Kasada runtime state, and the web
 * Sanctum bearer captured from Kick's own requests.
 */

import { fetchKickWebApiMutation } from "./kick-send-window";

export type KickPinMutationErrorKind =
  "unauthenticated" | "forbidden" | "not-found" | "network" | "unknown";

export type KickPinMutationResult =
  { ok: true } | { ok: false; kind: KickPinMutationErrorKind; message: string };

function classify(status: number, body: unknown): KickPinMutationErrorKind {
  if (status === 401 || status === 419) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status >= 500) return "network";
  if (typeof body === "object" && body && "message" in body) {
    const m = String((body as { message: unknown }).message || "").toLowerCase();
    if (m.includes("unauthorize") || m.includes("unauthenticat")) return "unauthenticated";
    if (m.includes("forbid") || m.includes("permission")) return "forbidden";
  }
  return "unknown";
}

function toMutationResult(input: Awaited<ReturnType<typeof fetchKickWebApiMutation>>) {
  if (input.ok) return { ok: true } as const;
  return {
    ok: false,
    kind: input.kind === "auth-expired" ? "unauthenticated" : classify(input.status, null),
    message: input.status ? `${input.status}` : input.message,
  } as const;
}

export interface KickPinPayload {
  /** Channel slug (the lowercased streamer name in the URL). */
  channelSlug: string;
  /** Kick chat-message UUID. */
  messageId: string;
  /** Numeric chatroom id for the channel. */
  chatroomId: number;
  /** Raw message body. */
  content: string;
  /** Sender envelope as Kick's v2 endpoint expects it. */
  sender: { id: number; username: string; slug?: string; identity?: unknown };
  /** Pin duration in seconds. `null` lets the caller skip the field. */
  durationSeconds: number | null;
}

export async function pinKickMessage(payload: KickPinPayload): Promise<KickPinMutationResult> {
  const path = `/api/v2/channels/${encodeURIComponent(payload.channelSlug)}/pinned-message`;
  const body: Record<string, unknown> = {
    message: {
      id: payload.messageId,
      chatroom_id: payload.chatroomId,
      content: payload.content,
      created_at: new Date().toISOString(),
      sender: payload.sender,
      type: "message",
    },
  };
  if (payload.durationSeconds !== null) body.duration = payload.durationSeconds;

  return toMutationResult(await fetchKickWebApiMutation("POST", path, body));
}

export async function unpinKickMessage(channelSlug: string): Promise<KickPinMutationResult> {
  const path = `/api/v2/channels/${encodeURIComponent(channelSlug)}/pinned-message`;
  return toMutationResult(await fetchKickWebApiMutation("DELETE", path));
}

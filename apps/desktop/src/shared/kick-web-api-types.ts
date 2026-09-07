/** Shared, credential-free contracts for the Kick web-session bridge. */
export type KickWebApiFailureKind = "setup-required" | "auth-expired" | "network" | "unknown";

export type KickWebApiMutationMethod = "POST" | "DELETE";

export type KickWebApiMutationResult =
  | { ok: true; status: number; body: string }
  | { ok: false; kind: KickWebApiFailureKind; status: number; body: string; message: string };

export type KickChannelViewerRoleResult =
  | { ok: true; isModerator: boolean | null; status: number }
  | { ok: false; kind: KickWebApiFailureKind; status: number; message: string };

export type KickPinMutationErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "network"
  | "unknown";

export type KickPinMutationResult =
  | { ok: true }
  | { ok: false; kind: KickPinMutationErrorKind; message: string };

export interface KickPinPayload {
  channelSlug: string;
  messageId: string;
  chatroomId: number;
  content: string;
  sender: { id: number; username: string; slug?: string; identity?: unknown };
  durationSeconds: number | null;
}

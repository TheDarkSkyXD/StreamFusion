/**
 * Twitch Helix — Chat Settings (GET)
 *
 * Read companion to `updateChatSettings` (PATCH) in
 * twitch-helix-moderation-mutations.ts. Used by the chat-input info banner
 * to seed RoomState on channel mount.
 *
 * Endpoint: GET https://api.twitch.tv/helix/chat/settings
 * Auth: Bearer access token + Client-Id. The Client-Id MUST match the
 *   client_id that minted the token — Twitch rejects mismatched pairs with
 *   401 even when the token itself validates. The viewer-context response
 *   omits moderator_chat_delay* fields (we type them as optional).
 *
 * Returns a discriminated result mirroring the moderation-mutations shape so
 * callers can branch on failure kind without parsing strings. Pair this call
 * with `withTwitchHelixRetry` in `./helix-retry` to auto-refresh on 401.
 */

import type { ChatSettingsPayload } from "./twitch-helix-moderation-mutations";

const HELIX_CHAT_SETTINGS_URL = "https://api.twitch.tv/helix/chat/settings";
const REQUEST_TIMEOUT_MS = 10_000;

export type ChatSettingsErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "network"
  | "timeout";

export type ChatSettingsResult =
  | { ok: true; payload: ChatSettingsPayload }
  | { ok: false; kind: ChatSettingsErrorKind; message: string };

interface HelixDataEnvelope<T> {
  data?: T[];
}

interface HelixErrorBody {
  error?: string;
  status?: number;
  message?: string;
}

export interface GetChatSettingsArgs {
  /** Twitch numeric user id for the channel. */
  broadcasterId: string;
  /** OAuth access token (Bearer). Twitch rejects anonymous calls with 401. */
  accessToken: string;
  /**
   * Twitch app client_id — MUST match the client_id that minted the
   * `accessToken`. Helix rejects mismatched pairs with 401 even if the token
   * itself validates. In the renderer, pass `import.meta.env.VITE_TWITCH_CLIENT_ID`.
   */
  clientId: string;
  /**
   * Optional AbortSignal — composed with a 10s timeout. Callers passing
   * their own signal (e.g. a per-mount AbortController from the
   * useChatSettingsSync hook) get cleanup-on-unmount aborts.
   */
  signal?: AbortSignal;
}

/**
 * Fetch a channel's chat settings via authenticated Helix GET.
 */
export async function getChatSettings(args: GetChatSettingsArgs): Promise<ChatSettingsResult> {
  const { broadcasterId, accessToken, clientId, signal } = args;
  const url = `${HELIX_CHAT_SETTINGS_URL}?broadcaster_id=${encodeURIComponent(broadcasterId)}`;

  const composedSignal = composeSignals(signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS));

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "Client-Id": clientId,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: composedSignal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      // AbortSignal.timeout's TimeoutError surfaces as AbortError on the
      // composed signal — treat it as a distinct kind so the caller can
      // distinguish a hung CDN from network unreachable.
      const wasTimeout = !signal?.aborted;
      return {
        ok: false,
        kind: wasTimeout ? "timeout" : "network",
        message: wasTimeout ? "Request timed out" : "Request aborted",
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message };
  }

  if (res.status === 401) {
    return { ok: false, kind: "unauthorized", message: await readErrorMessage(res) };
  }
  if (res.status === 403) {
    return { ok: false, kind: "forbidden", message: await readErrorMessage(res) };
  }
  if (res.status === 404) {
    return { ok: false, kind: "not-found", message: await readErrorMessage(res) };
  }
  if (res.status === 429) {
    return { ok: false, kind: "rate-limited", message: await readErrorMessage(res) };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, kind: "network", message: await readErrorMessage(res) };
  }

  let envelope: HelixDataEnvelope<ChatSettingsPayload>;
  try {
    envelope = (await res.json()) as HelixDataEnvelope<ChatSettingsPayload>;
  } catch {
    return { ok: false, kind: "network", message: "Malformed Helix response" };
  }

  const payload = envelope.data?.[0];
  if (!payload) {
    return { ok: false, kind: "network", message: "Empty Helix response" };
  }

  return { ok: true, payload };
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as HelixErrorBody;
    return body.message ?? `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

/**
 * Compose two signals: the result aborts when either input aborts.
 * AbortSignal.any exists in Node 20+ / modern browsers — use it when present,
 * otherwise fall back to manual composition.
 */
function composeSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  // biome-ignore lint/suspicious/noExplicitAny: AbortSignal.any is es2024
  const anyFn = (AbortSignal as any).any as ((signals: AbortSignal[]) => AbortSignal) | undefined;
  if (typeof anyFn === "function") {
    return anyFn([a, b]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (a.aborted) controller.abort();
  else a.addEventListener("abort", onAbort, { once: true });
  if (b.aborted) controller.abort();
  else b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

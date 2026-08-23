import { session, type Session } from "electron";

const KICK_ORIGIN = "https://kick.com";
const KICK_PUBLIC_PARTITION = "persist:kick_public";
const KICK_SESSION_REQUEST_TIMEOUT_MS = 10_000;

export type KickSessionRequestResult =
  | {
      kind: "response";
      ok: boolean;
      status: number;
      body: string;
      contentType: string | null;
      retryAfter: string | null;
    }
  | { kind: "network-error"; message: string };

function assertKickApiPath(path: string): void {
  if (!/^\/api\/[A-Za-z0-9_?=&%./-]+$/.test(path)) {
    throw new Error("Kick session requests require a relative /api/ path.");
  }
}

async function requestKickSession(
  targetSession: Session,
  path: string,
  authorization?: string
): Promise<KickSessionRequestResult> {
  assertKickApiPath(path);
  try {
    const response = await targetSession.fetch(`${KICK_ORIGIN}${path}`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        Referer: `${KICK_ORIGIN}/`,
        "X-App-Platform": "web",
        "X-Requested-With": "XMLHttpRequest",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      signal: AbortSignal.timeout(KICK_SESSION_REQUEST_TIMEOUT_MS),
    });
    return {
      kind: "response",
      ok: response.ok,
      status: response.status,
      body: await response.text(),
      contentType: response.headers.get("content-type"),
      retryAfter: response.headers.get("retry-after"),
    };
  } catch (error) {
    return {
      kind: "network-error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// Guards: authenticated web reads use the default session so they reuse the user's durable Kick cookies.
export function requestAuthenticatedKickSession(
  path: string,
  authorization: string
): Promise<KickSessionRequestResult> {
  return requestKickSession(session.defaultSession, path, authorization);
}

// Guards: public web reads share the same persistent partition as the BrowserWindow compatibility path.
export function requestPublicKickSession(path: string): Promise<KickSessionRequestResult> {
  return requestKickSession(session.fromPartition(KICK_PUBLIC_PARTITION), path);
}

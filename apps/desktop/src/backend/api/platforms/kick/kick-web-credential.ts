import type { OnBeforeSendHeadersListenerDetails, Session } from "electron";

import { storageService } from "@backend/services/storage-service";

type BearerListener = (bearer: string) => void;

const installedSessions = new WeakSet<Session>();
const sessionListeners = new WeakMap<Session, Set<BearerListener>>();
let lastPersistedBearer: string | null = null;

export function isKickWebBearer(value: string): boolean {
  return /^Bearer \d+\|[A-Za-z0-9]+$/.test(value);
}

export function normalizeKickWebBearer(value: string): string | null {
  const candidate = value.startsWith("Bearer ") ? value : `Bearer ${value}`;
  return isKickWebBearer(candidate) ? candidate : null;
}

export function persistKickWebBearerCandidate(value: string): string | null {
  const bearer = normalizeKickWebBearer(value);
  if (!bearer) return null;
  if (lastPersistedBearer !== bearer) {
    storageService.saveKickWebBearer(bearer);
    lastPersistedBearer = bearer;
  }
  return bearer;
}

export function installKickWebBearerCapture(
  targetSession: Session,
  listener?: BearerListener
): void {
  if (listener) {
    const listeners = sessionListeners.get(targetSession) ?? new Set<BearerListener>();
    listeners.add(listener);
    sessionListeners.set(targetSession, listeners);
  }
  if (installedSessions.has(targetSession)) return;
  installedSessions.add(targetSession);

  targetSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://*.kick.com/*"] },
    (details: OnBeforeSendHeadersListenerDetails, callback) => {
      const auth = Object.entries(details.requestHeaders ?? {}).find(
        ([name]) => name.toLowerCase() === "authorization"
      )?.[1];
      if (typeof auth === "string") {
        const bearer = persistKickWebBearerCandidate(auth);
        if (bearer) {
          for (const notify of sessionListeners.get(targetSession) ?? []) notify(bearer);
        }
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

export function readPersistedKickWebBearer(): string | null {
  const bearer = storageService.getKickWebBearer();
  return bearer && isKickWebBearer(bearer) ? bearer : null;
}

export function clearPersistedKickWebBearer(): void {
  storageService.clearKickWebBearer();
  lastPersistedBearer = null;
}

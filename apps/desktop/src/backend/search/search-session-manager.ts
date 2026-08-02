class SearchCancelledError extends Error {
  constructor() {
    super("Search session cancelled");
    this.name = "AbortError";
  }
}

interface SearchSession {
  controller: AbortController;
  leases: number;
}

const sessions = new Map<string, SearchSession>();

export function attachSearchSession(sessionId: string) {
  let session = sessions.get(sessionId);
  if (!session || session.controller.signal.aborted) {
    session = { controller: new AbortController(), leases: 0 };
    sessions.set(sessionId, session);
  }
  const activeSession = session;
  activeSession.leases += 1;

  let released = false;
  return {
    signal: activeSession.controller.signal,
    release() {
      if (released) return;
      released = true;
      activeSession.leases -= 1;
      if (activeSession.leases === 0 && sessions.get(sessionId) === activeSession) {
        sessions.delete(sessionId);
      }
    },
  };
}

export function cancelSearchSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.controller.abort();
  return true;
}

export function assertSearchSessionActive(signal: AbortSignal): void {
  if (signal.aborted) throw new SearchCancelledError();
}

export function isSearchCancelled(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

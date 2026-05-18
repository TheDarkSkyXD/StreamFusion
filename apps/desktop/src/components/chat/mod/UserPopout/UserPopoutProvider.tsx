/**
 * UserPopoutProvider + useOpenUserPopout (U18)
 *
 * Context that mounts a single `UserPopout` instance per chat surface and
 * exposes an `openUserPopout(payload)` dispatcher consumed by `Username`.
 * When called for a different user, the provider swaps the rendered popout
 * content by changing `current` (React's `key` on userId forces a clean
 * remount so the profile fetcher kicks again).
 *
 * Used outside a provider, `useOpenUserPopout` returns a no-op so chat
 * surfaces that haven't been wrapped (tests, dev harness) don't crash.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { UserPopout } from "./UserPopout";

export interface OpenUserPopoutPayload {
  userId: string;
  username: string;
  platform: "twitch" | "kick";
  channelId: string;
  channelSlug: string;
  /** Kick chatroom id — required so the popout's footer can delete messages. */
  kickChatroomId?: number;
}

interface UserPopoutContextValue {
  openUserPopout: (payload: OpenUserPopoutPayload) => void;
  current: OpenUserPopoutPayload | null;
  close: () => void;
}

const UserPopoutContext = createContext<UserPopoutContextValue | null>(null);

export interface UserPopoutProviderProps {
  children: ReactNode;
}

export function UserPopoutProvider({ children }: UserPopoutProviderProps) {
  const [current, setCurrent] = useState<OpenUserPopoutPayload | null>(null);

  const openUserPopout = useCallback((payload: OpenUserPopoutPayload) => {
    setCurrent(payload);
  }, []);

  const close = useCallback(() => setCurrent(null), []);

  const value = useMemo<UserPopoutContextValue>(
    () => ({ openUserPopout, current, close }),
    [openUserPopout, current, close],
  );

  return (
    <UserPopoutContext.Provider value={value}>
      {children}
      {current ? (
        <UserPopout
          // Re-key on userId so swapping users forces the inner state
          // (profile fetch, dialog, refresh counter) to reset cleanly.
          key={`${current.platform}:${current.userId}`}
          userId={current.userId}
          username={current.username}
          platform={current.platform}
          channelId={current.channelId}
          channelSlug={current.channelSlug}
          kickChatroomId={current.kickChatroomId}
          open={true}
          onOpenChange={(open) => {
            if (!open) close();
          }}
        />
      ) : null}
    </UserPopoutContext.Provider>
  );
}

/**
 * Returns the popout dispatcher. When no provider is mounted, returns a
 * no-op callable and emits a single `console.debug` so the call-site stays
 * defensive against test / dev harnesses without the provider.
 */
export function useOpenUserPopout(): (payload: OpenUserPopoutPayload) => void {
  const ctx = useContext(UserPopoutContext);
  const warnedRef = useRef(false);
  const noop = useCallback(
    (_payload: OpenUserPopoutPayload) => {
      if (!warnedRef.current) {
        // biome-ignore lint/suspicious/noConsole: one-shot diagnostic for surfaces missing the provider.
        console.debug(
          "[UserPopout] openUserPopout called without a UserPopoutProvider mounted — ignoring.",
        );
        warnedRef.current = true;
      }
    },
    [],
  );
  return ctx ? ctx.openUserPopout : noop;
}

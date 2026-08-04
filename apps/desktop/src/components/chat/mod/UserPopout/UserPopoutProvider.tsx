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

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { logger } from "@/renderer/logging/logger";
import type { ChatMessage } from "@/shared/chat-types";

import { UserPopout, type UserPopoutPublicActions } from "./UserPopout";

export interface BadgeCatalogContext {
  state: "loading" | "ready" | "failed";
  sourceLabel: string;
  retry: () => void;
}

export interface OpenUserPopoutPayload {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  platform: "twitch" | "kick";
  channelId: string;
  channelSlug: string;
  /** Kick chatroom id — required so the popout's footer can delete messages. */
  kickChatroomId?: number;
  /** Immutable snapshot of the exact chat row whose username opened the dialog. */
  openingMessage?: ChatMessage;
}

interface UserPopoutContextValue {
  openUserPopout: (payload: OpenUserPopoutPayload) => void;
  current: OpenUserPopoutPayload | null;
  close: () => void;
}

const UserPopoutContext = createContext<UserPopoutContextValue | null>(null);

export interface UserPopoutProviderProps {
  children: ReactNode;
  badgeCatalog?: BadgeCatalogContext;
  publicActions?: UserPopoutPublicActions;
}

export function UserPopoutProvider({
  children,
  badgeCatalog,
  publicActions,
}: UserPopoutProviderProps) {
  const [current, setCurrent] = useState<OpenUserPopoutPayload | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const restoreFocusTimeout = useManagedTimeout(() => {
    const opener = openerRef.current;
    const target =
      opener?.isConnected === true
        ? opener
        : document.querySelector<HTMLElement>(
            "[data-chat-scroll-container], [data-testid='chat-message-list'], [role='log']"
          );
    if (target) {
      if (!target.matches("button, a, input, select, textarea, [tabindex]")) {
        target.tabIndex = -1;
      }
      target.focus();
    }
    openerRef.current = null;
  });

  const deferredActionTimeout = useManagedTimeout(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  });

  const openUserPopout = useCallback(
    (payload: OpenUserPopoutPayload) => {
      restoreFocusTimeout.clear();
      pendingActionRef.current = null;
      deferredActionTimeout.clear();
      openerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setCurrent(payload);
    },
    [deferredActionTimeout, restoreFocusTimeout]
  );

  const close = useCallback(() => {
    setCurrent(null);
    pendingActionRef.current = null;
    restoreFocusTimeout.start(0);
  }, [restoreFocusTimeout]);

  const closeForAction = useCallback(() => {
    restoreFocusTimeout.clear();
    openerRef.current = null;
    setCurrent(null);
  }, [restoreFocusTimeout]);

  const dialogPublicActions = useMemo(
    () =>
      publicActions
        ? {
            replyEligibility: publicActions.replyEligibility,
            onReply: (message: ChatMessage) => {
              pendingActionRef.current = () => publicActions.onReply(message);
              closeForAction();
              deferredActionTimeout.start(0);
            },
            onCopyToChat: publicActions.onCopyToChat
              ? (message: string) => {
                  pendingActionRef.current = () => publicActions.onCopyToChat?.(message);
                  closeForAction();
                  deferredActionTimeout.start(0);
                }
              : undefined,
            onViewChannel: (
              platform: "twitch" | "kick",
              channel: { id: string; username: string; displayName: string }
            ) => {
              pendingActionRef.current = () => publicActions.onViewChannel(platform, channel);
              closeForAction();
              deferredActionTimeout.start(0);
            },
          }
        : undefined,
    [closeForAction, deferredActionTimeout, publicActions]
  );

  const value = useMemo<UserPopoutContextValue>(
    () => ({ openUserPopout, current, close }),
    [openUserPopout, current, close]
  );

  return (
    <UserPopoutContext.Provider value={value}>
      {children}
      {current ? (
        <UserPopout
          // Re-key so switching users resets the dialog's profile state.
          key={`${current.platform}:${current.userId}:${current.openingMessage?.id ?? "profile"}`}
          userId={current.userId}
          username={current.username}
          displayName={current.displayName}
          avatarUrl={current.avatarUrl}
          platform={current.platform}
          channelId={current.channelId}
          channelSlug={current.channelSlug}
          kickChatroomId={current.kickChatroomId}
          openingMessage={current.openingMessage}
          badgeCatalog={badgeCatalog}
          publicActions={dialogPublicActions}
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
  const noop = useCallback((_payload: OpenUserPopoutPayload) => {
    if (!warnedRef.current) {
      logger.debug(
        "UI:Chat:Mod:UserPopout",
        "openUserPopout called without a UserPopoutProvider mounted — ignoring"
      );
      warnedRef.current = true;
    }
  }, []);
  return ctx ? ctx.openUserPopout : noop;
}

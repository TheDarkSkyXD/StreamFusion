import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AppLinkIntent,
  AppLinkSource,
} from "@mobile/capabilities/app-links";
import type { ShellRestorationRepository } from "@mobile/capabilities/persistence";

import {
  createInitialShellNavigationState,
  restoreShellNavigationState,
  serializeShellNavigationState,
  shellNavigationReducer,
  type ShellLocation,
  type ShellNavigationAction,
  type ShellNavigationState,
} from "./shell-navigation";

export type ShellLifecycleStatus =
  | "loading"
  | "restored"
  | "fresh"
  | "fallback-corrupt"
  | "fallback-unsupported"
  | "persistence-unavailable"
  | "write-failed";

export function appLinkIntentToLocation(intent: AppLinkIntent): ShellLocation {
  if (intent.kind === "activity-item") {
    return { route: "activity/alert-preview", eventId: intent.eventId };
  }
  return {
    route: "watch/session-preview",
    target: {
      kind: "channel",
      platform: intent.platform,
      channelId: intent.channelId,
      channelLogin: intent.channelLogin,
    },
  };
}

export function applyShellStartupInputs(
  initial: ShellNavigationState,
  intents: readonly AppLinkIntent[],
  actions: readonly ShellNavigationAction[],
): ShellNavigationState {
  let next = initial;
  for (const intent of intents) {
    next = shellNavigationReducer(next, {
      type: "navigate",
      location: appLinkIntentToLocation(intent),
    });
  }
  for (const action of actions) next = shellNavigationReducer(next, action);
  return next;
}

export async function writeShellSnapshot(
  restoration: ShellRestorationRepository,
  state: ShellNavigationState,
  updatedAt: number,
): Promise<boolean> {
  try {
    await restoration.write(serializeShellNavigationState(state), updatedAt);
    return true;
  } catch {
    return false;
  }
}

export function useShellLifecycleController(options: {
  readonly appLinks: AppLinkSource;
  readonly restoration: ShellRestorationRepository;
  readonly now?: () => number;
}): {
  readonly dispatch: (action: ShellNavigationAction) => void;
  readonly state: ShellNavigationState;
  readonly status: ShellLifecycleStatus;
} {
  const now = options.now ?? Date.now;
  const [state, setState] = useState(createInitialShellNavigationState);
  const [status, setStatus] = useState<ShellLifecycleStatus>("loading");
  const hydrated = useRef(false);
  const mounted = useRef(true);
  const pendingActions = useRef<ShellNavigationAction[]>([]);
  const pendingIntents = useRef<AppLinkIntent[]>([]);
  const writeChain = useRef(Promise.resolve());

  const dispatch = useCallback((action: ShellNavigationAction) => {
    if (!hydrated.current) {
      pendingActions.current.push(action);
      return;
    }
    setState((current) => shellNavigationReducer(current, action));
  }, []);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const unsubscribe = options.appLinks.subscribe((intent) => {
      if (!hydrated.current) {
        pendingIntents.current.push(intent);
        return;
      }
      dispatch({ type: "navigate", location: appLinkIntentToLocation(intent) });
    });

    void (async () => {
      let next = createInitialShellNavigationState();
      let nextStatus: ShellLifecycleStatus = "fresh";
      try {
        const saved = await options.restoration.read();
        if (saved) {
          const restored = restoreShellNavigationState(saved);
          next = restored.state;
          nextStatus =
            restored.kind === "restored"
              ? "restored"
              : restored.reason === "corrupt"
                ? "fallback-corrupt"
                : "fallback-unsupported";
          if (restored.kind === "fallback") await options.restoration.clear();
        }
      } catch {
        nextStatus = "persistence-unavailable";
      }

      const initialIntent = await options.appLinks
        .initialIntent()
        .catch(() => null);
      const intents = initialIntent
        ? [initialIntent, ...pendingIntents.current]
        : pendingIntents.current;
      pendingIntents.current = [];
      next = applyShellStartupInputs(next, intents, pendingActions.current);
      pendingActions.current = [];
      if (!active) return;
      hydrated.current = true;
      setState(next);
      setStatus(nextStatus);
    })();

    return () => {
      active = false;
      mounted.current = false;
      unsubscribe();
    };
  }, [dispatch, options.appLinks, options.restoration]);

  useEffect(() => {
    if (!hydrated.current) return;
    writeChain.current = writeChain.current.then(async () => {
      const saved = await writeShellSnapshot(options.restoration, state, now());
      if (!mounted.current) return;
      if (!saved) {
        setStatus("write-failed");
        return;
      }
      setStatus((current) =>
        current === "write-failed" || current === "persistence-unavailable"
          ? "restored"
          : current,
      );
    });
  }, [now, options.restoration, state]);

  return { dispatch, state, status };
}

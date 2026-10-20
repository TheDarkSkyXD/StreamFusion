import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AppLinkIntent,
  AppLinkSource,
} from "@mobile/features/shell/capabilities/app-links";
import type { ShellRestorationRepository } from "@mobile/features/storage/capabilities/persistence";
import type { ShellWatchChannelTarget } from "../domain/shell-watch-target";

import {
  createInitialShellNavigationState,
  restoreShellNavigationState,
  serializeShellNavigationState,
  shellNavigationReducer,
  type ShellLocation,
  type ShellNavigationAction,
  type ShellNavigationState,
} from "../domain/shell-navigation";

export type ShellLifecycleStatus =
  | "loading"
  | "restored"
  | "fresh"
  | "fallback-corrupt"
  | "fallback-unsupported"
  | "persistence-unavailable"
  | "write-failed";

export type StartupWatch = {
  readonly target: ShellWatchChannelTarget;
  readonly resume: boolean;
};

function savedWatchTarget(
  state: ShellNavigationState,
): ShellWatchChannelTarget | null {
  for (const location of state.histories.watch.trail.toReversed()) {
    if (
      location.route === "watch/session-preview" &&
      location.target.kind === "channel"
    ) {
      return location.target;
    }
  }
  return null;
}

export function appLinkIntentToLocation(intent: AppLinkIntent): ShellLocation {
  if (intent.kind === "activity-item") {
    return { route: "activity/alert-preview", eventId: intent.eventId };
  }
  if (intent.kind === "search") {
    return { route: "search" };
  }
  return {
    route: "watch/session-preview",
    target:
      intent.media === undefined
        ? {
            kind: "channel",
            platform: intent.platform,
            channelId: intent.channelId,
            channelLogin: intent.channelLogin,
          }
        : {
            kind: "channel",
            platform: intent.platform,
            channelId: intent.channelId,
            channelLogin: intent.channelLogin,
            media: intent.media,
          },
  };
}

export function appLinkIntentSearchQuery(intent: AppLinkIntent): string | null {
  return intent.kind === "search" &&
    intent.query !== undefined &&
    intent.query.length > 0
    ? intent.query
    : null;
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
  readonly restoreSession?: boolean;
  readonly resumePlayback?: boolean;
  readonly settingsReady?: boolean;
}): {
  readonly dispatch: (action: ShellNavigationAction) => void;
  readonly launchSearchQuery: string | null;
  readonly state: ShellNavigationState;
  readonly status: ShellLifecycleStatus;
  readonly startupWatch: StartupWatch | null;
} {
  const now = options.now ?? Date.now;
  const [state, setState] = useState(createInitialShellNavigationState);
  const [status, setStatus] = useState<ShellLifecycleStatus>("loading");
  const [launchSearchQuery, setLaunchSearchQuery] = useState<string | null>(
    null,
  );
  const [startupWatch, setStartupWatch] = useState<StartupWatch | null>(null);
  const hydrated = useRef(false);
  const mounted = useRef(true);
  const pendingActions = useRef<ShellNavigationAction[]>([]);
  const pendingIntents = useRef<AppLinkIntent[]>([]);
  const writeChain = useRef(Promise.resolve());
  const restoreSessionRef = useRef(options.restoreSession);
  const resumePlaybackRef = useRef(options.resumePlayback);
  const settingsReady = options.settingsReady ?? true;

  useEffect(() => {
    restoreSessionRef.current = options.restoreSession;
    resumePlaybackRef.current = options.resumePlayback;
  }, [options.restoreSession, options.resumePlayback]);

  const dispatch = useCallback((action: ShellNavigationAction) => {
    if (!hydrated.current) {
      pendingActions.current.push(action);
      return;
    }
    setStartupWatch((current) => {
      if (current?.resume) return null;
      if (
        (action.type === "select" && action.destination === "watch") ||
        (action.type === "navigate" &&
          (action.location.route === "watch" ||
            action.location.route === "watch/session-preview"))
      )
        return null;
      return current;
    });
    setState((current) => shellNavigationReducer(current, action));
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    let active = true;
    mounted.current = true;
    const unsubscribe = options.appLinks.subscribe((intent) => {
      if (!hydrated.current) {
        pendingIntents.current.push(intent);
        return;
      }
      const query = appLinkIntentSearchQuery(intent);
      if (query !== null) setLaunchSearchQuery(query);
      dispatch({ type: "navigate", location: appLinkIntentToLocation(intent) });
    });

    void (async () => {
      let next = createInitialShellNavigationState();
      let restoredWatch: ShellWatchChannelTarget | null = null;
      let nextStatus: ShellLifecycleStatus = "fresh";
      try {
        if (restoreSessionRef.current !== false) {
          const saved = await options.restoration.read();
          if (saved) {
            const restored = restoreShellNavigationState(saved);
            next = restored.state;
            if (restored.kind === "restored")
              restoredWatch = savedWatchTarget(next);
            nextStatus =
              restored.kind === "restored"
                ? "restored"
                : restored.reason === "corrupt"
                  ? "fallback-corrupt"
                  : "fallback-unsupported";
            if (restored.kind === "fallback") await options.restoration.clear();
          }
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
      const startupWatch =
        restoredWatch &&
        intents.length === 0 &&
        pendingActions.current.length === 0
          ? {
              target: restoredWatch,
              resume: resumePlaybackRef.current === true,
            }
          : null;
      next = applyShellStartupInputs(next, intents, pendingActions.current);
      pendingActions.current = [];
      if (!active) return;
      hydrated.current = true;
      const bootQuery = [...intents]
        .reverse()
        .map(appLinkIntentSearchQuery)
        .find((query) => query !== null);
      if (bootQuery !== undefined) setLaunchSearchQuery(bootQuery);
      setStartupWatch(startupWatch);
      setState(next);
      setStatus(nextStatus);
    })();

    return () => {
      active = false;
      mounted.current = false;
      unsubscribe();
    };
  }, [dispatch, options.appLinks, options.restoration, settingsReady]);

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

  return { dispatch, launchSearchQuery, state, status, startupWatch };
}

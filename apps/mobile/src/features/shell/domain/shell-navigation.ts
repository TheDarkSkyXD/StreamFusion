import type { Platform } from "@streamfusion/core/platform";

export type ShellDestinationId =
  "search" | "following" | "watch" | "activity" | "more";

export type ShellRouteId =
  | ShellDestinationId
  | "search/result-preview"
  | "following/channel-preview"
  | "watch/session-preview"
  | "activity/alert-preview"
  | "activity/job-preview"
  | "more/home"
  | "more/categories"
  | "more/multistream"
  | "more/history"
  | "more/moderation"
  | "more/settings"
  | "more/diagnostics"
  | "more/accounts";

type StaticShellRouteId = Exclude<
  ShellRouteId,
  "watch/session-preview" | "activity/alert-preview" | "activity/job-preview"
>;

export type ShellLocation =
  | { readonly route: StaticShellRouteId }
  | {
      readonly route: "watch/session-preview";
      readonly target:
        | { readonly kind: "preview" }
        | {
            readonly kind: "channel";
            readonly platform: Platform;
            readonly channelId: string;
            readonly channelLogin: string;
          };
    }
  | { readonly route: "activity/alert-preview"; readonly eventId: string }
  | { readonly route: "activity/job-preview"; readonly jobId: string };

export interface ShellDestination {
  readonly id: ShellDestinationId;
  readonly label: string;
  readonly rootRoute: ShellDestinationId;
}

export interface ShellRoute {
  readonly destination: ShellDestinationId;
  readonly eyebrow: string;
  readonly id: ShellRouteId;
  readonly reviewId: string;
  readonly summary: string;
  readonly title: string;
}

export interface DestinationHistory {
  readonly root: ShellDestinationId;
  readonly trail: readonly ShellLocation[];
}

export interface ShellNavigationState {
  readonly activeDestination: ShellDestinationId;
  readonly histories: Readonly<Record<ShellDestinationId, DestinationHistory>>;
  readonly rootScrollRequests: Readonly<Record<ShellDestinationId, number>>;
}

export type ShellNavigationAction =
  | { readonly type: "select"; readonly destination: ShellDestinationId }
  | { readonly type: "navigate"; readonly location: ShellLocation }
  | { readonly type: "back" };

export type ShellRestorationResult =
  | { readonly kind: "restored"; readonly state: ShellNavigationState }
  | {
      readonly kind: "fallback";
      readonly reason: "corrupt" | "unsupported";
      readonly state: ShellNavigationState;
    };

export const SHELL_DESTINATIONS = [
  { id: "search", label: "Search", rootRoute: "search" },
  { id: "following", label: "Following", rootRoute: "following" },
  { id: "watch", label: "Watch", rootRoute: "watch" },
  { id: "activity", label: "Activity", rootRoute: "activity" },
  { id: "more", label: "More", rootRoute: "more" },
] as const satisfies readonly ShellDestination[];

const SHELL_DESTINATION_IDS = SHELL_DESTINATIONS.map(({ id }) => id);

export const MORE_ROUTE_IDS = [
  "more/home",
  "more/categories",
  "more/multistream",
  "more/history",
  "more/moderation",
  "more/settings",
  "more/diagnostics",
  "more/accounts",
] as const satisfies readonly ShellRouteId[];

export const SHELL_ROUTES: Readonly<Record<ShellRouteId, ShellRoute>> = {
  search: route(
    "search",
    "DISCOVER",
    "search-root",
    "Find channels, streams, videos, clips, and categories across Twitch and Kick.",
    "Search",
    "search",
  ),
  "search/result-preview": route(
    "search/result-preview",
    "SEARCH",
    "search-result-preview",
    "Search result details stay inside Search until you choose something to watch.",
    "Result preview",
    "search",
  ),
  following: route(
    "following",
    "YOUR CHANNELS",
    "following-root",
    "Live channels and Guest Follows will stay close without mixing in recommendations.",
    "Following",
    "following",
  ),
  "following/channel-preview": route(
    "following/channel-preview",
    "FOLLOWING",
    "following-channel-preview",
    "A channel can open here without losing your place in any other destination.",
    "Channel preview",
    "following",
  ),
  watch: route(
    "watch",
    "NOW PLAYING",
    "watch-root",
    "Live streams, videos, clips, chat, and Multistream share one focused workspace.",
    "Watch",
    "watch",
  ),
  "watch/session-preview": route(
    "watch/session-preview",
    "WATCH",
    "watch-session-preview",
    "The selected destination is restored without starting playback automatically.",
    "Session preview",
    "watch",
  ),
  activity: route(
    "activity",
    "INBOX",
    "activity-root",
    "Channel alerts, media jobs, moderation, device health, and updates arrive here.",
    "Activity",
    "activity",
  ),
  "activity/alert-preview": route(
    "activity/alert-preview",
    "ACTIVITY",
    "activity-alert-preview",
    "Open a saved Activity item and its allowlisted destination.",
    "Activity detail",
    "activity",
  ),
  "activity/job-preview": route(
    "activity/job-preview",
    "ACTIVITY",
    "activity-job-preview",
    "Media job details remain local and survive lifecycle restoration.",
    "Media job",
    "activity",
  ),
  more: route(
    "more",
    "STREAMFUSION",
    "more-root",
    "Home and every secondary tool live here, away from the viewing controls you use most.",
    "More",
    "more",
  ),
  "more/home": route(
    "more/home",
    "MORE",
    "more-home",
    "Browse the combined Twitch and Kick recommendation feed.",
    "Home",
    "more",
  ),
  "more/categories": route(
    "more/categories",
    "MORE",
    "more-categories",
    "Browse categories and open a selected category without changing the shell.",
    "Categories",
    "more",
  ),
  "more/multistream": route(
    "more/multistream",
    "MORE",
    "more-multistream",
    "Configure a room here, then continue in Watch with one focused audio source.",
    "Multistream",
    "more",
  ),
  "more/history": route(
    "more/history",
    "MORE",
    "more-history",
    "Return to watched streams, videos, and clips with their content type intact.",
    "History",
    "more",
  ),
  "more/moderation": route(
    "more/moderation",
    "MORE",
    "more-moderation",
    "Open eligible managed channels and their Platform-specific actions.",
    "Moderation",
    "more",
  ),
  "more/settings": route(
    "more/settings",
    "MORE",
    "more-settings",
    "Appearance, playback, chat, notifications, integrations, and maintenance stay together.",
    "Settings",
    "more",
  ),
  "more/diagnostics": route(
    "more/diagnostics",
    "MORE",
    "more-diagnostics",
    "Inspect device health, capabilities, redacted reports, and recovery actions.",
    "Diagnostics",
    "more",
  ),
  "more/accounts": route(
    "more/accounts",
    "MORE",
    "more-accounts",
    "Connect Platforms and manage account state without making identity a sixth destination.",
    "Accounts and maintenance",
    "more",
  ),
};

function route(
  id: ShellRouteId,
  eyebrow: string,
  reviewId: string,
  summary: string,
  title: string,
  destination: ShellDestinationId,
): ShellRoute {
  return { destination, eyebrow, id, reviewId, summary, title };
}

const initialScrollRequests: ShellNavigationState["rootScrollRequests"] = {
  search: 0,
  following: 0,
  watch: 0,
  activity: 0,
  more: 0,
};

function createInitialHistories(): ShellNavigationState["histories"] {
  return {
    search: { root: "search", trail: [] },
    following: { root: "following", trail: [] },
    watch: { root: "watch", trail: [] },
    activity: { root: "activity", trail: [] },
    more: { root: "more", trail: [] },
  };
}

export function createInitialShellNavigationState(): ShellNavigationState {
  return {
    activeDestination: "search",
    histories: createInitialHistories(),
    rootScrollRequests: initialScrollRequests,
  };
}

export function getActiveShellLocation(
  state: ShellNavigationState,
): ShellLocation {
  const history = state.histories[state.activeDestination];
  return history.trail.at(-1) ?? { route: history.root };
}

export function getActiveShellRoute(state: ShellNavigationState): ShellRoute {
  return SHELL_ROUTES[getActiveShellLocation(state).route];
}

export function canNavigateBack(state: ShellNavigationState): boolean {
  return state.histories[state.activeDestination].trail.length > 0;
}

function locationsMatch(left: ShellLocation, right: ShellLocation): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function shellNavigationReducer(
  state: ShellNavigationState,
  action: ShellNavigationAction,
): ShellNavigationState {
  switch (action.type) {
    case "select": {
      if (action.destination !== state.activeDestination)
        return { ...state, activeDestination: action.destination };
      const activeHistory = state.histories[action.destination];
      if (activeHistory.trail.length > 0) {
        return {
          ...state,
          histories: {
            ...state.histories,
            [action.destination]: { ...activeHistory, trail: [] },
          },
        };
      }
      return {
        ...state,
        rootScrollRequests: {
          ...state.rootScrollRequests,
          [action.destination]:
            state.rootScrollRequests[action.destination] + 1,
        },
      };
    }
    case "navigate": {
      const route = SHELL_ROUTES[action.location.route];
      const history = state.histories[route.destination];
      if (action.location.route === history.root) {
        return {
          ...state,
          activeDestination: route.destination,
          histories: {
            ...state.histories,
            [route.destination]: { ...history, trail: [] },
          },
        };
      }
      const current = history.trail.at(-1);
      if (current && locationsMatch(current, action.location))
        return { ...state, activeDestination: route.destination };
      return {
        ...state,
        activeDestination: route.destination,
        histories: {
          ...state.histories,
          [route.destination]: {
            ...history,
            trail: [...history.trail, action.location].slice(-20),
          },
        },
      };
    }
    case "back": {
      const history = state.histories[state.activeDestination];
      if (history.trail.length === 0) return state;
      return {
        ...state,
        histories: {
          ...state.histories,
          [state.activeDestination]: {
            ...history,
            trail: history.trail.slice(0, -1),
          },
        },
      };
    }
  }
}

export function serializeShellNavigationState(
  state: ShellNavigationState,
): string {
  return JSON.stringify({
    version: 1,
    activeDestination: state.activeDestination,
    histories: Object.fromEntries(
      SHELL_DESTINATION_IDS.map((destination) => [
        destination,
        state.histories[destination].trail,
      ]),
    ),
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

const identifierPattern = /^[a-zA-Z0-9._:-]{1,256}$/u;
const channelLoginPattern = /^[a-zA-Z0-9_-]{1,64}$/u;

function isDestinationId(value: unknown): value is ShellDestinationId {
  return SHELL_DESTINATION_IDS.some((destination) => destination === value);
}

function isPlatform(value: unknown): value is Platform {
  return value === "twitch" || value === "kick";
}

function isStaticRoute(value: unknown): value is StaticShellRouteId {
  return (
    typeof value === "string" &&
    Object.hasOwn(SHELL_ROUTES, value) &&
    value !== "watch/session-preview" &&
    value !== "activity/alert-preview" &&
    value !== "activity/job-preview"
  );
}

function isShellLocation(value: unknown): value is ShellLocation {
  if (!isRecord(value) || typeof value.route !== "string") return false;
  if (isStaticRoute(value.route)) return hasOnlyKeys(value, ["route"]);
  if (value.route === "activity/alert-preview")
    return (
      hasOnlyKeys(value, ["route", "eventId"]) &&
      typeof value.eventId === "string" &&
      identifierPattern.test(value.eventId)
    );
  if (value.route === "activity/job-preview")
    return (
      hasOnlyKeys(value, ["route", "jobId"]) &&
      typeof value.jobId === "string" &&
      identifierPattern.test(value.jobId)
    );
  if (value.route !== "watch/session-preview" || !isRecord(value.target))
    return false;
  if (value.target.kind === "preview")
    return (
      hasOnlyKeys(value, ["route", "target"]) &&
      hasOnlyKeys(value.target, ["kind"])
    );
  return (
    value.target.kind === "channel" &&
    hasOnlyKeys(value, ["route", "target"]) &&
    hasOnlyKeys(value.target, [
      "kind",
      "platform",
      "channelId",
      "channelLogin",
    ]) &&
    isPlatform(value.target.platform) &&
    typeof value.target.channelId === "string" &&
    identifierPattern.test(value.target.channelId) &&
    typeof value.target.channelLogin === "string" &&
    channelLoginPattern.test(value.target.channelLogin)
  );
}

function isTrailForDestination(
  value: unknown,
  destination: ShellDestinationId,
): value is readonly ShellLocation[] {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every(
      (location) =>
        isShellLocation(location) &&
        location.route !== destination &&
        SHELL_ROUTES[location.route].destination === destination,
    )
  );
}

export function restoreShellNavigationState(
  value: string,
): ShellRestorationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return fallback("corrupt");
  }
  if (
    isRecord(parsed) &&
    typeof parsed.version === "number" &&
    parsed.version !== 1
  )
    return fallback("unsupported");
  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, ["version", "activeDestination", "histories"]) ||
    parsed.version !== 1 ||
    !isDestinationId(parsed.activeDestination) ||
    !isRecord(parsed.histories) ||
    !hasOnlyKeys(parsed.histories, SHELL_DESTINATION_IDS) ||
    !isTrailForDestination(parsed.histories.search, "search") ||
    !isTrailForDestination(parsed.histories.following, "following") ||
    !isTrailForDestination(parsed.histories.watch, "watch") ||
    !isTrailForDestination(parsed.histories.activity, "activity") ||
    !isTrailForDestination(parsed.histories.more, "more")
  )
    return fallback("corrupt");

  return {
    kind: "restored",
    state: {
      activeDestination: parsed.activeDestination,
      histories: {
        search: { root: "search", trail: parsed.histories.search },
        following: { root: "following", trail: parsed.histories.following },
        watch: { root: "watch", trail: parsed.histories.watch },
        activity: { root: "activity", trail: parsed.histories.activity },
        more: { root: "more", trail: parsed.histories.more },
      },
      rootScrollRequests: initialScrollRequests,
    },
  };
}

function fallback(reason: "corrupt" | "unsupported"): ShellRestorationResult {
  return {
    kind: "fallback",
    reason,
    state: createInitialShellNavigationState(),
  };
}

export function getShellNavigationPlacement(width: number): "bottom" | "rail" {
  return width < 600 ? "bottom" : "rail";
}

export type ShellDestinationId =
  | "search"
  | "following"
  | "watch"
  | "activity"
  | "more";

export type ShellRouteId =
  | ShellDestinationId
  | "search/result-preview"
  | "following/channel-preview"
  | "watch/session-preview"
  | "activity/alert-preview"
  | "more/home"
  | "more/categories"
  | "more/multistream"
  | "more/history"
  | "more/moderation"
  | "more/settings"
  | "more/diagnostics"
  | "more/accounts";

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
  readonly trail: readonly ShellRouteId[];
}

export interface ShellNavigationState {
  readonly activeDestination: ShellDestinationId;
  readonly histories: Readonly<Record<ShellDestinationId, DestinationHistory>>;
  readonly rootScrollRequests: Readonly<Record<ShellDestinationId, number>>;
}

export type ShellNavigationAction =
  | {
      readonly type: "select";
      readonly destination: ShellDestinationId;
    }
  | {
      readonly type: "navigate";
      readonly route: ShellRouteId;
    }
  | { readonly type: "back" };

export const SHELL_DESTINATIONS = [
  { id: "search", label: "Search", rootRoute: "search" },
  { id: "following", label: "Following", rootRoute: "following" },
  { id: "watch", label: "Watch", rootRoute: "watch" },
  { id: "activity", label: "Activity", rootRoute: "activity" },
  { id: "more", label: "More", rootRoute: "more" },
] as const satisfies readonly ShellDestination[];

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
  search: {
    destination: "search",
    eyebrow: "DISCOVER",
    id: "search",
    reviewId: "search-root",
    summary: "Find channels, streams, videos, clips, and categories across Twitch and Kick.",
    title: "Search",
  },
  "search/result-preview": {
    destination: "search",
    eyebrow: "SEARCH",
    id: "search/result-preview",
    reviewId: "search-result-preview",
    summary: "Search result details stay inside Search until you choose something to watch.",
    title: "Result preview",
  },
  following: {
    destination: "following",
    eyebrow: "YOUR CHANNELS",
    id: "following",
    reviewId: "following-root",
    summary: "Live channels and Guest Follows will stay close without mixing in recommendations.",
    title: "Following",
  },
  "following/channel-preview": {
    destination: "following",
    eyebrow: "FOLLOWING",
    id: "following/channel-preview",
    reviewId: "following-channel-preview",
    summary: "A channel can open here without losing your place in any other destination.",
    title: "Channel preview",
  },
  watch: {
    destination: "watch",
    eyebrow: "NOW PLAYING",
    id: "watch",
    reviewId: "watch-root",
    summary: "Live streams, videos, clips, chat, and Multistream share one focused workspace.",
    title: "Watch",
  },
  "watch/session-preview": {
    destination: "watch",
    eyebrow: "WATCH",
    id: "watch/session-preview",
    reviewId: "watch-session-preview",
    summary: "The active session remains owned by Watch while you move around StreamFusion.",
    title: "Session preview",
  },
  activity: {
    destination: "activity",
    eyebrow: "INBOX",
    id: "activity",
    reviewId: "activity-root",
    summary: "Channel alerts, media jobs, moderation, device health, and updates arrive here.",
    title: "Activity",
  },
  "activity/alert-preview": {
    destination: "activity",
    eyebrow: "ACTIVITY",
    id: "activity/alert-preview",
    reviewId: "activity-alert-preview",
    summary: "Activity details keep a direct return path to the item that raised them.",
    title: "Alert preview",
  },
  more: {
    destination: "more",
    eyebrow: "STREAMFUSION",
    id: "more",
    reviewId: "more-root",
    summary: "Home and every secondary tool live here, away from the viewing controls you use most.",
    title: "More",
  },
  "more/home": {
    destination: "more",
    eyebrow: "MORE",
    id: "more/home",
    reviewId: "more-home",
    summary: "Browse the combined Twitch and Kick recommendation feed.",
    title: "Home",
  },
  "more/categories": {
    destination: "more",
    eyebrow: "MORE",
    id: "more/categories",
    reviewId: "more-categories",
    summary: "Browse categories and open a selected category without changing the shell.",
    title: "Categories",
  },
  "more/multistream": {
    destination: "more",
    eyebrow: "MORE",
    id: "more/multistream",
    reviewId: "more-multistream",
    summary: "Configure a room here, then continue in Watch with one focused audio source.",
    title: "Multistream",
  },
  "more/history": {
    destination: "more",
    eyebrow: "MORE",
    id: "more/history",
    reviewId: "more-history",
    summary: "Return to watched streams, videos, and clips with their content type intact.",
    title: "History",
  },
  "more/moderation": {
    destination: "more",
    eyebrow: "MORE",
    id: "more/moderation",
    reviewId: "more-moderation",
    summary: "Open eligible managed channels and their Platform-specific actions.",
    title: "Moderation",
  },
  "more/settings": {
    destination: "more",
    eyebrow: "MORE",
    id: "more/settings",
    reviewId: "more-settings",
    summary: "Appearance, playback, chat, notifications, integrations, and maintenance stay together.",
    title: "Settings",
  },
  "more/diagnostics": {
    destination: "more",
    eyebrow: "MORE",
    id: "more/diagnostics",
    reviewId: "more-diagnostics",
    summary: "Inspect device health, capabilities, redacted reports, and recovery actions.",
    title: "Diagnostics",
  },
  "more/accounts": {
    destination: "more",
    eyebrow: "MORE",
    id: "more/accounts",
    reviewId: "more-accounts",
    summary: "Connect Platforms and manage account state without making identity a sixth destination.",
    title: "Accounts and maintenance",
  },
};

const initialHistories: ShellNavigationState["histories"] = {
  search: { root: "search", trail: [] },
  following: { root: "following", trail: [] },
  watch: { root: "watch", trail: [] },
  activity: { root: "activity", trail: [] },
  more: { root: "more", trail: [] },
};

const initialScrollRequests: ShellNavigationState["rootScrollRequests"] = {
  search: 0,
  following: 0,
  watch: 0,
  activity: 0,
  more: 0,
};

export function createInitialShellNavigationState(): ShellNavigationState {
  return {
    activeDestination: "search",
    histories: initialHistories,
    rootScrollRequests: initialScrollRequests,
  };
}

export function getActiveShellRoute(
  state: ShellNavigationState,
): ShellRoute {
  const history = state.histories[state.activeDestination];
  const routeId = history.trail.at(-1) ?? history.root;
  return SHELL_ROUTES[routeId];
}

export function canNavigateBack(state: ShellNavigationState): boolean {
  return state.histories[state.activeDestination].trail.length > 0;
}

export function shellNavigationReducer(
  state: ShellNavigationState,
  action: ShellNavigationAction,
): ShellNavigationState {
  switch (action.type) {
    case "select": {
      if (action.destination !== state.activeDestination) {
        return { ...state, activeDestination: action.destination };
      }

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
          [action.destination]: state.rootScrollRequests[action.destination] + 1,
        },
      };
    }
    case "navigate": {
      const route = SHELL_ROUTES[action.route];
      const history = state.histories[route.destination];
      if (action.route === history.root) {
        return {
          ...state,
          activeDestination: route.destination,
          histories: {
            ...state.histories,
            [route.destination]: { ...history, trail: [] },
          },
        };
      }

      if (history.trail.at(-1) === action.route) {
        return { ...state, activeDestination: route.destination };
      }

      return {
        ...state,
        activeDestination: route.destination,
        histories: {
          ...state.histories,
          [route.destination]: {
            ...history,
            trail: [...history.trail, action.route],
          },
        },
      };
    }
    case "back": {
      const history = state.histories[state.activeDestination];
      if (history.trail.length === 0) {
        return state;
      }
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
    default: {
      const exhaustiveAction: never = action;
      return exhaustiveAction;
    }
  }
}

export function getShellNavigationPlacement(width: number): "bottom" | "rail" {
  return width < 600 ? "bottom" : "rail";
}

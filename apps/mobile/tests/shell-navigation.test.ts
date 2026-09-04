import { describe, expect, it } from "vitest";

import { mobileSizing } from "@mobile/design/tokens";
import {
  canNavigateBack,
  createInitialShellNavigationState,
  getActiveShellRoute,
  getShellNavigationPlacement,
  MORE_ROUTE_IDS,
  SHELL_DESTINATIONS,
  shellNavigationReducer,
} from "@mobile/features/shell/shell-navigation";

describe("adaptive app shell", () => {
  it("defines exactly the approved static destinations in order", () => {
    expect(SHELL_DESTINATIONS.map(({ id }) => id)).toEqual([
      "search",
      "following",
      "watch",
      "activity",
      "more",
    ]);
  });

  it("uses bottom navigation on compact windows and a rail at 600 dp", () => {
    expect(getShellNavigationPlacement(320)).toBe("bottom");
    expect(getShellNavigationPlacement(599)).toBe("bottom");
    expect(getShellNavigationPlacement(600)).toBe("rail");
    expect(getShellNavigationPlacement(1_280)).toBe("rail");
  });

  it("keeps interactive targets at least 48 dp", () => {
    expect(mobileSizing.minimumTouchTarget).toBeGreaterThanOrEqual(48);
  });

  it("preserves independent histories while destinations change", () => {
    let state = createInitialShellNavigationState();
    state = shellNavigationReducer(state, {
      type: "navigate",
      route: "search/result-preview",
    });
    state = shellNavigationReducer(state, {
      type: "navigate",
      route: "more/settings",
    });
    state = shellNavigationReducer(state, {
      type: "select",
      destination: "search",
    });

    expect(getActiveShellRoute(state).id).toBe("search/result-preview");
    expect(state.histories.more.trail).toEqual(["more/settings"]);
    expect(canNavigateBack(state)).toBe(true);
  });

  it("pops only the active destination on Back", () => {
    let state = createInitialShellNavigationState();
    state = shellNavigationReducer(state, {
      type: "navigate",
      route: "search/result-preview",
    });
    state = shellNavigationReducer(state, { type: "back" });

    expect(getActiveShellRoute(state).id).toBe("search");
    expect(canNavigateBack(state)).toBe(false);
    expect(shellNavigationReducer(state, { type: "back" })).toBe(state);
  });

  it("returns an active destination to root, then requests scroll-to-top", () => {
    let state = createInitialShellNavigationState();
    state = shellNavigationReducer(state, {
      type: "navigate",
      route: "following/channel-preview",
    });
    state = shellNavigationReducer(state, {
      type: "select",
      destination: "following",
    });

    expect(getActiveShellRoute(state).id).toBe("following");
    expect(state.rootScrollRequests.following).toBe(0);

    state = shellNavigationReducer(state, {
      type: "select",
      destination: "following",
    });
    expect(state.rootScrollRequests.following).toBe(1);
  });

  it("keeps Home first and Accounts or maintenance last under More", () => {
    expect(MORE_ROUTE_IDS).toEqual([
      "more/home",
      "more/categories",
      "more/multistream",
      "more/history",
      "more/moderation",
      "more/settings",
      "more/diagnostics",
      "more/accounts",
    ]);
  });
});

import { describe, expect, it } from "vitest";

import { mobileSizing } from "@mobile/design/tokens";
import {
  canNavigateBack,
  createInitialShellNavigationState,
  getActiveShellLocation,
  getActiveShellRoute,
  getShellNavigationPlacement,
  MORE_ROUTE_IDS,
  restoreShellNavigationState,
  SHELL_DESTINATIONS,
  serializeShellNavigationState,
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
      location: { route: "search/result-preview" },
    });
    state = shellNavigationReducer(state, {
      type: "navigate",
      location: { route: "more/settings" },
    });
    state = shellNavigationReducer(state, {
      type: "select",
      destination: "search",
    });

    expect(getActiveShellRoute(state).id).toBe("search/result-preview");
    expect(state.histories.more.trail).toEqual([{ route: "more/settings" }]);
    expect(canNavigateBack(state)).toBe(true);
  });

  it("pops only the active destination on Back", () => {
    let state = createInitialShellNavigationState();
    state = shellNavigationReducer(state, {
      type: "navigate",
      location: { route: "search/result-preview" },
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
      location: { route: "following/channel-preview" },
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

  it("restores allowlisted locations and all independent histories", () => {
    let state = createInitialShellNavigationState();
    state = shellNavigationReducer(state, {
      type: "navigate",
      location: {
        route: "watch/session-preview",
        target: {
          kind: "channel",
          platform: "twitch",
          channelId: "channel-1",
          channelLogin: "proofstreamer",
        },
      },
    });
    state = shellNavigationReducer(state, {
      type: "navigate",
      location: { route: "more/diagnostics" },
    });

    const restored = restoreShellNavigationState(
      serializeShellNavigationState(state),
    );
    expect(restored.kind).toBe("restored");
    expect(restored.state.activeDestination).toBe("more");
    expect(restored.state.histories.watch.trail).toHaveLength(1);
    expect(getActiveShellLocation(restored.state)).toEqual({
      route: "more/diagnostics",
    });
  });

  it("caps each destination history at the restoration limit", () => {
    let state = createInitialShellNavigationState();
    for (let index = 0; index < 25; index += 1) {
      state = shellNavigationReducer(state, {
        type: "navigate",
        location: {
          route: "activity/alert-preview",
          eventId: `event:${index}`,
        },
      });
    }
    expect(state.histories.activity.trail).toHaveLength(20);
    expect(
      restoreShellNavigationState(serializeShellNavigationState(state)).kind,
    ).toBe("restored");
  });

  it("fails closed on corrupt, unsupported, and non-allowlisted restoration", () => {
    expect(restoreShellNavigationState("not-json")).toMatchObject({
      kind: "fallback",
      reason: "corrupt",
      state: { activeDestination: "search" },
    });
    expect(
      restoreShellNavigationState(
        JSON.stringify({
          version: 2,
          activeDestination: "more",
          histories: {},
        }),
      ),
    ).toMatchObject({ kind: "fallback", reason: "unsupported" });
    expect(
      restoreShellNavigationState(
        JSON.stringify({
          version: 1,
          activeDestination: "watch",
          histories: {
            search: [],
            following: [],
            watch: [{ route: "https://example.com" }],
            activity: [],
            more: [],
          },
        }),
      ),
    ).toMatchObject({ kind: "fallback", reason: "corrupt" });
    expect(
      restoreShellNavigationState(
        JSON.stringify({
          version: 1,
          activeDestination: "activity",
          histories: {
            search: [],
            following: [],
            watch: [],
            activity: [
              { route: "activity/alert-preview", eventId: "unsafe/id" },
            ],
            more: [],
          },
        }),
      ),
    ).toMatchObject({ kind: "fallback", reason: "corrupt" });
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

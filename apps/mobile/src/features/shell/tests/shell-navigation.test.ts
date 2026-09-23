import { describe, expect, it } from "vitest";

import { mobileSizing } from "@mobile/design/tokens";
import {
  bottomNavigationSafeInset,
  canNavigateBack,
  createInitialShellNavigationState,
  getActiveShellLocation,
  getActiveShellRoute,
  getShellNavigationPlacement,
  MORE_ROUTE_IDS,
  resolveShellHeaderCopy,
  restoreShellNavigationState,
  SHELL_DESTINATIONS,
  SHELL_ROUTES,
  serializeShellNavigationState,
  shellNavigationReducer,
} from "@mobile/features/shell/domain/shell-navigation";

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

  it("uses the system bottom inset without inventing extra padding", () => {
    expect(bottomNavigationSafeInset(0)).toBe(0);
    expect(bottomNavigationSafeInset(24)).toBe(24);
    expect(bottomNavigationSafeInset(48)).toBe(48);
    expect(bottomNavigationSafeInset(64)).toBe(64);
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

  it("preserves other destination trails while a main button returns to that tab's root", () => {
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

    expect(getActiveShellRoute(state).id).toBe("search");
    expect(state.histories.search.trail).toEqual([]);
    expect(state.histories.more.trail).toEqual([{ route: "more/settings" }]);
    expect(canNavigateBack(state)).toBe(false);
  });

  it("opens the More menu from a nested More page or another destination", () => {
    let state = createInitialShellNavigationState();
    state = shellNavigationReducer(state, {
      type: "navigate",
      location: { route: "more/history" },
    });
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
      type: "select",
      destination: "more",
    });
    expect(getActiveShellRoute(state).id).toBe("more");
    expect(state.histories.more.trail).toEqual([]);
    expect(state.histories.watch.trail).toHaveLength(1);

    state = shellNavigationReducer(state, {
      type: "navigate",
      location: { route: "more/history" },
    });
    state = shellNavigationReducer(state, {
      type: "select",
      destination: "more",
    });
    expect(getActiveShellRoute(state).id).toBe("more");
    expect(state.histories.more.trail).toEqual([]);
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

  it("keeps Guest Follow management inside Following", () => {
    let state = createInitialShellNavigationState();
    state = shellNavigationReducer(state, {
      type: "select",
      destination: "following",
    });
    state = shellNavigationReducer(state, {
      type: "navigate",
      location: { route: "following/manage" },
    });
    expect(getActiveShellRoute(state).id).toBe("following/manage");
    expect(canNavigateBack(state)).toBe(true);
    const restored = restoreShellNavigationState(
      serializeShellNavigationState(state),
    );
    expect(restored.kind).toBe("restored");
    expect(getActiveShellLocation(restored.state).route).toBe(
      "following/manage",
    );
  });

  it("replaces a Watch session tip so Watch now opens the new live target", () => {
    let state = createInitialShellNavigationState();
    state = shellNavigationReducer(state, {
      type: "navigate",
      location: {
        route: "watch/session-preview",
        target: { kind: "preview" },
      },
    });
    state = shellNavigationReducer(state, {
      type: "navigate",
      location: {
        route: "watch/session-preview",
        target: {
          kind: "channel",
          platform: "twitch",
          channelId: "123",
          channelLogin: "tumblurr",
        },
      },
    });
    expect(getActiveShellLocation(state)).toEqual({
      route: "watch/session-preview",
      target: {
        kind: "channel",
        platform: "twitch",
        channelId: "123",
        channelLogin: "tumblurr",
      },
    });
    expect(state.histories.watch.trail).toHaveLength(1);

    state = shellNavigationReducer(state, {
      type: "navigate",
      location: {
        route: "watch/session-preview",
        target: {
          kind: "channel",
          platform: "twitch",
          channelId: "456",
          channelLogin: "pokimane",
        },
      },
    });
    expect(getActiveShellLocation(state)).toMatchObject({
      route: "watch/session-preview",
      target: { channelLogin: "pokimane" },
    });
    expect(state.histories.watch.trail).toHaveLength(1);
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

  it("restores a More channel location without adding it to the More menu", () => {
    const state = createInitialShellNavigationState();
    const opened = shellNavigationReducer(state, {
      type: "navigate",
      location: {
        channel: { id: "c1", platform: "twitch", username: "alice" },
        route: "more/channel",
      },
    });
    expect(getActiveShellLocation(opened)).toEqual({
      channel: { id: "c1", platform: "twitch", username: "alice" },
      route: "more/channel",
    });
    const restored = restoreShellNavigationState(
      serializeShellNavigationState(opened),
    );
    expect(restored).toMatchObject({
      kind: "restored",
      state: {
        histories: {
          more: {
            trail: [
              {
                channel: { id: "c1", platform: "twitch", username: "alice" },
                route: "more/channel",
              },
            ],
          },
        },
      },
    });
  });

  it("restores category detail including names with spaces", () => {
    let state = createInitialShellNavigationState();
    state = shellNavigationReducer(state, {
      type: "select",
      destination: "more",
    });
    state = shellNavigationReducer(state, {
      type: "navigate",
      location: { route: "more/categories" },
    });
    state = shellNavigationReducer(state, {
      type: "navigate",
      location: {
        category: {
          boxArtUrl: "https://example.com/box.png",
          id: "509658",
          name: "Just Chatting",
          otherId: "15",
          platform: "twitch",
        },
        route: "more/category-detail",
      },
    });
    const restored = restoreShellNavigationState(
      serializeShellNavigationState(state),
    );
    expect(restored.kind).toBe("restored");
    expect(getActiveShellLocation(restored.state)).toEqual({
      category: {
        boxArtUrl: "https://example.com/box.png",
        id: "509658",
        name: "Just Chatting",
        otherId: "15",
        platform: "twitch",
      },
      route: "more/category-detail",
    });
  });

  it("rejects category detail restoration when the name is empty", () => {
    expect(
      restoreShellNavigationState(
        JSON.stringify({
          version: 1,
          activeDestination: "more",
          histories: {
            search: [],
            following: [],
            watch: [],
            activity: [],
            more: [
              {
                category: {
                  boxArtUrl: "https://example.com/box.png",
                  id: "509658",
                  name: "",
                  platform: "twitch",
                },
                route: "more/category-detail",
              },
            ],
          },
        }),
      ),
    ).toMatchObject({ kind: "fallback", reason: "corrupt" });
  });

  it("keeps Categories on More cards while Accounts stay last without a Home entry", () => {
    expect(MORE_ROUTE_IDS).toEqual([
      "more/multistream",
      "more/categories",
      "more/history",
      "more/downloads",
      "more/moderation",
      "more/settings",
      "more/diagnostics",
      "more/accounts",
    ]);
    expect(MORE_ROUTE_IDS.includes("more/categories")).toBe(true);
    expect(MORE_ROUTE_IDS.includes("more/home" as never)).toBe(false);
  });
});

describe("resolveShellHeaderCopy", () => {
  it("labels live, video, and clip watch sessions by content type", () => {
    const route = SHELL_ROUTES["watch/session-preview"];
    expect(
      resolveShellHeaderCopy(
        {
          route: "watch/session-preview",
          target: {
            kind: "channel",
            platform: "twitch",
            channelId: "channel-1",
            channelLogin: "proofstreamer",
          },
        },
        route,
      ),
    ).toEqual({ eyebrow: "LIVE", title: "proofstreamer" });
    expect(
      resolveShellHeaderCopy(
        {
          route: "watch/session-preview",
          target: {
            kind: "channel",
            platform: "twitch",
            channelId: "channel-1",
            channelLogin: "proofstreamer",
            media: {
              durationSeconds: 90,
              id: "clip-1",
              kind: "clip",
              title: "Huge play",
            },
          },
        },
        route,
      ),
    ).toEqual({ eyebrow: "CLIP", title: "Huge play" });
    expect(
      resolveShellHeaderCopy(
        {
          route: "watch/session-preview",
          target: {
            kind: "channel",
            platform: "kick",
            channelId: "channel-2",
            channelLogin: "kickstreamer",
            media: {
              durationSeconds: 3600,
              id: "video-1",
              kind: "video",
              title: "Yesterday VOD",
            },
          },
        },
        route,
      ),
    ).toEqual({ eyebrow: "VIDEO", title: "Yesterday VOD" });
  });

  it("falls back to Watch for empty session preview and keeps category names", () => {
    expect(SHELL_ROUTES["watch/session-preview"].title).toBe("Watch");
    expect(
      resolveShellHeaderCopy(
        { route: "watch/session-preview", target: { kind: "preview" } },
        SHELL_ROUTES["watch/session-preview"],
      ),
    ).toEqual({ eyebrow: "WATCH", title: "Watch" });
    expect(
      resolveShellHeaderCopy(
        {
          route: "more/category-detail",
          category: {
            boxArtUrl: "https://example.com/box.png",
            id: "509658",
            name: "Just Chatting",
            platform: "twitch",
          },
        },
        SHELL_ROUTES["more/category-detail"],
      ),
    ).toEqual({ eyebrow: "CATEGORIES", title: "Just Chatting" });
  });
});

import { describe, expect, it } from "vitest";

import {
  canDockWidget,
  defaultLayout,
  dockAtWorkspaceEdge,
  dockWidget,
  layoutRects,
  parseLayout,
  removeWidget,
  resizeSplit,
  type DockNode,
  widgetIds,
} from "@/features/moderation/components/screens/Mod/channel/workspace/dock-layout";

// Guards: widget moves collapse old splits and preserve one visible leaf per widget.
// Guards: persisted layouts cannot remove required media/chat or introduce malformed geometry.
// Guards: Mod Actions can move only left or right of the pinned platform widget.
describe("dock layout", () => {
  const twitch = defaultLayout("twitch");
  const twitchWidgets = ["video", "chat", "mod-log", "automod"] as const;

  it("creates platform defaults with the correct pinned lower pair and full-height right chat", () => {
    expect(widgetIds(twitch.root)).toEqual(["video", "mod-log", "automod", "chat"]);
    expect(twitch.root).toMatchObject({
      kind: "split",
      axis: "row",
      ratio: 0.74,
      first: {
        kind: "split",
        axis: "column",
        second: {
          kind: "split",
          axis: "row",
          first: { kind: "leaf", id: "mod-log" },
          second: { kind: "leaf", id: "automod" },
        },
      },
      second: { kind: "leaf", id: "chat" },
    });
    expect(defaultLayout("kick").root).toMatchObject({
      first: {
        second: {
          kind: "split",
          axis: "row",
          first: { id: "mod-log" },
          second: { id: "retention" },
        },
      },
      second: { id: "chat" },
    });
  });

  it("docks a visible widget at the target edge after collapsing its old split", () => {
    const moved = dockWidget(twitch.root, "chat", "video", "top");
    expect(widgetIds(moved)).toEqual(["chat", "video", "mod-log", "automod"]);
    expect(moved).toMatchObject({
      kind: "split",
      axis: "column",
      first: {
        kind: "split",
        axis: "column",
        first: { id: "chat" },
        second: { id: "video" },
      },
    });
  });

  it("docks a hidden source and rejects self-docking without duplicate leaves", () => {
    const hidden = removeWidget(twitch.root, "mod-log");
    if (!hidden) throw new Error("Removing Mod Actions unexpectedly emptied the layout");
    expect(widgetIds(hidden)).toEqual(["video", "automod", "chat"]);
    const restored = dockWidget(hidden, "mod-log", "automod", "left");
    expect(widgetIds(restored)).toEqual(["video", "mod-log", "automod", "chat"]);
    expect(dockWidget(restored, "chat", "chat", "left")).toEqual(restored);
  });

  it("allows Mod Actions only beside a pinned anchor and keeps pinned widgets fixed", () => {
    expect(canDockWidget("mod-log", "automod", "left")).toBe(true);
    expect(canDockWidget("mod-log", "retention", "right")).toBe(true);
    expect(canDockWidget("mod-log", "automod", "top")).toBe(false);
    expect(canDockWidget("mod-log", "automod", "bottom")).toBe(false);
    expect(canDockWidget("mod-log", "workspace", "left")).toBe(false);
    expect(canDockWidget("mod-log", "video", "right")).toBe(false);
    expect(canDockWidget("automod", "mod-log", "left")).toBe(false);
    expect(canDockWidget("retention", "mod-log", "right")).toBe(false);
    expect(canDockWidget("video", "workspace", "top")).toBe(true);
    expect(canDockWidget("chat", "workspace", "right")).toBe(true);
  });

  it("docks Chat at the right workspace edge as a full-height root leaf", () => {
    const moved = dockAtWorkspaceEdge(twitch.root, "chat", "right");
    expect(moved).toMatchObject({
      kind: "split",
      axis: "row",
      ratio: 0.74,
      second: { kind: "leaf", id: "chat" },
    });
    const chat = layoutRects(moved, 1000, 600).widgets.find((widget) => widget.id === "chat");
    expect(chat).toMatchObject({ x: 742.08, y: 0, height: 600 });
    expect(chat?.width).toBeCloseTo(257.92);
    expect(dockAtWorkspaceEdge(twitch.root, "mod-log", "right")).toBe(twitch.root);
  });

  it("resizes only the split addressed by its stable path and clamps ratios", () => {
    const resized = resizeSplit(twitch.root, ["first", "second"], 0.99);
    expect(resized.kind === "split" && resized.ratio).toBe(0.74);
    const lower =
      resized.kind === "split" && resized.first.kind === "split" ? resized.first.second : null;
    expect(lower).toMatchObject({ kind: "split", ratio: 0.8 });
    expect(resizeSplit(twitch.root, ["first", "second"], 0.01)).toMatchObject({
      first: { second: { ratio: 0.2 } },
    });
  });

  it("returns flat widget and centered split geometry with no gap overlap", () => {
    const geometry = layoutRects(twitch.root, 1000, 600, 8);
    const chat = geometry.widgets.find((widget) => widget.id === "chat");
    const video = geometry.widgets.find((widget) => widget.id === "video");
    const rootSplit = geometry.splits.find((split) => split.path.length === 0);
    expect(chat).toMatchObject({ x: 742.08, height: 600 });
    expect(chat?.width).toBeCloseTo(257.92);
    expect(video).toMatchObject({ x: 0, y: 0, width: 734.08, height: 384.8 });
    expect(rootSplit).toMatchObject({ x: 734.08, width: 8, height: 600, bounds: { width: 1000 } });
    expect(geometry.widgets).toHaveLength(4);
    expect(geometry.splits).toHaveLength(3);
  });

  it("rejects malformed, duplicate, over-deep, and mandatory-media-missing persisted layouts", () => {
    const fallback = defaultLayout("twitch");
    expect(parseLayout({ version: 1, locked: false, root: null }, twitchWidgets, fallback)).toEqual(
      fallback
    );
    expect(
      parseLayout(
        {
          version: 1,
          locked: false,
          root: { kind: "split", axis: "diagonal", ratio: 0.5, first: {}, second: {} },
        },
        twitchWidgets,
        fallback
      )
    ).toEqual(fallback);
    expect(
      parseLayout(
        { version: 1, locked: false, root: { kind: "leaf", id: "video" } },
        twitchWidgets,
        fallback
      )
    ).toEqual(fallback);
    expect(
      parseLayout(
        {
          version: 1,
          locked: true,
          root: {
            kind: "split",
            axis: "row",
            ratio: 2,
            first: { kind: "leaf", id: "video" },
            second: { kind: "leaf", id: "video" },
          },
        },
        twitchWidgets,
        fallback
      )
    ).toEqual(fallback);
    let deep: DockNode = { kind: "leaf", id: "video" };
    for (let index = 0; index < 13; index += 1) {
      deep = {
        kind: "split",
        axis: "row",
        ratio: 0.5,
        first: deep,
        second: { kind: "leaf", id: "chat" },
      };
    }
    expect(parseLayout({ version: 1, locked: false, root: deep }, twitchWidgets, fallback)).toEqual(
      fallback
    );
  });

  it("drops unavailable persisted leaves and clamps valid persisted ratios", () => {
    const parsed = parseLayout(
      {
        version: 1,
        locked: true,
        root: {
          kind: "split",
          axis: "row",
          ratio: 0.99,
          first: { kind: "leaf", id: "video" },
          second: {
            kind: "split",
            axis: "column",
            ratio: 0.01,
            first: { kind: "leaf", id: "chat" },
            second: { kind: "leaf", id: "engagement" },
          },
        },
      },
      ["video", "chat"],
      twitch
    );
    expect(parsed).toEqual({
      version: 1,
      locked: true,
      root: {
        kind: "split",
        axis: "row",
        ratio: 0.8,
        first: { kind: "leaf", id: "video" },
        second: { kind: "leaf", id: "chat" },
      },
    });
  });

  it("resets a persisted vertical Mod Actions pair to the safe platform default", () => {
    const invalidVerticalPair = {
      version: 1,
      locked: true,
      root: {
        kind: "split",
        axis: "row",
        ratio: 0.74,
        first: {
          kind: "split",
          axis: "column",
          ratio: 0.65,
          first: { kind: "leaf", id: "video" },
          second: {
            kind: "split",
            axis: "column",
            ratio: 0.5,
            first: { kind: "leaf", id: "mod-log" },
            second: { kind: "leaf", id: "automod" },
          },
        },
        second: { kind: "leaf", id: "chat" },
      },
    };

    expect(parseLayout(invalidVerticalPair, twitchWidgets, twitch)).toEqual(twitch);
  });
});

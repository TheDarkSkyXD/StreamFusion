export type WidgetId =
  | "video"
  | "chat"
  | "mod-log"
  | "retention"
  | "banned-users"
  | "unban-requests"
  | "automod"
  | "moderators"
  | "vips"
  | "engagement"
  | "channel-tools"
  | "activity"
  | "suspicious"
  | "community"
  | "whispers"
  | "rewards"
  | "channels"
  | "native-tools";

export type DockEdge = "left" | "right" | "top" | "bottom";

export type DockNode =
  | { kind: "leaf"; id: WidgetId }
  | {
      kind: "split";
      axis: "row" | "column";
      ratio: number;
      first: DockNode;
      second: DockNode;
    };

export interface DockLayout {
  version: 1;
  root: DockNode;
  locked: boolean;
}

export interface DockRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DockLayoutRects {
  widgets: Array<{ id: WidgetId } & DockRect>;
  splits: Array<
    {
      path: Array<"first" | "second">;
      axis: "row" | "column";
      ratio: number;
      bounds: DockRect;
    } & DockRect
  >;
}

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;
const MAX_DEPTH = 12;
const mandatoryWidgets: readonly WidgetId[] = ["video", "chat"];

function clampRatio(value: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function includesWidget(root: DockNode, id: WidgetId): boolean {
  return root.kind === "leaf"
    ? root.id === id
    : includesWidget(root.first, id) || includesWidget(root.second, id);
}

export function defaultLayout(platform: "twitch" | "kick"): DockLayout {
  const lowerWidget: WidgetId = platform === "twitch" ? "automod" : "retention";
  return {
    version: 1,
    locked: false,
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
          axis: "row",
          ratio: 0.5,
          first: { kind: "leaf", id: "mod-log" },
          second: { kind: "leaf", id: lowerWidget },
        },
      },
      second: { kind: "leaf", id: "chat" },
    },
  };
}

export function widgetIds(root: DockNode): WidgetId[] {
  return root.kind === "leaf" ? [root.id] : [...widgetIds(root.first), ...widgetIds(root.second)];
}

export function removeWidget(root: DockNode, id: WidgetId): DockNode | null {
  if (root.kind === "leaf") return root.id === id ? null : root;
  const first = removeWidget(root.first, id);
  const second = removeWidget(root.second, id);
  if (first === null) return second;
  if (second === null) return first;
  if (first === root.first && second === root.second) return root;
  return { ...root, first, second };
}

function replaceTarget(root: DockNode, target: WidgetId, replacement: DockNode): DockNode | null {
  if (root.kind === "leaf") return root.id === target ? replacement : null;
  const first = replaceTarget(root.first, target, replacement);
  if (first) return { ...root, first };
  const second = replaceTarget(root.second, target, replacement);
  return second ? { ...root, second } : null;
}

export function dockWidget(
  root: DockNode,
  source: WidgetId,
  target: WidgetId,
  edge: DockEdge
): DockNode {
  if (source === target) return root;
  const withoutSource = removeWidget(root, source) ?? { kind: "leaf", id: source };
  if (!includesWidget(withoutSource, target)) return root;
  const sourceLeaf: DockNode = { kind: "leaf", id: source };
  const targetLeaf: DockNode = { kind: "leaf", id: target };
  const first = edge === "left" || edge === "top" ? sourceLeaf : targetLeaf;
  const second = edge === "left" || edge === "top" ? targetLeaf : sourceLeaf;
  const replacement: DockNode = {
    kind: "split",
    axis: edge === "left" || edge === "right" ? "row" : "column",
    ratio: 0.5,
    first,
    second,
  };
  return replaceTarget(withoutSource, target, replacement) ?? root;
}

export function isPinnedWidget(id: WidgetId): boolean {
  return id === "automod" || id === "retention";
}

export function canDockWidget(
  source: WidgetId,
  target: WidgetId | "workspace",
  edge: DockEdge
): boolean {
  if (isPinnedWidget(source) || source === target) return false;
  if (source === "mod-log")
    return (
      target !== "workspace" && isPinnedWidget(target) && (edge === "left" || edge === "right")
    );
  return target === "workspace" || (!isPinnedWidget(target) && target !== "mod-log");
}

export function findUsableDockInsertion(
  root: DockNode,
  source: WidgetId,
  width: number,
  height: number
): DockNode | null {
  if (widgetIds(root).includes(source) || width <= 0 || height <= 0) return null;
  const before = layoutRects(root, width, height).widgets;
  const targets = [...before].sort((a, b) => b.width * b.height - a.width * a.height);
  for (const target of targets) {
    if (target.id === "chat") continue;
    const insertionEdges: readonly DockEdge[] =
      source === "mod-log" ? ["left", "right"] : ["right", "bottom"];
    for (const edge of insertionEdges) {
      if (!canDockWidget(source, target.id, edge)) continue;
      const next = dockWidget(root, source, target.id, edge);
      // Narrow workspaces stack full-width, 360px-tall cards instead of split rectangles.
      if (width < 720) return next;
      const after = layoutRects(next, width, height).widgets;
      const added = after.find((rect) => rect.id === source);
      if (!added || added.width < 240 || added.height < 180) continue;
      if (
        before.every((previous) => {
          const current = after.find((rect) => rect.id === previous.id);
          return (
            current &&
            current.width >= Math.min(240, previous.width) &&
            current.height >= Math.min(180, previous.height)
          );
        })
      )
        return next;
    }
  }
  return null;
}

export function dockAtWorkspaceEdge(root: DockNode, source: WidgetId, edge: DockEdge): DockNode {
  if (!canDockWidget(source, "workspace", edge)) return root;
  const remaining = removeWidget(root, source);
  if (!remaining) return root;
  const before = edge === "left" || edge === "top";
  const leaf: DockNode = { kind: "leaf", id: source };
  return {
    kind: "split",
    axis: edge === "left" || edge === "right" ? "row" : "column",
    ratio: edge === "left" ? 0.26 : edge === "right" ? 0.74 : 0.5,
    first: before ? leaf : remaining,
    second: before ? remaining : leaf,
  };
}

export function resizeSplit(
  root: DockNode,
  path: readonly ("first" | "second")[],
  ratio: number
): DockNode {
  if (path.length === 0) {
    if (root.kind === "leaf") return root;
    const nextRatio = clampRatio(ratio);
    return root.ratio === nextRatio ? root : { ...root, ratio: nextRatio };
  }
  if (root.kind === "leaf") return root;
  const [step, ...rest] = path;
  const child = step === "first" ? root.first : root.second;
  const nextChild = resizeSplit(child, rest, ratio);
  if (child === nextChild) return root;
  return step === "first" ? { ...root, first: nextChild } : { ...root, second: nextChild };
}

function parseNode(
  value: unknown,
  available: readonly WidgetId[],
  seen: Set<WidgetId>,
  depth: number
): DockNode | null | undefined {
  if (!isRecord(value) || depth > MAX_DEPTH) return undefined;
  if (value.kind === "leaf") {
    if (typeof value.id !== "string") return undefined;
    const id = available.find((candidate) => candidate === value.id);
    if (!id) return null;
    if (seen.has(id)) return undefined;
    seen.add(id);
    return { kind: "leaf", id };
  }
  if (value.kind !== "split" || (value.axis !== "row" && value.axis !== "column")) {
    return undefined;
  }
  if (typeof value.ratio !== "number" || !Number.isFinite(value.ratio)) return undefined;
  const first = parseNode(value.first, available, seen, depth + 1);
  const second = parseNode(value.second, available, seen, depth + 1);
  if (first === undefined || second === undefined) return undefined;
  if (first === null) return second;
  if (second === null) return first;
  return { kind: "split", axis: value.axis, ratio: clampRatio(value.ratio), first, second };
}

function normalizedFallback(fallback: DockLayout, available: readonly WidgetId[]): DockLayout {
  const root = parseNode(fallback.root, available, new Set<WidgetId>(), 0);
  if (!root) {
    throw new Error("Dock layout fallback must include an available root");
  }
  return { version: 1, locked: fallback.locked, root };
}

function hasModActionsPair(root: DockNode, anchor: WidgetId): boolean {
  if (root.kind === "leaf") return false;
  if (root.axis === "row" && root.first.kind === "leaf" && root.second.kind === "leaf") {
    const ids = [root.first.id, root.second.id];
    if (ids.includes("mod-log") && ids.includes(anchor)) return true;
  }
  return hasModActionsPair(root.first, anchor) || hasModActionsPair(root.second, anchor);
}

export function parseLayout(
  value: unknown,
  available: readonly WidgetId[],
  fallback: DockLayout
): DockLayout {
  const safeFallback = normalizedFallback(fallback, available);
  if (!isRecord(value) || value.version !== 1 || typeof value.locked !== "boolean") {
    return safeFallback;
  }
  const root = parseNode(value.root, available, new Set<WidgetId>(), 0);
  const anchor: WidgetId = available.includes("automod") ? "automod" : "retention";
  if (
    !root ||
    [...mandatoryWidgets, anchor].some((id) => available.includes(id) && !includesWidget(root, id))
  ) {
    return safeFallback;
  }
  if (
    available.includes(anchor) &&
    includesWidget(root, "mod-log") &&
    !hasModActionsPair(root, anchor)
  ) {
    return safeFallback;
  }
  return { version: 1, root, locked: value.locked };
}

export function layoutRects(
  root: DockNode,
  width: number,
  height: number,
  gap = 8
): DockLayoutRects {
  const widgets: DockLayoutRects["widgets"] = [];
  const splits: DockLayoutRects["splits"] = [];
  const visit = (node: DockNode, bounds: DockRect, path: Array<"first" | "second">): void => {
    if (node.kind === "leaf") {
      widgets.push({ id: node.id, ...bounds });
      return;
    }
    if (node.axis === "row") {
      const usable = Math.max(0, bounds.width - gap);
      const firstWidth = usable * node.ratio;
      splits.push({
        path,
        axis: node.axis,
        ratio: node.ratio,
        x: bounds.x + firstWidth,
        y: bounds.y,
        width: Math.min(gap, bounds.width),
        height: bounds.height,
        bounds,
      });
      visit(node.first, { x: bounds.x, y: bounds.y, width: firstWidth, height: bounds.height }, [
        ...path,
        "first",
      ]);
      visit(
        node.second,
        {
          x: bounds.x + firstWidth + gap,
          y: bounds.y,
          width: usable - firstWidth,
          height: bounds.height,
        },
        [...path, "second"]
      );
      return;
    }
    const usable = Math.max(0, bounds.height - gap);
    const firstHeight = usable * node.ratio;
    splits.push({
      path,
      axis: node.axis,
      ratio: node.ratio,
      x: bounds.x,
      y: bounds.y + firstHeight,
      width: bounds.width,
      height: Math.min(gap, bounds.height),
      bounds,
    });
    visit(node.first, { x: bounds.x, y: bounds.y, width: bounds.width, height: firstHeight }, [
      ...path,
      "first",
    ]);
    visit(
      node.second,
      {
        x: bounds.x,
        y: bounds.y + firstHeight + gap,
        width: bounds.width,
        height: usable - firstHeight,
      },
      [...path, "second"]
    );
  };
  visit(root, { x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) }, []);
  return { widgets, splits };
}

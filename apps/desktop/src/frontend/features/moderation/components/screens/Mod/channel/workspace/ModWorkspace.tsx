import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  GripVertical,
  LockKeyhole,
  UnlockKeyhole,
  RotateCcw,
  MoreHorizontal,
  X,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  defaultLayout,
  canDockWidget,
  dockAtWorkspaceEdge,
  isPinnedWidget,
  dockWidget,
  layoutRects,
  parseLayout,
  removeWidget,
  resizeSplit,
  widgetIds,
  findUsableDockInsertion,
} from "./dock-layout";
import type { DockEdge, DockLayout, DockNode, WidgetId } from "./dock-layout";
import "./mod-workspace.css";

export interface ModWidget {
  id: WidgetId;
  title: string;
  icon: ReactNode;
  content: ReactNode;
}

interface ModWorkspaceProps {
  platform: "twitch" | "kick";
  storageKey: string;
  widgets: readonly ModWidget[];
}

const edges: readonly DockEdge[] = ["left", "right", "top", "bottom"];
const previews: Record<DockEdge, CSSProperties> = {
  left: { inset: "0 50% 0 0" },
  right: { inset: "0 0 0 50%" },
  top: { inset: "0 0 50% 0" },
  bottom: { inset: "50% 0 0 0" },
};

function loadLayout(
  storageKey: string,
  platform: "twitch" | "kick",
  widgets: readonly ModWidget[]
) {
  const fallback = parseLayout(
    null,
    widgets.map((widget) => widget.id),
    defaultLayout(platform)
  );
  try {
    return parseLayout(
      JSON.parse(localStorage.getItem(storageKey) ?? "null"),
      widgets.map((w) => w.id),
      fallback
    );
  } catch {
    return fallback;
  }
}

type Split = ReturnType<typeof layoutRects>["splits"][number];
type DragTarget = { id: WidgetId | "workspace"; edge: DockEdge };

interface DragGesture {
  id: WidgetId;
  x: number;
  y: number;
  active: boolean;
  offsetX: number;
  offsetY: number;
  ghostWidth: number;
}

function dragTransform(gesture: DragGesture, point: { x: number; y: number }) {
  return `translate3d(${point.x - gesture.offsetX}px, ${point.y - gesture.offsetY}px, 0)`;
}

function DockSeparator({
  split,
  onPreview,
  onCommit,
  onCancel,
}: {
  split: Split;
  onPreview: (ratio: number) => void;
  onCommit: (ratio: number) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const drag = useRef<{ origin: number; ratio: number; latest: number } | null>(null);
  const frame = useRef<number | null>(null);
  const horizontal = split.axis === "row";
  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t("moderation.workspace.resize", { defaultValue: "Resize panels" })}
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(split.ratio * 100)}
      className={`mod-workspace-separator ${horizontal ? "vertical" : "horizontal"}`}
      style={{ left: split.x, top: split.y, width: split.width, height: split.height }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          origin: horizontal ? event.clientX : event.clientY,
          ratio: split.ratio,
          latest: split.ratio,
        };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const extent = (horizontal ? split.bounds.width : split.bounds.height) - 8;
        const delta = (horizontal ? event.clientX : event.clientY) - drag.current.origin;
        drag.current.latest = Math.max(
          0.2,
          Math.min(0.8, drag.current.ratio + delta / Math.max(1, extent))
        );
        if (frame.current === null)
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (drag.current) onPreview(drag.current.latest);
          });
      }}
      onPointerUp={(event) => {
        const active = drag.current;
        if (!active) return;
        cancelFrame();
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onCommit(active.latest);
      }}
      onPointerCancel={() => {
        cancelFrame();
        drag.current = null;
        onCancel();
      }}
      onKeyDown={(event) => {
        const decrease = horizontal ? "ArrowLeft" : "ArrowUp";
        const increase = horizontal ? "ArrowRight" : "ArrowDown";
        if (![decrease, increase, "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        onCommit(
          event.key === "Home"
            ? 0.2
            : event.key === "End"
              ? 0.8
              : split.ratio + (event.key === decrease ? -0.05 : 0.05)
        );
      }}
    />
  );
}

export function ModWorkspace({ platform, storageKey, widgets }: ModWorkspaceProps) {
  const { t } = useTranslation();
  const prefix = useId();
  const [layout, setLayout] = useState<DockLayout>(() => loadLayout(storageKey, platform, widgets));
  const [resizeRoot, setResizeRoot] = useState<DockNode | null>(null);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const [over, setOver] = useState<DragTarget | null>(null);
  const overRef = useRef<DragTarget | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [previewId, setPreviewId] = useState<WidgetId | null>(null);
  const dragGesture = useRef<DragGesture | null>(null);
  const dragGhost = useRef<HTMLDivElement>(null);
  const dragFrame = useRef<number | null>(null);
  const pendingDragPoint = useRef<{ x: number; y: number } | null>(null);
  const dragPoint = useRef<{ x: number; y: number } | null>(null);
  const pointerCapture = useRef<{ element: HTMLDivElement; pointerId: number } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const availableIds = useMemo(() => widgets.map((widget) => widget.id), [widgets]);
  useEffect(() => {
    setLayout((current) =>
      widgetIds(current.root).every((id) => availableIds.includes(id))
        ? current
        : parseLayout(current, availableIds, defaultLayout(platform))
    );
  }, [availableIds, platform]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const commit = (next: DockLayout) => {
    setLayout(next);
    setResizeRoot(null);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };
  const visible = widgetIds(layout.root);
  const previewWidget = widgets.find(
    (widget) => widget.id === previewId && !visible.includes(widget.id)
  );
  const previewInsertion = previewWidget
    ? findUsableDockInsertion(layout.root, previewWidget.id, size.width, size.height)
    : null;
  const closePreview = () => {
    const id = previewId;
    setPreviewId(null);
    if (id) document.getElementById(`${prefix}-dock-${id}`)?.focus();
  };
  const previewWidgetId = previewWidget?.id;
  useEffect(() => {
    if (!previewWidgetId) return;
    document.getElementById(`${prefix}-${previewWidgetId}`)?.focus();
  }, [previewWidgetId, prefix]);
  const narrow = size.width > 0 && size.width < 720;
  const root = resizeRoot ?? layout.root;
  const geometry = layoutRects(
    dragging ? (removeWidget(root, dragging) ?? root) : root,
    size.width,
    size.height
  );
  const originalGeometry = dragging ? layoutRects(root, size.width, size.height) : geometry;
  const geometryRef = useRef(geometry);
  useLayoutEffect(() => {
    geometryRef.current = geometry;
  }, [geometry]);
  const move = (source: WidgetId, target: WidgetId | "workspace", edge: DockEdge) => {
    if (!canDockWidget(source, target, edge)) return;
    commit({
      ...layout,
      root:
        target === "workspace"
          ? dockAtWorkspaceEdge(layout.root, source, edge)
          : dockWidget(layout.root, source, target, edge),
    });
    setDragging(null);
    overRef.current = null;
    setOver(null);
    const title = widgets.find((widget) => widget.id === source)?.title ?? source;
    setAnnouncement(t("moderation.workspace.moved", { defaultValue: "{{title}} moved", title }));
  };
  const cancelDragFrame = useCallback(() => {
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
    pendingDragPoint.current = null;
  }, []);
  const releaseDragCapture = useCallback(() => {
    const capture = pointerCapture.current;
    pointerCapture.current = null;
    if (!capture) return;
    try {
      capture.element.releasePointerCapture(capture.pointerId);
    } catch {
      // Pointer capture can already be released by the browser during cancellation.
    }
  }, []);
  const cancelDrag = useCallback(
    (releaseCapture = true) => {
      cancelDragFrame();
      if (releaseCapture) releaseDragCapture();
      dragGesture.current = null;
      dragPoint.current = null;
      setDragging(null);
      overRef.current = null;
      setOver(null);
    },
    [cancelDragFrame, releaseDragCapture]
  );
  const targetAt = (clientX: number, clientY: number, source: WidgetId) => {
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds) return null;
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) return null;
    const edgeDistances = [x, bounds.width - x, y, bounds.height - y];
    const outerDistance = Math.min(...edgeDistances);
    const outerEdge = edges[edgeDistances.indexOf(outerDistance)];
    if (outerDistance < 32 && canDockWidget(source, "workspace", outerEdge))
      return { id: "workspace" as const, edge: outerEdge };
    const target = geometryRef.current.widgets.find(
      (rect) =>
        rect.id !== source &&
        x >= rect.x &&
        y >= rect.y &&
        x <= rect.x + rect.width &&
        y <= rect.y + rect.height
    );
    if (!target) return null;
    const horizontal = (x - target.x) / target.width;
    const vertical = (y - target.y) / target.height;
    const closest = Math.min(horizontal, 1 - horizontal, vertical, 1 - vertical);
    const edge: DockEdge =
      closest === horizontal
        ? "left"
        : closest === 1 - horizontal
          ? "right"
          : closest === vertical
            ? "top"
            : "bottom";
    return canDockWidget(source, target.id, edge) ? { id: target.id, edge } : null;
  };
  const queueDragFrame = (clientX: number, clientY: number) => {
    pendingDragPoint.current = { x: clientX, y: clientY };
    if (dragFrame.current !== null) return;
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = null;
      const point = pendingDragPoint.current;
      pendingDragPoint.current = null;
      const gesture = dragGesture.current;
      if (!point || !gesture?.active) return;
      dragPoint.current = point;
      if (dragGhost.current) dragGhost.current.style.transform = dragTransform(gesture, point);
      const target = targetAt(point.x, point.y, gesture.id);
      if (overRef.current?.id === target?.id && overRef.current?.edge === target?.edge) return;
      overRef.current = target;
      setOver(target);
    });
  };
  useEffect(
    () => () => {
      cancelDragFrame();
      releaseDragCapture();
    },
    [cancelDragFrame, releaseDragCapture]
  );
  useEffect(() => {
    if (!dragging) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancelDrag();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [cancelDrag, dragging]);

  const draggedWidget = widgets.find((widget) => widget.id === dragging);

  return (
    <div
      className={`mod-workspace ${dragging ? "dragging" : ""}`}
      data-platform={platform}
      data-testid="mod-workspace"
    >
      <nav
        className="mod-workspace-dock"
        aria-label={t("moderation.workspace.tools", { defaultValue: "Moderation tools" })}
      >
        {widgets.map((widget) => (
          <button
            key={widget.id}
            id={`${prefix}-dock-${widget.id}`}
            type="button"
            className="mod-workspace-dock-button"
            aria-label={widget.title}
            title={widget.title}
            aria-pressed={visible.includes(widget.id) || previewId === widget.id}
            aria-controls={`${prefix}-${widget.id}`}
            onClick={() => {
              if (!visible.includes(widget.id)) {
                setPreviewId((current) => (current === widget.id ? null : widget.id));
                return;
              }
              setPreviewId(null);
              requestAnimationFrame(() =>
                document.getElementById(`${prefix}-${widget.id}`)?.focus()
              );
            }}
          >
            {widget.icon}
          </button>
        ))}
        <div className="mod-workspace-dock-spacer" />
        <button
          type="button"
          className="mod-workspace-dock-button"
          aria-pressed={layout.locked}
          aria-label={
            layout.locked
              ? t("moderation.workspace.unlock", { defaultValue: "Unlock layout" })
              : t("moderation.workspace.lock", { defaultValue: "Lock layout" })
          }
          title={
            layout.locked
              ? t("moderation.workspace.unlock", { defaultValue: "Unlock layout" })
              : t("moderation.workspace.lock", { defaultValue: "Lock layout" })
          }
          onClick={() => {
            cancelDrag();
            commit({ ...layout, locked: !layout.locked });
          }}
        >
          {layout.locked ? <LockKeyhole size={20} /> : <UnlockKeyhole size={20} />}
        </button>
        <button
          type="button"
          className="mod-workspace-dock-button"
          disabled={layout.locked}
          aria-label={t("moderation.workspace.reset", { defaultValue: "Reset layout" })}
          title={t("moderation.workspace.reset", { defaultValue: "Reset layout" })}
          onClick={() => {
            cancelDrag();
            setPreviewId(null);
            commit(
              parseLayout(
                null,
                widgets.map((widget) => widget.id),
                defaultLayout(platform)
              )
            );
          }}
        >
          <RotateCcw size={20} />
        </button>
      </nav>
      <div className="mod-workspace-main">
        {storageError && (
          <p role="status" className="px-3 py-1 text-xs text-amber-300">
            {t("moderation.workspace.storageError", {
              defaultValue: "Your layout works for this session, but could not be saved.",
            })}
          </p>
        )}
        <div
          ref={container}
          className={`mod-workspace-canvas ${narrow ? "narrow" : ""}`}
          onPointerMove={(event) => {
            const gesture = dragGesture.current;
            if (!gesture) return;
            if (!gesture.active) {
              if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6) return;
              gesture.active = true;
              setDragging(gesture.id);
            }
            queueDragFrame(event.clientX, event.clientY);
          }}
          onPointerUp={(event) => {
            const gesture = dragGesture.current;
            if (!gesture) return;
            cancelDragFrame();
            const target = gesture.active
              ? targetAt(event.clientX, event.clientY, gesture.id)
              : null;
            if (target) move(gesture.id, target.id, target.edge);
            cancelDrag();
          }}
          onPointerCancel={() => cancelDrag()}
          onLostPointerCapture={() => {
            pointerCapture.current = null;
            cancelDrag(false);
          }}
        >
          {widgets
            .filter((widget) => visible.includes(widget.id) || widget.id === previewWidget?.id)
            .map((widget) => {
              const isPreview = widget.id === previewWidget?.id;
              const rect =
                geometry.widgets.find((item) => item.id === widget.id) ??
                originalGeometry.widgets.find((item) => item.id === widget.id);
              const isDragged = dragging === widget.id;
              return (
                <section
                  key={widget.id}
                  id={`${prefix}-${widget.id}`}
                  tabIndex={-1}
                  aria-label={widget.title}
                  role={isPreview ? "dialog" : undefined}
                  onKeyDown={
                    isPreview
                      ? (event) => {
                          if (event.key === "Escape") {
                            event.stopPropagation();
                            closePreview();
                          }
                        }
                      : undefined
                  }
                  data-widget-id={widget.id}
                  className={`mod-workspace-widget${isPreview ? " mod-workspace-preview" : ""}`}
                  style={
                    isPreview
                      ? undefined
                      : narrow
                        ? { order: visible.indexOf(widget.id) }
                        : {
                            left: rect?.x,
                            top: rect?.y,
                            width: rect?.width,
                            height: rect?.height,
                            opacity: isDragged ? 0 : 1,
                            pointerEvents: isDragged ? "none" : undefined,
                          }
                  }
                >
                  <div className="mod-workspace-widget-header">
                    <div
                      className={`mod-workspace-widget-handle ${!isPreview && !layout.locked && !narrow && !isPinnedWidget(widget.id) ? "draggable" : ""}`}
                      data-drag-handle={
                        !isPreview && !layout.locked && !narrow && !isPinnedWidget(widget.id)
                          ? "true"
                          : undefined
                      }
                      onPointerDown={(event) => {
                        if (
                          layout.locked ||
                          isPreview ||
                          narrow ||
                          isPinnedWidget(widget.id) ||
                          event.button !== 0
                        )
                          return;
                        event.preventDefault();
                        const canvas = container.current;
                        canvas?.setPointerCapture(event.pointerId);
                        if (canvas)
                          pointerCapture.current = { element: canvas, pointerId: event.pointerId };
                        const bounds =
                          event.currentTarget.parentElement?.parentElement?.getBoundingClientRect() ?? {
                            left: event.clientX,
                            top: event.clientY,
                            width: 240,
                          };
                        const ghostWidth = Math.max(200, Math.min(320, bounds.width));
                        dragGesture.current = {
                          id: widget.id,
                          x: event.clientX,
                          y: event.clientY,
                          active: false,
                          offsetX: Math.max(
                            12,
                            Math.min(ghostWidth - 12, event.clientX - bounds.left)
                          ),
                          offsetY: Math.max(0, Math.min(40, event.clientY - bounds.top)),
                          ghostWidth,
                        };
                        dragPoint.current = { x: event.clientX, y: event.clientY };
                      }}
                    >
                      {widget.icon}
                      <h2>{widget.title}</h2>
                      {!isPreview && !layout.locked && !isPinnedWidget(widget.id) && (
                        <GripVertical size={14} className="mod-workspace-grip" />
                      )}
                    </div>
                    {isPreview && (
                      <button
                        type="button"
                        className="mod-workspace-icon-button"
                        aria-label={t("moderation.workspace.closePreview", { title: widget.title })}
                        onClick={closePreview}
                      >
                        <X size={16} />
                      </button>
                    )}
                    {!isPreview && !layout.locked && !isPinnedWidget(widget.id) && (
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                          <button
                            type="button"
                            className="mod-workspace-icon-button"
                            aria-label={t("moderation.workspace.options", {
                              defaultValue: "{{title}} panel options",
                              title: widget.title,
                            })}
                          >
                            <MoreHorizontal size={18} />
                          </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            className="mod-workspace-menu"
                            data-platform={platform}
                            align="end"
                            sideOffset={4}
                          >
                            {canDockWidget(widget.id, "workspace", "right") && (
                              <DropdownMenu.Sub>
                                <DropdownMenu.SubTrigger className="mod-workspace-menu-item">
                                  {t("moderation.workspace.workspaceEdge", {
                                    defaultValue: "Workspace edge",
                                  })}
                                </DropdownMenu.SubTrigger>
                                <DropdownMenu.Portal>
                                  <DropdownMenu.SubContent
                                    className="mod-workspace-menu"
                                    data-platform={platform}
                                  >
                                    {edges.map((edge) => (
                                      <DropdownMenu.Item
                                        key={edge}
                                        className="mod-workspace-menu-item"
                                        onSelect={() => move(widget.id, "workspace", edge)}
                                      >
                                        {t(`moderation.workspace.${edge}`, { defaultValue: edge })}
                                      </DropdownMenu.Item>
                                    ))}
                                  </DropdownMenu.SubContent>
                                </DropdownMenu.Portal>
                              </DropdownMenu.Sub>
                            )}
                            {widgets
                              .filter(
                                (target) =>
                                  visible.includes(target.id) &&
                                  edges.some((edge) => canDockWidget(widget.id, target.id, edge))
                              )
                              .map((target) => (
                                <DropdownMenu.Sub key={target.id}>
                                  <DropdownMenu.SubTrigger className="mod-workspace-menu-item">
                                    {t("moderation.workspace.moveBeside", {
                                      defaultValue: "Move beside {{title}}",
                                      title: target.title,
                                    })}
                                  </DropdownMenu.SubTrigger>
                                  <DropdownMenu.Portal>
                                    <DropdownMenu.SubContent
                                      className="mod-workspace-menu"
                                      data-platform={platform}
                                    >
                                      {edges
                                        .filter((edge) => canDockWidget(widget.id, target.id, edge))
                                        .map((edge) => (
                                          <DropdownMenu.Item
                                            key={edge}
                                            className="mod-workspace-menu-item"
                                            onSelect={() => move(widget.id, target.id, edge)}
                                          >
                                            {t(`moderation.workspace.${edge}`, {
                                              defaultValue: edge[0].toUpperCase() + edge.slice(1),
                                            })}
                                          </DropdownMenu.Item>
                                        ))}
                                    </DropdownMenu.SubContent>
                                  </DropdownMenu.Portal>
                                </DropdownMenu.Sub>
                              ))}
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    )}
                    {!isPreview &&
                      !layout.locked &&
                      widget.id !== "video" &&
                      widget.id !== "chat" &&
                      !isPinnedWidget(widget.id) && (
                        <button
                          type="button"
                          className="mod-workspace-icon-button"
                          aria-label={t("moderation.workspace.hide", {
                            defaultValue: "Hide {{title}}",
                            title: widget.title,
                          })}
                          onClick={() => {
                            const next = removeWidget(layout.root, widget.id);
                            if (next) commit({ ...layout, root: next });
                          }}
                        >
                          <X size={16} />
                        </button>
                      )}
                  </div>
                  <div
                    className={`mod-workspace-widget-body ${widget.id === "video" || widget.id === "chat" ? "live" : ""}`}
                  >
                    {widget.content}
                  </div>
                  {isPreview && (
                    <div className="mod-workspace-preview-actions">
                      <button
                        type="button"
                        disabled={layout.locked || !previewInsertion}
                        onClick={() => {
                          if (!layout.locked && previewInsertion) {
                            commit({ ...layout, root: previewInsertion });
                            setPreviewId(null);
                          }
                        }}
                      >
                        {t("moderation.workspace.addToWorkspace")}
                      </button>
                      {!layout.locked && !previewInsertion && (
                        <p role="status">{t("moderation.workspace.noRoom")}</p>
                      )}
                    </div>
                  )}
                  {dragging && !isDragged && (
                    <div className="mod-workspace-drop-target">
                      {over?.id === widget.id && (
                        <div className="mod-workspace-drop-preview" style={previews[over.edge]} />
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          {dragging && over?.id === "workspace" && (
            <div
              className="mod-workspace-drop-preview"
              style={{ ...previews[over.edge], zIndex: 30 }}
            />
          )}
          {!layout.locked &&
            !narrow &&
            !dragging &&
            geometry.splits.map((split) => (
              <DockSeparator
                key={split.path.join(".")}
                split={split}
                onPreview={(ratio) => setResizeRoot(resizeSplit(layout.root, split.path, ratio))}
                onCommit={(ratio) =>
                  commit({ ...layout, root: resizeSplit(layout.root, split.path, ratio) })
                }
                onCancel={() => setResizeRoot(null)}
              />
            ))}
        </div>
      </div>
      {dragging && dragGesture.current && (
        <div
          ref={dragGhost}
          className="mod-workspace-drag-ghost"
          data-testid="mod-workspace-drag-ghost"
          aria-hidden="true"
          style={{
            width: dragGesture.current.ghostWidth,
            transform: dragTransform(
              dragGesture.current,
              dragPoint.current ?? { x: dragGesture.current.x, y: dragGesture.current.y }
            ),
          }}
        >
          <span className="mod-workspace-drag-ghost-icon">{draggedWidget?.icon}</span>
          <span className="mod-workspace-drag-ghost-title">{draggedWidget?.title ?? dragging}</span>
          <GripVertical size={14} className="mod-workspace-grip" />
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

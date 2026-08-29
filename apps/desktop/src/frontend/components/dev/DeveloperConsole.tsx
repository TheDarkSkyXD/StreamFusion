import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { DEBUG_TOKENS } from "./tokens";
import { UiDebugTool } from "./UiDebugTool";

const ChatSimTool = lazy(() =>
  import("./ChatSimTool").then((module) => ({ default: module.ChatSimTool }))
);

function BugIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2l1.88 1.88" />
      <path d="M14.12 3.88L16 2" />
      <path d="M9 7.13v-1a3.003 3.003 0 116.005 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6z" />
      <path d="M12 20v-9" />
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
      <path d="M6 13H2" />
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
      <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
      <path d="M22 13h-4" />
      <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
    </svg>
  );
}

function DevToolsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function ShieldIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function DiagnosticsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </svg>
  );
}

function DragGrip() {
  const dot: React.CSSProperties = {
    width: 3,
    height: 3,
    borderRadius: "50%",
    background: DEBUG_TOKENS.textMuted,
  };
  return (
    <div
      aria-hidden="true"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 3px)",
        gridAutoRows: "3px",
        gap: 3,
        marginRight: 2,
      }}
    >
      <span style={dot} />
      <span style={dot} />
      <span style={dot} />
      <span style={dot} />
      <span style={dot} />
      <span style={dot} />
    </div>
  );
}

type DeveloperConsoleToolId = "chat-sim" | "ui";

interface DebugTool {
  id: DeveloperConsoleToolId;
  label: string;
  Component: React.ComponentType;
}

const TOOLS: DebugTool[] = [
  { id: "chat-sim", label: "Chat Sim", Component: ChatSimTool },
  { id: "ui", label: "UI", Component: UiDebugTool },
];

const STORAGE_KEY = "streamfusion-debug-panel";
const MIN_DRAG_PX = 5;
const CIRCLE_SIZE = 48;
const PANEL_WIDTH_HINT = 360;
const PANEL_HEIGHT_HINT = 440;

interface Position {
  x: number;
  y: number;
}

type DeveloperConsoleVisibility = "expanded" | "collapsed" | "hidden";

interface DeveloperConsoleLayoutState {
  position: Position;
  visibility: DeveloperConsoleVisibility;
  activeId: DeveloperConsoleToolId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parsePosition(value: unknown): Position | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  return isFiniteNumber(x) && isFiniteNumber(y) ? { x, y } : null;
}

function parseVisibility(state: Record<string, unknown>): DeveloperConsoleVisibility {
  if (
    state.visibility === "expanded" ||
    state.visibility === "collapsed" ||
    state.visibility === "hidden"
  ) {
    return state.visibility;
  }
  if (state.hidden === true) return "hidden";
  if (state.collapsed === true) return "collapsed";
  return "expanded";
}

function isDeveloperConsoleToolId(value: unknown): value is DeveloperConsoleToolId {
  return value === "chat-sim" || value === "ui";
}

function parseActiveId(value: unknown): DeveloperConsoleToolId {
  return isDeveloperConsoleToolId(value) ? value : TOOLS[0].id;
}

function parsePersisted(value: unknown): Partial<DeveloperConsoleLayoutState> | null {
  if (!isRecord(value)) return null;
  return {
    activeId: parseActiveId(value.activeId),
    position: parsePosition(value.position) ?? undefined,
    visibility: parseVisibility(value),
  };
}

function loadLocalPersisted(): Partial<DeveloperConsoleLayoutState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsePersisted(parsed);
  } catch {
    return null;
  }
}

function saveLocalPersisted(state: DeveloperConsoleLayoutState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeId: state.activeId,
        position: state.position,
        visibility: state.visibility,
      })
    );
  } catch {
    // localStorage may be unavailable / full; persistence is best-effort.
  }
}

function defaultPosition(): Position {
  return {
    x: Math.max(16, window.innerWidth - PANEL_WIDTH_HINT - 16),
    y: Math.max(16, window.innerHeight - PANEL_HEIGHT_HINT - 16),
  };
}

function clampPosition(p: Position, w: number, h: number): Position {
  const maxX = Math.max(0, window.innerWidth - w);
  const maxY = Math.max(0, window.innerHeight - h);
  return {
    x: Math.max(0, Math.min(maxX, p.x)),
    y: Math.max(0, Math.min(maxY, p.y)),
  };
}

export function DeveloperConsole() {
  if (!import.meta.env.DEV) return null;
  return <DeveloperConsoleImpl />;
}

function getWidgetSize(visibility: DeveloperConsoleVisibility): { width: number; height: number } {
  return visibility === "expanded"
    ? { width: PANEL_WIDTH_HINT, height: PANEL_HEIGHT_HINT }
    : { width: CIRCLE_SIZE, height: CIRCLE_SIZE };
}

function createInitialLayoutState(
  persisted: Partial<DeveloperConsoleLayoutState>
): DeveloperConsoleLayoutState {
  const visibility = persisted.visibility ?? "expanded";
  const { width, height } = getWidgetSize(visibility);
  return {
    activeId: persisted.activeId ?? TOOLS[0].id,
    position: clampPosition(persisted.position ?? defaultPosition(), width, height),
    visibility,
  };
}

function DeveloperConsoleImpl() {
  const [localPersisted] = useState(loadLocalPersisted);
  const durableStore = window.electronAPI?.store;
  const [layoutState, setLayoutState] = useState<DeveloperConsoleLayoutState>(() =>
    createInitialLayoutState(localPersisted ?? {})
  );
  const [hasLoadedDurableState, setHasLoadedDurableState] = useState(!durableStore);

  const layoutStateRef = useRef(layoutState);
  useLayoutEffect(() => {
    layoutStateRef.current = layoutState;
  }, [layoutState]);

  const saveDurablePersisted = useCallback((state: DeveloperConsoleLayoutState) => {
    const store = window.electronAPI?.store;
    if (!store) return;
    void store.set(STORAGE_KEY, state).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!durableStore) return;
    let isCurrent = true;

    void durableStore
      .get(STORAGE_KEY)
      .then((stored) => {
        if (!isCurrent) return;
        const durablePersisted = parsePersisted(stored);
        const next = createInitialLayoutState(durablePersisted ?? localPersisted ?? {});
        layoutStateRef.current = next;
        saveLocalPersisted(next);
        setLayoutState(next);
        setHasLoadedDurableState(true);
        if (durablePersisted === null && localPersisted !== null) {
          saveDurablePersisted(next);
        }
      })
      .catch(() => {
        if (isCurrent) setHasLoadedDurableState(true);
      });

    return () => {
      isCurrent = false;
    };
  }, [durableStore, localPersisted, saveDurablePersisted]);

  const commitLayoutState = useCallback(
    (
      update: (current: DeveloperConsoleLayoutState) => DeveloperConsoleLayoutState,
      persistDurably = true
    ) => {
      const next = update(layoutStateRef.current);
      layoutStateRef.current = next;
      saveLocalPersisted(next);
      if (persistDurably) saveDurablePersisted(next);
      setLayoutState(next);
    },
    [saveDurablePersisted]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        commitLayoutState((current) => ({
          ...current,
          visibility: current.visibility === "hidden" ? "expanded" : "hidden",
        }));
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [commitLayoutState]);

  useEffect(() => {
    const onResize = () => {
      commitLayoutState((current) => {
        const { width, height } = getWidgetSize(current.visibility);
        return { ...current, position: clampPosition(current.position, width, height) };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [commitLayoutState]);

  useEffect(() => {
    const { width, height } = getWidgetSize(layoutState.visibility);
    const clamped = clampPosition(layoutState.position, width, height);
    if (clamped.x === layoutState.position.x && clamped.y === layoutState.position.y) return;
    commitLayoutState((current) => ({ ...current, position: clamped }));
  }, [commitLayoutState, layoutState.position, layoutState.visibility]);

  const dragRef = useRef<{
    originX: number;
    originY: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
    onClick: () => void;
  } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (!drag.moved && Math.abs(dx) < MIN_DRAG_PX && Math.abs(dy) < MIN_DRAG_PX) return;
      drag.moved = true;
      commitLayoutState((current) => {
        const { width, height } = getWidgetSize(current.visibility);
        return {
          ...current,
          position: clampPosition({ x: drag.originX + dx, y: drag.originY + dy }, width, height),
        };
      }, false);
    };

    const onMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.moved) saveDurablePersisted(layoutStateRef.current);
      else drag.onClick();
      dragRef.current = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [commitLayoutState, saveDurablePersisted]);

  const startDrag = useCallback((e: React.MouseEvent, onClickIfNoMove: () => void) => {
    if (e.button !== 0) return;
    dragRef.current = {
      originX: layoutStateRef.current.position.x,
      originY: layoutStateRef.current.position.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      onClick: onClickIfNoMove,
    };
    e.preventDefault();
  }, []);

  if (!hasLoadedDurableState) return null;

  if (layoutState.visibility === "hidden") {
    return (
      <button
        type="button"
        onMouseDown={(e) =>
          startDrag(e, () => {
            commitLayoutState((current) => ({ ...current, visibility: "expanded" }));
          })
        }
        title="Show Developer Console"
        aria-label="Show Developer Console"
        style={{
          position: "fixed",
          left: layoutState.position.x,
          top: layoutState.position.y,
          width: CIRCLE_SIZE,
          height: CIRCLE_SIZE,
          borderRadius: "50%",
          background: DEBUG_TOKENS.surface,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          color: DEBUG_TOKENS.accent,
          border: `1px solid ${DEBUG_TOKENS.borderStrong}`,
          font: `18px/1 ${DEBUG_TOKENS.fontUi}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "grab",
          zIndex: 99999,
          padding: 0,
          boxShadow: DEBUG_TOKENS.shadow,
          userSelect: "none",
        }}
      >
        <BugIcon size={20} />
      </button>
    );
  }

  if (layoutState.visibility === "collapsed") {
    return (
      <button
        type="button"
        onMouseDown={(e) =>
          startDrag(e, () =>
            commitLayoutState((current) => ({ ...current, visibility: "expanded" }))
          )
        }
        title="Click to expand · drag to move (Ctrl+Shift+D to hide)"
        style={{
          position: "fixed",
          left: layoutState.position.x,
          top: layoutState.position.y,
          width: CIRCLE_SIZE,
          height: CIRCLE_SIZE,
          borderRadius: "50%",
          background: DEBUG_TOKENS.surface,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          color: DEBUG_TOKENS.accent,
          border: `1px solid ${DEBUG_TOKENS.borderStrong}`,
          font: `18px/1 ${DEBUG_TOKENS.fontUi}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "grab",
          zIndex: 99999,
          padding: 0,
          boxShadow: DEBUG_TOKENS.shadow,
          userSelect: "none",
        }}
      >
        <BugIcon size={20} />
      </button>
    );
  }

  const active = TOOLS.find((t) => t.id === layoutState.activeId) ?? TOOLS[0];
  const Active = active.Component;

  return (
    <div
      style={{
        position: "fixed",
        left: layoutState.position.x,
        top: layoutState.position.y,
        zIndex: 99999,
        background: DEBUG_TOKENS.surface,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        color: DEBUG_TOKENS.textPrimary,
        font: `13px/1.5 ${DEBUG_TOKENS.fontUi}`,
        borderRadius: 10,
        border: `1px solid ${DEBUG_TOKENS.border}`,
        boxShadow: DEBUG_TOKENS.shadow,
        width: PANEL_WIDTH_HINT,
        maxHeight: "75vh",
        overflowY: "auto",
        pointerEvents: "auto",
        userSelect: "none",
        scrollbarWidth: "thin",
        scrollbarColor: DEBUG_TOKENS.scrollbarThumb,
      }}
    >
      <div
        onMouseDown={(e) => startDrag(e, () => undefined)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderBottom: `1px solid ${DEBUG_TOKENS.border}`,
          cursor: "grab",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <DragGrip />
          <span style={{ display: "inline-flex", color: DEBUG_TOKENS.textSecondary }}>
            <BugIcon size={15} />
          </span>
          <strong style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.3 }}>
            Developer Console
          </strong>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              window.location.hash = "#/settings?tab=diagnostics";
            }}
            title="Open Diagnostics"
            aria-label="Open Diagnostics"
            style={{
              background: "transparent",
              color: DEBUG_TOKENS.accent,
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 10px",
              borderRadius: 6,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = DEBUG_TOKENS.surfaceRaised;
              e.currentTarget.style.color = DEBUG_TOKENS.textPrimary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = DEBUG_TOKENS.accent;
            }}
          >
            <DiagnosticsIcon size={18} />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              window.location.hash = "#/mod";
            }}
            title="Open /mod page (dev shortcut — the sidebar link is gated on moderating ≥1 channel)"
            aria-label="Open mod page"
            style={{
              background: "transparent",
              color: DEBUG_TOKENS.textSecondary,
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 10px",
              borderRadius: 6,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = DEBUG_TOKENS.surfaceRaised;
              e.currentTarget.style.color = DEBUG_TOKENS.textPrimary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = DEBUG_TOKENS.textSecondary;
            }}
          >
            <ShieldIcon size={18} />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => window.electronAPI?.toggleDevTools()}
            title="Toggle Chromium DevTools (F12)"
            aria-label="Toggle DevTools"
            style={{
              background: "transparent",
              color: DEBUG_TOKENS.textSecondary,
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 10px",
              borderRadius: 6,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = DEBUG_TOKENS.surfaceRaised;
              e.currentTarget.style.color = DEBUG_TOKENS.textPrimary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = DEBUG_TOKENS.textSecondary;
            }}
          >
            <DevToolsIcon size={18} />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() =>
              commitLayoutState((current) => ({ ...current, visibility: "collapsed" }))
            }
            title="Collapse to circle (Ctrl+Shift+D to fully hide)"
            aria-label="Collapse"
            style={{
              background: "transparent",
              color: DEBUG_TOKENS.textSecondary,
              border: "none",
              cursor: "pointer",
              fontSize: 28,
              fontWeight: 400,
              lineHeight: 1,
              padding: "2px 12px 8px",
              borderRadius: 6,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = DEBUG_TOKENS.dangerSoft;
              e.currentTarget.style.color = DEBUG_TOKENS.danger;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = DEBUG_TOKENS.textSecondary;
            }}
          >
            ×
          </button>
        </div>
      </div>
      <div
        role="tablist"
        style={{
          display: "flex",
          gap: 2,
          padding: 4,
          margin: "8px 10px",
          background: DEBUG_TOKENS.surfaceSubtle,
          borderRadius: 8,
        }}
      >
        {TOOLS.map((t) => {
          const isActive = t.id === layoutState.activeId;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => commitLayoutState((current) => ({ ...current, activeId: t.id }))}
              style={{
                flex: 1,
                background: isActive ? DEBUG_TOKENS.surfaceRaised : "transparent",
                color: isActive ? DEBUG_TOKENS.textPrimary : DEBUG_TOKENS.textSecondary,
                border: "none",
                padding: "6px 10px",
                cursor: "pointer",
                font: `12.5px/1.2 ${DEBUG_TOKENS.fontUi}`,
                fontWeight: isActive ? 600 : 500,
                borderRadius: 5,
                boxShadow: isActive ? "0 1px 2px rgba(0, 0, 0, 0.3)" : "none",
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = DEBUG_TOKENS.textPrimary;
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = DEBUG_TOKENS.textSecondary;
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ padding: "14px 16px" }}>
        <Suspense fallback={null}>
          <Active />
        </Suspense>
      </div>
    </div>
  );
}

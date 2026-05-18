/**
 * Dev-only debug panel. Hosts multiple tools (perf measurements, chat event
 * simulator, etc.) under one toggleable widget. Returns null in production.
 *
 * Interaction model:
 * - Drag the header (expanded) or the whole circle (collapsed) to reposition.
 * - Click × to collapse the panel into a 48px circle. Click the circle to
 *   expand back. Ctrl+Shift+D fully hides/shows the widget.
 * - Position + collapsed state persist in localStorage across reloads.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ChatSimTool } from "./ChatSimTool";
import { PerfTool } from "./PerfTool";
import { DEBUG_TOKENS } from "./tokens";

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

function DragGrip() {
  // Three vertical dots — a quiet "this is draggable" affordance.
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

interface DebugTool {
  id: string;
  label: string;
  Component: React.ComponentType;
}

const TOOLS: DebugTool[] = [
  { id: "perf", label: "Perf", Component: PerfTool },
  { id: "chat-sim", label: "Chat Sim", Component: ChatSimTool },
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

interface PersistedState {
  position?: Position;
  collapsed?: boolean;
  activeId?: string;
  hidden?: boolean;
}

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedState) : {};
  } catch {
    return {};
  }
}

function savePersisted(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

export function DebugPanel() {
  if (!import.meta.env.DEV) return null;
  return <DebugPanelImpl />;
}

function DebugPanelImpl() {
  const persisted = useRef<PersistedState>(loadPersisted()).current;

  const [hidden, setHidden] = useState<boolean>(persisted.hidden ?? false);
  const [collapsed, setCollapsed] = useState<boolean>(persisted.collapsed ?? false);
  const [activeId, setActiveId] = useState<string>(
    TOOLS.find((t) => t.id === persisted.activeId)?.id ?? TOOLS[0].id
  );
  const [position, setPosition] = useState<Position>(() => {
    const start = persisted.position ?? defaultPosition();
    const w = persisted.collapsed ? CIRCLE_SIZE : PANEL_WIDTH_HINT;
    const h = persisted.collapsed ? CIRCLE_SIZE : PANEL_HEIGHT_HINT;
    return clampPosition(start, w, h);
  });

  const positionRef = useRef(position);
  positionRef.current = position;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  useEffect(() => {
    savePersisted({ position, collapsed, activeId, hidden });
  }, [position, collapsed, activeId, hidden]);

  // Ctrl+Shift+D fully hides/shows the widget. The collapsed↔expanded toggle
  // happens via × (collapse) and clicking the circle (expand).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setHidden((h) => !h);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Re-clamp on window resize so a previously-valid position doesn't strand
  // the panel off-screen after the user shrinks the window.
  useEffect(() => {
    const onResize = () => {
      const w = collapsedRef.current ? CIRCLE_SIZE : PANEL_WIDTH_HINT;
      const h = collapsedRef.current ? CIRCLE_SIZE : PANEL_HEIGHT_HINT;
      setPosition((p) => clampPosition(p, w, h));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Re-clamp when expanding so the bigger panel doesn't overflow if the
  // circle was dragged near the edge.
  useEffect(() => {
    const w = collapsed ? CIRCLE_SIZE : PANEL_WIDTH_HINT;
    const h = collapsed ? CIRCLE_SIZE : PANEL_HEIGHT_HINT;
    setPosition((p) => clampPosition(p, w, h));
  }, [collapsed]);

  // Click-vs-drag detection.
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
      const w = collapsedRef.current ? CIRCLE_SIZE : PANEL_WIDTH_HINT;
      const h = collapsedRef.current ? CIRCLE_SIZE : PANEL_HEIGHT_HINT;
      setPosition(clampPosition({ x: drag.originX + dx, y: drag.originY + dy }, w, h));
    };

    const onMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moved) drag.onClick();
      dragRef.current = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const startDrag = useCallback((e: React.MouseEvent, onClickIfNoMove: () => void) => {
    if (e.button !== 0) return;
    dragRef.current = {
      originX: positionRef.current.x,
      originY: positionRef.current.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      onClick: onClickIfNoMove,
    };
    e.preventDefault();
  }, []);

  if (hidden) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onMouseDown={(e) => startDrag(e, () => setCollapsed(false))}
        title="Click to expand · drag to move (Ctrl+Shift+D to hide)"
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
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

  const active = TOOLS.find((t) => t.id === activeId) ?? TOOLS[0];
  const Active = active.Component;

  return (
    <div
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
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
          <strong style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.3 }}>Debug</strong>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
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
              padding: "6px 8px",
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
            <DevToolsIcon size={14} />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed(true)}
            title="Collapse to circle (Ctrl+Shift+D to fully hide)"
            aria-label="Collapse"
            style={{
              background: "transparent",
              color: DEBUG_TOKENS.textSecondary,
              border: "none",
              cursor: "pointer",
              fontSize: 24,
              fontWeight: 400,
              lineHeight: 1,
              padding: "2px 10px 6px",
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
          const isActive = t.id === activeId;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveId(t.id)}
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
        <Active />
      </div>
    </div>
  );
}

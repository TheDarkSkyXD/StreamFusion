import { onlineManager } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { DeveloperConsole } from "@/components/dev/DeveloperConsole";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { FallbackQueryDevtools, queryClient } from "@/providers/query-provider";
import {
  DEVELOPER_WIDGET_FRAME,
  type DeveloperWidgetLayout,
} from "@shared/developer-widget-layout";
import { createCancellableSleep, type CancellableSleep } from "@shared/utils/sleep";
import { electronDeveloperWidgetOverlay as overlay } from "../../adapters/electron/developer-widget-overlay";
import {
  collectDeveloperWidgetRects,
  tracksDeveloperWidgetMotion,
} from "./developer-widget-geometry";
import type { DeveloperWidgetPopupBridge } from "./developer-widget-popup-bridge";

export function supportsDeveloperWidgetOverlay(): boolean {
  return overlay.supported();
}

export function DeveloperWidgetOverlay() {
  const prepareRectRef = useRef<
    ((rect: DeveloperWidgetLayout["rectsCss"][number]) => Promise<boolean>) | null
  >(null);
  const [target, setTarget] = useState<DeveloperWidgetPopupBridge | null>(null);
  const [initiallySupported] = useState(supportsDeveloperWidgetOverlay);
  const [fallback, setFallback] = useState(!initiallySupported);
  const [lastFocusedElement] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  const restoreFocus = useCallback(() => {
    if (lastFocusedElement?.isConnected) lastFocusedElement.focus();
    else window.focus();
  }, [lastFocusedElement]);
  const restoreFocusTimeout = useManagedTimeout(restoreFocus);

  useLayoutEffect(() => {
    target?.consoleRoot.ownerDocument.defaultView?.dispatchEvent(
      new Event("streamfusion-widget-portal-committed")
    );
  }, [target]);

  useEffect(() => {
    if (fallback) return;
    let disposed = false;
    let opening = false;
    let popup: Window | null = null;
    let frame = 0;
    let bootstrapTimer: CancellableSleep | null = null;
    let observer: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let revision = 0;
    let inFlight = false;
    let pending: { layout: DeveloperWidgetLayout; resolve: (applied: boolean) => void } | null =
      null;
    let lastRects = "";
    let activeTransitions = 0;
    const activeMotionTargets = new WeakMap<EventTarget, number>();

    const send = async (layout: DeveloperWidgetLayout): Promise<boolean> => {
      if (inFlight) {
        pending?.resolve(false);
        return new Promise<boolean>((resolve) => {
          pending = { layout, resolve };
        });
      }
      inFlight = true;
      let applied = false;
      try {
        const result = await overlay.updateLayout(layout);
        applied = result.applied && result.revision === layout.revision;
        if (!applied && !disposed) setFallback(true);
      } catch {
        if (!disposed) setFallback(true);
      } finally {
        inFlight = false;
        const next = pending;
        pending = null;
        if (next && !disposed) void send(next.layout).then(next.resolve);
        else next?.resolve(false);
      }
      return applied;
    };

    const readRects = (): DeveloperWidgetLayout["rectsCss"] => {
      if (!popup || popup.closed) return [];
      const bridge = popup.streamfusionDeveloperWidgets;
      if (!bridge) return [];
      const viewport = { width: popup.innerWidth, height: popup.innerHeight };
      const rectsCss = collectDeveloperWidgetRects(bridge.queryRoot, viewport);
      const consoleElement = bridge.consoleRoot.firstElementChild;
      if (consoleElement?.isConnected) {
        const bounds = consoleElement.getBoundingClientRect();
        const x = Math.max(0, bounds.x);
        const y = Math.max(0, bounds.y);
        const width = Math.min(viewport.width, bounds.x + bounds.width) - x;
        const height = Math.min(viewport.height, bounds.y + bounds.height) - y;
        if (width > 0 && height > 0) rectsCss.push({ x, y, width, height });
      }
      return rectsCss;
    };

    const prepareRect = (rect: DeveloperWidgetLayout["rectsCss"][number]): Promise<boolean> => {
      const rectsCss = readRects();
      if (rectsCss.length >= 16) return Promise.resolve(false);
      return send({ revision: ++revision, rectsCss: [...rectsCss, rect] });
    };
    prepareRectRef.current = prepareRect;

    const measure = (): void => {
      frame = 0;
      if (!popup || popup.closed) return;
      const rectsCss = readRects();
      const serialized = JSON.stringify(rectsCss);
      if (serialized === lastRects) {
        if (activeTransitions > 0) schedule();
        return;
      }
      lastRects = serialized;
      if (rectsCss.length > 16) {
        setFallback(true);
        return;
      }
      void send({ revision: ++revision, rectsCss });
      if (activeTransitions > 0) schedule();
    };
    const schedule = (): void => {
      if (disposed || !popup || popup.closed) return;
      if (lastRects === "" || lastRects === "[]") {
        if (!bootstrapTimer) {
          bootstrapTimer = createCancellableSleep(16);
          void bootstrapTimer.result.then((result) => {
            bootstrapTimer = null;
            if (result.ok && !disposed) measure();
          });
        }
      } else if (!frame) frame = popup.requestAnimationFrame(measure);
    };

    const open = async (): Promise<void> => {
      if (opening || (popup && !popup.closed)) return;
      opening = true;
      lastRects = "";
      observer?.disconnect();
      resizeObserver?.disconnect();
      try {
        if (!(await overlay.arm()) || disposed) throw new Error("Widget host unavailable");
        popup = window.open("about:blank", DEVELOPER_WIDGET_FRAME);
        if (!popup || popup.closed || popup.opener !== window)
          throw new Error("Widget popup unavailable");
        const child = popup;
        child.addEventListener("beforeunload", () => {
          if (!disposed) {
            setTarget(null);
            restoreFocus();
          }
          observer?.disconnect();
          resizeObserver?.disconnect();
        });
        child.addEventListener("keyup", (event) => {
          if (event.key === "Escape") restoreFocus();
        });
        const script = child.document.createElement("script");
        script.type = "module";
        script.src = new URL(
          "/src/frontend/features/shell/components/dev/developer-widget-popup-entry.ts",
          window.location.href
        ).href;
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Widget entry failed to load"));
          child.document.head.append(script);
        });
        if (disposed || !child.streamfusionDeveloperWidgets)
          throw new Error("Widget entry unavailable");
        const bridge = child.streamfusionDeveloperWidgets;
        bridge.prepareRect = prepareRect;
        bridge.mountQueryDevtools(queryClient, onlineManager);
        setTarget(bridge);
        observer = new MutationObserver(schedule);
        observer.observe(child.document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["style", "class", "aria-expanded", "data-state"],
        });
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(bridge.consoleRoot);
        resizeObserver.observe(bridge.queryRoot);
        child.addEventListener("resize", schedule);
        child.addEventListener("pointermove", schedule);
        child.addEventListener("streamfusion-widget-geometry-changed", schedule);
        child.addEventListener("streamfusion-widget-portal-committed", measure);
        const motionStart = (event: Event): void => {
          const target = event.target;
          if (!target || !tracksDeveloperWidgetMotion(target, event.type === "animationstart"))
            return;
          activeMotionTargets.set(target, (activeMotionTargets.get(target) ?? 0) + 1);
          activeTransitions += 1;
          schedule();
        };
        const motionEnd = (event: Event): void => {
          const target = event.target;
          if (!target) return;
          const active = activeMotionTargets.get(target);
          if (!active) return;
          if (active === 1) activeMotionTargets.delete(target);
          else activeMotionTargets.set(target, active - 1);
          activeTransitions -= 1;
          schedule();
        };
        child.document.addEventListener("transitionrun", motionStart, true);
        child.document.addEventListener("transitionend", motionEnd, true);
        child.document.addEventListener("transitioncancel", motionEnd, true);
        child.document.addEventListener("animationstart", motionStart, true);
        child.document.addEventListener("animationend", motionEnd, true);
        child.document.addEventListener("animationcancel", motionEnd, true);
        measure();
      } catch {
        popup?.close();
        popup = null;
        if (!disposed) setFallback(true);
      } finally {
        opening = false;
      }
    };

    const onOwnerShortcut = (event: KeyboardEvent): void => {
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key.toLowerCase() === "d" &&
        (!popup || popup.closed)
      ) {
        event.preventDefault();
        void open();
      }
    };

    document.addEventListener("keydown", onOwnerShortcut);
    void open();
    return () => {
      disposed = true;
      prepareRectRef.current = null;
      document.removeEventListener("keydown", onOwnerShortcut);
      if (popup && frame) popup.cancelAnimationFrame(frame);
      bootstrapTimer?.cancel();
      observer?.disconnect();
      resizeObserver?.disconnect();
      popup?.streamfusionDeveloperWidgets?.dispose();
      popup?.close();
      void overlay.close().catch(() => undefined);
    };
  }, [fallback, restoreFocus]);

  if (fallback)
    return (
      <>
        <DeveloperConsole />
        {initiallySupported && <FallbackQueryDevtools />}
      </>
    );
  return target
    ? createPortal(
        <DeveloperConsole
          targetDocument={target.consoleRoot.ownerDocument}
          onCollapse={() => restoreFocusTimeout.start(0)}
          onPrepareMove={(rect) => prepareRectRef.current?.(rect) ?? Promise.resolve(false)}
        />,
        target.consoleRoot
      )
    : null;
}

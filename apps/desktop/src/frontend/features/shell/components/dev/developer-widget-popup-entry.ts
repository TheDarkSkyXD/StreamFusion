import { TanstackQueryDevtools } from "@tanstack/query-devtools";
import type { QueryClient, onlineManager } from "@tanstack/react-query";

import "@/global.css";
import "./developer-widget-popup.css";
import type { DeveloperWidgetPopupBridge } from "./developer-widget-popup-bridge";

const consoleRoot = document.createElement("div");
consoleRoot.id = "developer-console-root";
const queryRoot = document.createElement("div");
queryRoot.id = "developer-query-root";
document.body.append(consoleRoot, queryRoot);

try {
  const savedPosition = localStorage.getItem("tanstack-devtools-pos");
  const position: unknown = savedPosition ? JSON.parse(savedPosition) : null;
  if (
    typeof position === "object" &&
    position !== null &&
    "x" in position &&
    "y" in position &&
    typeof position.x === "number" &&
    typeof position.y === "number" &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y)
  ) {
    queryRoot.style.left = `${Math.max(0, Math.min(innerWidth - 60, position.x))}px`;
    queryRoot.style.top = `${Math.max(0, Math.min(innerHeight - 60, position.y))}px`;
    queryRoot.style.right = "auto";
    queryRoot.style.bottom = "auto";
  }
} catch {
  // Browser storage can deny access; the widget still works without a saved position.
}

let launcher: HTMLElement | null = null;
let suppressLauncherClick = false;
let drag: {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
  moved: boolean;
  sequence: number;
  pending: Promise<void> | null;
} | null = null;

const stopDrag = (): void => {
  const active = drag;
  if (!active) return;
  if (active.moved) {
    suppressLauncherClick = true;
    window.setTimeout(() => {
      suppressLauncherClick = false;
    }, 0);
  }
  const finish = () => {
    if (drag !== active) return;
    if (active.moved) {
      try {
        localStorage.setItem(
          "tanstack-devtools-pos",
          JSON.stringify({
            x: Number.parseFloat(queryRoot.style.left),
            y: Number.parseFloat(queryRoot.style.top),
          })
        );
      } catch {
        // A browser storage quota error must not interrupt the active drag.
      }
    }
    drag = null;
    window.dispatchEvent(new Event("streamfusion-widget-geometry-changed"));
  };
  if (active.pending) void active.pending.then(finish);
  else finish();
};

const cancelDrag = (): void => {
  if (!drag) return;
  drag.sequence += 1;
  drag = null;
  window.dispatchEvent(new Event("streamfusion-widget-geometry-changed"));
};

const bindLauncher = (): void => {
  const next = queryRoot.querySelector<HTMLElement>(".tsqd-open-btn-container");
  if (!next || next === launcher) return;
  launcher = next;
  next.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const button = next.querySelector<HTMLElement>(".tsqd-open-btn");
    if (!button) return;
    button.setPointerCapture(event.pointerId);
    const bounds = queryRoot.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: bounds.left,
      top: bounds.top,
      moved: false,
      sequence: 0,
      pending: null,
    };
  });
  next.addEventListener("pointermove", (event) => {
    const active = drag;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (Math.hypot(dx, dy) <= 5 && !active.moved) return;
    active.moved = true;
    const x = Math.max(0, Math.min(innerWidth - 60, active.left + dx));
    const y = Math.max(0, Math.min(innerHeight - 60, active.top + dy));
    const sequence = ++active.sequence;
    active.pending = Promise.resolve(
      bridge.prepareRect?.({ x, y, width: 60, height: 60 }) ?? true
    ).then((allowed) => {
      if (!allowed || drag !== active || sequence !== active.sequence) return;
      queryRoot.style.left = `${x}px`;
      queryRoot.style.top = `${y}px`;
      queryRoot.style.right = "auto";
      queryRoot.style.bottom = "auto";
    });
  });
  next.addEventListener("pointerup", stopDrag);
  next.addEventListener("pointercancel", cancelDrag);
  next.addEventListener("lostpointercapture", stopDrag);
  next.addEventListener(
    "click",
    (event) => {
      if (!suppressLauncherClick) return;
      suppressLauncherClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );
};

const launcherObserver = new MutationObserver(bindLauncher);
launcherObserver.observe(queryRoot, { childList: true, subtree: true });
window.addEventListener("blur", cancelDrag);

let devtools: TanstackQueryDevtools | null = null;

const bridge: DeveloperWidgetPopupBridge = {
  consoleRoot,
  queryRoot,
  mountQueryDevtools(client: QueryClient, manager: typeof onlineManager) {
    if (devtools) return;
    devtools = new TanstackQueryDevtools({
      client,
      onlineManager: manager,
      queryFlavor: "React Query",
      version: "5",
      initialIsOpen: false,
      buttonPosition: "relative",
    });
    devtools.mount(queryRoot);
    bindLauncher();
  },
  dispose() {
    devtools?.unmount();
    devtools = null;
    launcherObserver.disconnect();
    window.removeEventListener("blur", cancelDrag);
    consoleRoot.remove();
    queryRoot.remove();
    window.streamfusionDeveloperWidgets = undefined;
  },
};

window.streamfusionDeveloperWidgets = bridge;

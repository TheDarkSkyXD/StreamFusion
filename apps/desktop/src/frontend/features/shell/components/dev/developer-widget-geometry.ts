import type { DeveloperWidgetLayout } from "@shared/developer-widget-layout";

type CssRect = DeveloperWidgetLayout["rectsCss"][number];

const paintedSelectors = [
  ".tsqd-open-btn-container",
  "aside.tsqd-main-panel",
  ".tsqd-minimize-btn",
  ".tsqd-settings-menu",
  ".tsqd-settings-submenu",
  ".tsqd-query-status-tooltip",
  "[data-radix-popper-content-wrapper]",
];

function isElement(target: EventTarget): target is Element {
  return "matches" in target && typeof target.matches === "function";
}

export function tracksDeveloperWidgetMotion(target: EventTarget | null, animation: boolean): boolean {
  if (!target || !isElement(target)) return false;
  if (!paintedSelectors.some((selector) => target.matches(selector))) return false;
  if (!animation) return true;
  const view = target.ownerDocument.defaultView;
  if (!view) return false;
  return !view.getComputedStyle(target).animationIterationCount
    .split(",")
    .some((count) => count.trim() === "infinite");
}

export function collectDeveloperWidgetRects(
  root: HTMLElement,
  viewport: { width: number; height: number }
): CssRect[] {
  const panelOpen = root.querySelector("aside.tsqd-main-panel") !== null;
  const rects: CssRect[] = [];
  for (const selector of paintedSelectors) {
    if (panelOpen && selector === ".tsqd-open-btn-container") continue;
    if (!panelOpen && selector === "aside.tsqd-main-panel") continue;
    const scope =
      selector.includes("settings") || selector.includes("popper") || selector.includes("tooltip")
        ? root.ownerDocument
        : root;
    for (const element of scope.querySelectorAll<HTMLElement>(selector)) {
      if (
        !element.isConnected ||
        element.hidden ||
        element.ownerDocument.defaultView?.getComputedStyle(element).display === "none"
      )
        continue;
      const bounds = element.getBoundingClientRect();
      const x = Math.max(0, bounds.x);
      const y = Math.max(0, bounds.y);
      const width = Math.min(viewport.width, bounds.x + bounds.width) - x;
      const height = Math.min(viewport.height, bounds.y + bounds.height) - y;
      if (width > 0 && height > 0) rects.push({ x, y, width, height });
    }
  }
  return rects;
}

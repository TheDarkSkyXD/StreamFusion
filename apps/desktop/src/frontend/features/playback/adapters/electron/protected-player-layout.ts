import type {
  ProtectedPlaybackLayout,
  ProtectedPlaybackRect,
} from "@shared/protected-playback-types";

function intersect(
  left: ProtectedPlaybackRect,
  right: ProtectedPlaybackRect
): ProtectedPlaybackRect | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const width = Math.min(left.x + left.width, right.x + right.width) - x;
  const height = Math.min(left.y + left.height, right.y + right.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function rectOf(element: Element): ProtectedPlaybackRect {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

export function measureProtectedPlayerLayout(element: HTMLElement): ProtectedPlaybackLayout {
  const boundsCss = rectOf(element);
  if (boundsCss.width <= 0 || boundsCss.height <= 0 || document.visibilityState === "hidden") {
    return { kind: "hidden" };
  }
  let clipCss: ProtectedPlaybackRect | null = intersect(boundsCss, {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  });
  let radiusCss = 0;
  for (
    let ancestor: HTMLElement | null = element;
    ancestor && clipCss;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden") return { kind: "hidden" };
    if (
      ancestor !== element &&
      /(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)
    ) {
      clipCss = intersect(clipCss, rectOf(ancestor));
      radiusCss = Math.max(radiusCss, parseFloat(style.borderTopLeftRadius) || 0);
    }
  }
  return clipCss ? { kind: "visible", boundsCss, clipCss, radiusCss } : { kind: "hidden" };
}

export function observeProtectedPlayerLayout(
  element: HTMLElement,
  onChange: () => void
): () => void {
  let frame = 0;
  let transitionFrame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onChange();
    });
  };
  const resize = new ResizeObserver(schedule);
  const mutation = new MutationObserver(schedule);
  const bindAncestors = () => {
    resize.disconnect();
    mutation.disconnect();
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      resize.observe(ancestor);
      mutation.observe(ancestor, {
        attributes: true,
        attributeFilter: ["class", "style", "hidden"],
      });
    }
    schedule();
  };
  bindAncestors();
  const relocation = new MutationObserver((records) => {
    if (
      records.some((record) =>
        [...record.addedNodes].some(
          (node) => node === element || (node instanceof Element && node.contains(element))
        )
      )
    )
      bindAncestors();
  });
  relocation.observe(document.body, { childList: true, subtree: true });
  const tickTransition = () => {
    schedule();
    transitionFrame = requestAnimationFrame(tickTransition);
  };
  const startTransition = () => {
    if (!transitionFrame) transitionFrame = requestAnimationFrame(tickTransition);
  };
  const stopTransition = () => {
    cancelAnimationFrame(transitionFrame);
    transitionFrame = 0;
    schedule();
  };
  document.addEventListener("scroll", schedule, true);
  document.addEventListener("visibilitychange", schedule);
  document.addEventListener("transitionrun", startTransition, true);
  document.addEventListener("transitionend", stopTransition, true);
  document.addEventListener("transitioncancel", stopTransition, true);
  window.addEventListener("resize", schedule);
  window.addEventListener("focus", schedule);
  schedule();
  return () => {
    resize.disconnect();
    mutation.disconnect();
    relocation.disconnect();
    cancelAnimationFrame(frame);
    cancelAnimationFrame(transitionFrame);
    document.removeEventListener("scroll", schedule, true);
    document.removeEventListener("visibilitychange", schedule);
    document.removeEventListener("transitionrun", startTransition, true);
    document.removeEventListener("transitionend", stopTransition, true);
    document.removeEventListener("transitioncancel", stopTransition, true);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("focus", schedule);
  };
}

export function observeProtectedPlayerOcclusion(
  element: HTMLElement,
  onChange: (occluded: boolean) => Promise<void>
): () => void {
  let occluded = false;
  let hiddenReady = false;
  let generation = 0;
  let active = true;
  const selector =
    '[data-native-player-occluder], [role="dialog"], [data-radix-popper-content-wrapper]';
  const held = new Map<HTMLElement, { opacity: string; pointerEvents: string }>();
  const restore = (overlay: HTMLElement) => {
    const previous = held.get(overlay);
    if (!previous) return;
    overlay.style.opacity = previous.opacity;
    overlay.style.pointerEvents = previous.pointerEvents;
    held.delete(overlay);
  };
  const scan = () => {
    const player = rectOf(element);
    const overlays = [...document.querySelectorAll<HTMLElement>(selector)].filter(
      (overlay) => overlay.isConnected && intersect(player, rectOf(overlay)) !== null
    );
    for (const overlay of held.keys()) if (!overlays.includes(overlay)) restore(overlay);
    for (const overlay of overlays) {
      if (held.has(overlay)) continue;
      held.set(overlay, {
        opacity: overlay.style.opacity,
        pointerEvents: overlay.style.pointerEvents,
      });
      overlay.style.opacity = "0";
      overlay.style.pointerEvents = "none";
    }
    if (overlays.length > 0 && !occluded) {
      occluded = true;
      hiddenReady = false;
      const current = ++generation;
      void onChange(true).finally(() => {
        if (!active || current !== generation) return;
        hiddenReady = true;
        for (const overlay of held.keys()) restore(overlay);
      });
    } else if (overlays.length === 0 && occluded) {
      occluded = false;
      hiddenReady = false;
      generation++;
      void onChange(false);
    } else if (overlays.length > 0 && hiddenReady) {
      for (const overlay of held.keys()) restore(overlay);
    }
  };
  const hasCandidate = (node: Node) =>
    node instanceof Element && (node.matches(selector) || node.querySelector(selector) !== null);
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) =>
        record.type === "attributes"
          ? hasCandidate(record.target)
          : [...record.addedNodes, ...record.removedNodes].some(hasCandidate)
      )
    )
      scan();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-state"],
  });
  document.addEventListener("scroll", scan, true);
  window.addEventListener("resize", scan);
  scan();
  return () => {
    active = false;
    observer.disconnect();
    document.removeEventListener("scroll", scan, true);
    window.removeEventListener("resize", scan);
    for (const overlay of held.keys()) restore(overlay);
  };
}

import { useEffect } from "react";

import { getChatStoreDiagnosticCounters } from "@/store/chat-store";
import { createManagedInterval } from "@shared/utils/managed-interval";

function total(counters: ReturnType<typeof getChatStoreDiagnosticCounters>): number {
  return counters.addMessage + counters.addMessageBatched;
}

export function normalizedRoute(hash = window.location.hash): string {
  const rawPath = hash.startsWith("#") ? hash.slice(1).split("?", 1)[0] : window.location.pathname;
  const root = rawPath.split("/").filter(Boolean)[0];
  return root &&
    new Set([
      "following",
      "categories",
      "search",
      "stream",
      "video",
      "settings",
      "multistream",
      "history",
      "downloads",
      "mod",
    ]).has(root)
    ? `/${root}`
    : "/";
}

export function useRendererActivityReporter(): void {
  useEffect(() => {
    let previousChatEvents = total(getChatStoreDiagnosticCounters());
    const report = () => {
      const currentChatEvents = total(getChatStoreDiagnosticCounters());
      void window.electronAPI.diagnostics.reportActivity({
        observedAtMs: Date.now(),
        route: normalizedRoute(),
        heapUsedBytes:
          (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
            ?.usedJSHeapSize ?? null,
        domNodeCount: document.getElementsByTagName("*").length,
        chatEvents: Math.max(0, currentChatEvents - previousChatEvents),
        activeStreamSlots: document.querySelectorAll("[data-diagnostics-stream-slot]").length,
        activeVideoElements: document.querySelectorAll("video").length,
      });
      previousChatEvents = currentChatEvents;
    };
    report();
    const timer = createManagedInterval(report, 30_000);
    return () => timer.stop();
  }, []);
}

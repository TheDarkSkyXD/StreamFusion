import type { DiagnosticsClient } from "../../capabilities/diagnostics-client";
import { normalizedRoute } from "../../domain/activity-route";
import { createManagedInterval } from "@shared/utils/managed-interval";

function total(counters: { addMessage: number; addMessageBatched: number }): number {
  return counters.addMessage + counters.addMessageBatched;
}

export function startRendererActivityReporter(
  client: DiagnosticsClient,
  chatCounters: () => { addMessage: number; addMessageBatched: number }
): () => void {
  let previousChatEvents = total(chatCounters());
  const report = () => {
    const currentChatEvents = total(chatCounters());
    void client.reportActivity({
      observedAtMs: Date.now(),
      route: normalizedRoute(window.location.hash, window.location.pathname),
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
}

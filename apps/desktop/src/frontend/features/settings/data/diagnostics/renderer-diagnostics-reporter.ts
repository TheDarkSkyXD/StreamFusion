import { getActiveIntervalCount } from "@/components/dev/interval-tracker";
import { getRenderCounts } from "@/components/dev/use-render-count";
import { createManagedInterval } from "@shared/utils/managed-interval";
import { getChatStoreDiagnosticCounters } from "@/store/chat-store";

interface ChromiumPerformance extends Performance {
  readonly memory?: {
    readonly usedJSHeapSize: number;
    readonly totalJSHeapSize: number;
  };
}

function totalCounterValues(counters: Readonly<Record<string, number>>): number {
  return Object.values(counters).reduce((total, value) => total + value, 0);
}

export function startRendererDiagnosticsReporter(): () => void {
  let stopped = false;
  let frameId = 0;
  let frameCount = 0;
  let frameDurationTotalMs = 0;
  let previousFrameAtMs: number | null = null;
  let previousReportAtMs = performance.now();
  let previousChatCalls = totalCounterValues(getChatStoreDiagnosticCounters());

  const collectFrame = (nowMs: number) => {
    if (stopped) return;
    if (previousFrameAtMs !== null) {
      frameCount += 1;
      frameDurationTotalMs += Math.max(0, nowMs - previousFrameAtMs);
    }
    previousFrameAtMs = nowMs;
    frameId = requestAnimationFrame(collectFrame);
  };
  frameId = requestAnimationFrame(collectFrame);

  const report = () => {
    const nowMs = performance.now();
    const elapsedSeconds = Math.max(0.001, (nowMs - previousReportAtMs) / 1_000);
    const chatCalls = totalCounterValues(getChatStoreDiagnosticCounters());
    const memory = (performance as ChromiumPerformance).memory;
    void window.electronAPI.diagnostics.reportRenderer({
      observedAtMs: Date.now(),
      heapUsedBytes: memory?.usedJSHeapSize ?? null,
      heapTotalBytes: memory?.totalJSHeapSize ?? null,
      framesPerSecond: frameCount / elapsedSeconds,
      averageFrameTimeMs: frameCount === 0 ? 0 : frameDurationTotalMs / frameCount,
      liveIntervalCount: getActiveIntervalCount(),
      renderCount: totalCounterValues(getRenderCounts()),
      chatStoreCallsPerSecond: Math.max(0, chatCalls - previousChatCalls) / elapsedSeconds,
    });
    frameCount = 0;
    frameDurationTotalMs = 0;
    previousFrameAtMs = null;
    previousReportAtMs = nowMs;
    previousChatCalls = chatCalls;
  };

  report();
  const reportTimer = createManagedInterval(report, 1_000);
  return () => {
    stopped = true;
    reportTimer.stop();
    cancelAnimationFrame(frameId);
  };
}

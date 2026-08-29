import {
  createPerformanceCollector,
  type PerformanceSnapshot,
  type VideoEventName,
} from "./performance-collector";

export interface StreamFusionPerformanceHarness {
  startScenario(name: string): void;
  endScenario(): PerformanceSnapshot;
  snapshot(): PerformanceSnapshot;
  reset(): void;
}

declare global {
  interface Window {
    __streamFusionPerf?: StreamFusionPerformanceHarness;
  }
}

const VIDEO_EVENTS: VideoEventName[] = [
  "loadedmetadata",
  "canplay",
  "playing",
  "waiting",
  "stalled",
];

export function installPerformanceHarness(): StreamFusionPerformanceHarness {
  const collector = createPerformanceCollector();
  const wiredVideos = new WeakSet<HTMLVideoElement>();
  let active = false;
  let animationFrame = 0;
  let previousFrameTime: number | null = null;
  let lastQualitySampleAt = 0;

  const sampleVideoQuality = () => {
    let totalVideoFrames = 0;
    let droppedVideoFrames = 0;
    let sampled = false;
    for (const video of document.querySelectorAll("video")) {
      const quality = video.getVideoPlaybackQuality?.();
      if (!quality) continue;
      sampled = true;
      totalVideoFrames += quality.totalVideoFrames;
      droppedVideoFrames += quality.droppedVideoFrames;
    }
    if (sampled) collector.recordVideoQuality({ totalVideoFrames, droppedVideoFrames });
  };

  const collectFrame = (now: number) => {
    if (!active) return;
    if (previousFrameTime !== null) collector.recordFrame(now - previousFrameTime);
    previousFrameTime = now;
    if (now - lastQualitySampleAt >= 1_000) {
      sampleVideoQuality();
      lastQualitySampleAt = now;
    }
    animationFrame = requestAnimationFrame(collectFrame);
  };

  const wireVideo = (video: HTMLVideoElement) => {
    if (wiredVideos.has(video)) return;
    wiredVideos.add(video);
    for (const eventName of VIDEO_EVENTS) {
      video.addEventListener(eventName, () => collector.recordVideoEvent(eventName));
    }
  };

  const wireVideos = () => document.querySelectorAll("video").forEach(wireVideo);
  wireVideos();

  const domObserver = new MutationObserver(wireVideos);
  domObserver.observe(document.documentElement, { childList: true, subtree: true });

  let longTaskObserver: PerformanceObserver | null = null;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        collector.recordLongTask({ startTime: entry.startTime, duration: entry.duration });
      }
    });
    longTaskObserver.observe({ type: "longtask", buffered: true });
  } catch {
    // Chromium versions without the Long Tasks API still provide frame metrics.
  }

  const markRoutePresented = (hash: string) => {
    const waitForPaint = () => {
      if (document.querySelector('[data-route-page-loader="true"]')) return;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => collector.recordRoutePresented(hash))
      );
    };
    waitForPaint();
    if (document.querySelector('[data-route-page-loader="true"]')) {
      const routeObserver = new MutationObserver(() => {
        if (document.querySelector('[data-route-page-loader="true"]')) return;
        routeObserver.disconnect();
        waitForPaint();
      });
      routeObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  };

  window.addEventListener("hashchange", () => {
    if (!active) return;
    const hash = window.location.hash;
    collector.recordRouteStart(hash);
    markRoutePresented(hash);
  });

  const stop = () => {
    active = false;
    cancelAnimationFrame(animationFrame);
    previousFrameTime = null;
    sampleVideoQuality();
  };

  const harness: StreamFusionPerformanceHarness = {
    startScenario(name) {
      stop();
      collector.startScenario(name);
      active = true;
      lastQualitySampleAt = performance.now();
      sampleVideoQuality();
      animationFrame = requestAnimationFrame(collectFrame);
    },
    endScenario() {
      stop();
      return collector.snapshot();
    },
    snapshot() {
      sampleVideoQuality();
      return collector.snapshot();
    },
    reset() {
      stop();
      collector.reset();
    },
  };

  window.__streamFusionPerf = harness;
  performance.mark("streamfusion:performance-harness-installed");
  return harness;
}

import { applyModerationBrowserFixture } from "@/dev-relay/moderation-browser-fixtures";
import { installConsoleIntercept } from "./logging/console-intercept";
import { installNetworkMonitor } from "./logging/network-monitor";
import { installRendererErrorHooks } from "./logging/renderer-error-hooks";

export interface RendererRuntime {
  markRenderCalled(): void;
  dispose(): void;
}

export function startRendererRuntime(): RendererRuntime {
  const performanceHarnessRequested =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get("perf") === "1";
  if (performanceHarnessRequested) performance.mark("streamfusion:renderer-module-enter");

  const cleanups = [
    installConsoleIntercept(),
    installRendererErrorHooks(),
    installNetworkMonitor(),
  ];
  let disposed = false;
  let renderMarked = false;
  let animationFrame = 0;

  if (import.meta.env.DEV) {
    void import("@/components/dev/interval-tracker").then(({ installIntervalTracker }) => {
      if (!disposed) installIntervalTracker();
    });
    applyModerationBrowserFixture(window.location.search);
  }

  if (import.meta.env.DEV && import.meta.env.VITE_STREAMFUSION_BROWSER_DEV === "1") {
    void import("@/dev-relay/host-bootstrap")
      .then(async ({ bootstrapDevRelayHost }) => {
        if (disposed) return;
        const stop = await bootstrapDevRelayHost({
          enabled: true,
          isBrowserClient: Boolean(window.__STREAMFUSION_BROWSER_DEV_CLIENT__),
        });
        if (disposed) stop();
        else cleanups.push(stop);
      })
      .catch((error) => {
        if (!disposed) console.error("Could not start the browser development relay host", error);
      });
  }

  const runtime: RendererRuntime = {
    markRenderCalled() {
      if (disposed || renderMarked) return;
      renderMarked = true;
      if (performanceHarnessRequested) {
        performance.mark("streamfusion:root-render-called");
        animationFrame = requestAnimationFrame(() => {
          performance.mark("streamfusion:first-render-frame");
          animationFrame = requestAnimationFrame(() =>
            performance.mark("streamfusion:first-presented-frame")
          );
        });
        void import("./performance/performance-harness").then(({ installPerformanceHarness }) => {
          if (!disposed) installPerformanceHarness();
        });
      }
      console.debug("StreamFusion is running in renderer process");
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(animationFrame);
      const errors: unknown[] = [];
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, "Renderer runtime cleanup failed");
    },
  };

  import.meta.hot?.dispose(runtime.dispose);
  return runtime;
}

if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

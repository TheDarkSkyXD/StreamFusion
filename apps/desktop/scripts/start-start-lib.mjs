export function retireViteProxyUpgrades(httpServer) {
  return {
    name: "streamfusion-owned-proxy-upgrades",
    configureServer(server) {
      const existing = new Set(httpServer.listeners("upgrade"));
      const originalClose = server.close.bind(server);
      let added = [];
      let retired = false;
      server.close = (...args) => {
        if (!retired) {
          retired = true;
          for (const listener of added) httpServer.removeListener("upgrade", listener);
        }
        return originalClose(...args);
      };
      return () => {
        added = httpServer.listeners("upgrade").filter((listener) => !existing.has(listener));
      };
    },
  };
}

export function createDevelopmentCleanup() {
  const steps = [];
  let closing;
  return {
    add(cleanup) {
      steps.push(cleanup);
    },
    close() {
      closing ??= (async () => {
        const errors = [];
        for (const cleanup of steps.splice(0).reverse()) {
          try {
            await cleanup();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) throw new AggregateError(errors, "Start development cleanup failed");
      })();
      return closing;
    },
  };
}

export function observePreloadBuilds(watcher, { reload, reportError, signal }) {
  let ready = false;
  let failed = false;
  let resolveReady;
  let rejectReady;
  const firstBuild = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const aborted = () => rejectReady(signal.reason);
  const onEvent = (event) => {
    if (signal.aborted) return;
    if (event.code === "START") failed = false;
    if (event.code === "ERROR") {
      failed = true;
      if (!ready) rejectReady(event.error);
      else reportError(event.error);
    }
    if (event.code === "END" && !failed) {
      if (ready) reload();
      else {
        ready = true;
        signal.removeEventListener("abort", aborted);
        resolveReady();
      }
    }
  };
  watcher.on("event", onEvent);
  signal.addEventListener("abort", aborted, { once: true });
  if (signal.aborted) aborted();
  return {
    firstBuild,
    dispose() {
      watcher.off("event", onEvent);
      signal.removeEventListener("abort", aborted);
    },
  };
}

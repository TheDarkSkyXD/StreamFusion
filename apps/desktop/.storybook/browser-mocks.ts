type AnyFunction = (...args: unknown[]) => unknown;

const noop = () => {};

function createBridgeSection(path: string[] = []): AnyFunction {
  const callable = () => {
    const methodName = path.at(-1) ?? "";

    if (
      methodName.startsWith("on") ||
      methodName.startsWith("subscribe") ||
      methodName.startsWith("addListener")
    ) {
      return noop;
    }

    if (methodName === "getSystemTheme") return Promise.resolve("dark");
    if (methodName === "getVersion") return Promise.resolve("0.0.0-storybook");
    if (methodName === "getVersionInfo") {
      return Promise.resolve({
        version: "0.0.0-storybook",
        isPackaged: false,
        platform: "storybook",
      });
    }
    if (methodName === "isMaximized") return Promise.resolve(false);

    return Promise.resolve(undefined);
  };

  return new Proxy(callable, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (property === Symbol.toStringTag) return "StorybookElectronMock";
      return createBridgeSection([...path, String(property)]);
    },
  });
}

if (!Reflect.has(window, "electronAPI")) {
  Reflect.defineProperty(window, "electronAPI", {
    configurable: true,
    value: createBridgeSection(),
  });
}

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => false,
  });
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!window.IntersectionObserver) {
  window.IntersectionObserver = class IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [0];

    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  };
}

if (!window.scrollTo) {
  window.scrollTo = noop;
}

if (!URL.createObjectURL) {
  URL.createObjectURL = () => "blob:storybook";
}

if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = noop;
}

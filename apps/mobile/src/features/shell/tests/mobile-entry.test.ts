import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const registry = vi.hoisted(() => ({
  registerComponent: vi.fn<(name: string, factory: () => ComponentType) => void>(),
}));

vi.mock("react-native", () => ({ AppRegistry: registry }));
vi.mock("react-native-safe-area-context", async () => {
  const { createContext, createElement, useContext } = await import("react");
  const Insets = createContext<{ top: number } | null>(null);
  return {
    initialWindowMetrics: null,
    SafeAreaProvider: ({ children }: { children: import("react").ReactNode }) =>
      createElement(Insets.Provider, { value: { top: 24 } }, children),
    useSafeAreaInsets() {
      const insets = useContext(Insets);
      if (!insets) throw new Error("No safe area value available");
      return insets;
    },
  };
});
vi.mock("../../../../src/composition/mobile-runtime", async () => {
  const { createElement } = await import("react");
  const { useSafeAreaInsets } = await import("react-native-safe-area-context");
  return {
    MobileRuntime: () => createElement("div", null, `top:${useSafeAreaInsets().top}`),
  };
});

import "../../../../index.js";

it("the registered Android app supplies safe-area insets to its screens", () => {
  const registration = registry.registerComponent.mock.calls[0];
  expect(registration?.[0]).toBe("main");
  if (!registration) throw new Error("The app was not registered");
  expect(renderToStaticMarkup(createElement(registration[1]()))).toBe("<div>top:24</div>");
});

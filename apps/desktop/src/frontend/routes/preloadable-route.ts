import { type ComponentType, type ReactElement } from "react";

import { createPreloadableComponent } from "./preloadable-component";

export function createPreloadableRoute(load: () => Promise<{ default: ComponentType }>) {
  const route = createPreloadableComponent(load);
  const Component = Object.assign(route.Component as () => ReactElement, {
    preload: () => route.preload().then(() => undefined),
  });
  return { ...route, Component };
}

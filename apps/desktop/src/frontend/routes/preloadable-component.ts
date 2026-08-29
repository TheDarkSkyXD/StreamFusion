import { type ComponentType, createElement, type ReactElement } from "react";

interface PreloadableComponent<Props extends object> {
  Component: (props: Props) => ReactElement;
  preload: () => Promise<{ default: ComponentType<Props> }>;
}

/**
 * Keep an externally preloaded component renderable without making React.lazy
 * discover the already-resolved module through a second suspense cycle.
 */
export function createPreloadableComponent<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>
): PreloadableComponent<Props> {
  let loadedComponent: ComponentType<Props> | undefined;
  let loadError: unknown;
  let pendingLoad: Promise<{ default: ComponentType<Props> }> | undefined;

  const preload = () => {
    if (loadedComponent) return Promise.resolve({ default: loadedComponent });
    if (loadError) return Promise.reject(loadError);

    pendingLoad ??= load().then(
      (module) => {
        loadedComponent = module.default;
        return module;
      },
      (error) => {
        loadError = error;
        throw error;
      }
    );
    return pendingLoad;
  };

  const Component = (props: Props): ReactElement => {
    if (loadedComponent) return createElement(loadedComponent, props);
    if (loadError) throw loadError;
    throw preload();
  };

  return { Component, preload };
}

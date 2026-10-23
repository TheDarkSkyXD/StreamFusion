import type { QueryClient, onlineManager } from "@tanstack/react-query";

export interface DeveloperWidgetPopupBridge {
  consoleRoot: HTMLElement;
  queryRoot: HTMLElement;
  prepareRect?: (rect: { x: number; y: number; width: number; height: number }) => Promise<boolean>;
  mountQueryDevtools(client: QueryClient, manager: typeof onlineManager): void;
  dispose(): void;
}

declare global {
  interface Window {
    streamfusionDeveloperWidgets?: DeveloperWidgetPopupBridge;
  }
}

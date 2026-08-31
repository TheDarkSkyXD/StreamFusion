import { createPreloadableRoute } from "@/routes/preloadable-route";

export function validateSettingsSearch(search: Record<string, unknown>): {
  tab?: string;
  variant?: string;
} {
  return {
    tab: typeof search.tab === "string" ? search.tab : undefined,
    variant: typeof search.variant === "string" ? search.variant : undefined,
  };
}

export const SettingsPage = createPreloadableRoute(() =>
  import("../../../pages/Settings").then((module) => ({ default: module.SettingsPage }))
).Component;

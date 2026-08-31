import { lazy } from "react";

export function validateSettingsSearch(search: Record<string, unknown>): {
  tab?: string;
  variant?: string;
} {
  return {
    tab: typeof search.tab === "string" ? search.tab : undefined,
    variant: typeof search.variant === "string" ? search.variant : undefined,
  };
}

export const SettingsPage = lazy(() =>
  import("../../../pages/Settings").then((module) => ({ default: module.SettingsPage }))
);

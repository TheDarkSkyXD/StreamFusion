import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

import { selectedModerationDevelopmentFixture } from "./moderation-browser-fixture-contract";

export type {
  ModerationBrowserFixture,
  ModerationFixtureMatch,
} from "./moderation-browser-fixture-contract";
export {
  getModerationBrowserFixture,
  selectedModerationDevelopmentFixture,
} from "./moderation-browser-fixture-contract";

export function applyModerationBrowserFixture(
  search: string,
  isDevelopment = import.meta.env.DEV
): void {
  const fixture = selectedModerationDevelopmentFixture(search, isDevelopment);
  if (!fixture) return;
  useDevModOverrideStore.setState({
    forceModRole: fixture !== "hidden",
    forceModScopes: fixture !== "hidden" && fixture !== "reconnect",
  });
}

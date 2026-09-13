import { useState } from "react";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type {
  DiscoveryFixtureMode,
  DiscoverySession,
} from "../capabilities/platform-reads";
import { composeCategoryDetail } from "../domain/category-detail";
import type { CategoryIdentity } from "../domain/category-identity";
import { fixtureOutcome } from "../domain/discovery-fixture";

import { CategoryDetailView } from "./category-detail-view";
import { useCategoryDetail } from "./use-category-detail";

export function CategoryDetailScreen({
  category,
  onOpenAccounts,
  preferences,
  session,
}: {
  readonly category: CategoryIdentity;
  readonly onOpenAccounts: () => void;
  readonly preferences: DiscoveryPreferenceStore;
  readonly session: DiscoverySession;
}) {
  const [mode, setMode] = useState<DiscoveryFixtureMode>("live");
  const [query, setQuery] = useState("");
  const live = useCategoryDetail({
    category,
    enabled: mode === "live",
    preferences,
    session,
  });
  const view =
    mode === "live"
      ? live.view
      : composeCategoryDetail({
          identity: live.view.identity,
          kick: fixtureOutcome("kick", mode),
          loading: mode === "loading",
          twitch: fixtureOutcome("twitch", mode),
        });
  return (
    <CategoryDetailView
      onChangeIdentity={live.change}
      onChangeQuery={setQuery}
      onOpenAccounts={onOpenAccounts}
      onRetry={live.retry}
      query={query}
      view={view}
      {...(__DEV__
        ? { onSelectProofMode: setMode, proofMode: mode }
        : {})}
    />
  );
}

export { CategoryDetailView } from "./category-detail-view";

import { useState } from "react";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type { DiscoverySession } from "../capabilities/platform-reads";
import type { CategoryIdentity } from "../domain/category-identity";

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
  const [query, setQuery] = useState("");
  const live = useCategoryDetail({
    category,
    preferences,
    session,
  });
  return (
    <CategoryDetailView
      onChangeIdentity={live.change}
      onChangeQuery={setQuery}
      onOpenAccounts={onOpenAccounts}
      onRetry={live.retry}
      query={query}
      view={live.view}
    />
  );
}

export { CategoryDetailView } from "./category-detail-view";

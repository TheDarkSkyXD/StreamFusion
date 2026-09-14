import type { WatchHistoryItem } from "../capabilities/watch-history";
import { canResumeWatchHistory, filterWatchHistory } from "./watch-history";

export type WatchHistoryConfirmation =
  | { readonly kind: "clear" }
  | { readonly id: string; readonly kind: "remove"; readonly title: string };

export type WatchHistoryStatus = "empty" | "offline" | "ready" | "unavailable";

export type WatchHistoryView = {
  readonly confirmation: WatchHistoryConfirmation | null;
  readonly items: readonly WatchHistoryItem[];
  readonly query: string;
  readonly status: WatchHistoryStatus;
};

export function composeWatchHistoryView(input: {
  readonly confirmation?: WatchHistoryConfirmation | null;
  readonly items: readonly WatchHistoryItem[];
  readonly offline?: boolean;
  readonly query: string;
  readonly unavailable?: boolean;
}): WatchHistoryView {
  if (input.unavailable === true) {
    return {
      confirmation: null,
      items: [],
      query: input.query,
      status: "unavailable",
    };
  }
  const items = filterWatchHistory(input.items, input.query);
  return {
    confirmation: input.confirmation ?? null,
    items,
    query: input.query,
    status:
      input.offline === true
        ? "offline"
        : items.length === 0
          ? "empty"
          : "ready",
  };
}

export function watchHistoryRowActions(item: WatchHistoryItem): {
  readonly open: boolean;
  readonly replay: boolean;
  readonly resume: boolean;
} {
  return {
    open: item.kind === "stream",
    replay: item.kind !== "stream",
    resume: canResumeWatchHistory(item),
  };
}

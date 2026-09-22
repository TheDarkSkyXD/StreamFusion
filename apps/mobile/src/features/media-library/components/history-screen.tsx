import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";
import type { WatchHistoryRepository } from "../capabilities/watch-history";
import { HistoryView } from "./history-view";
import { useWatchHistory } from "./use-watch-history";

export function HistoryScreen({
  onWatch,
  readNetwork,
  repository,
}: {
  readonly onWatch: (target: WatchTarget) => void;
  readonly readNetwork: () => Promise<"online" | "offline">;
  readonly repository: WatchHistoryRepository;
}) {
  const history = useWatchHistory({ readNetwork, repository });
  return (
    <HistoryView
      model={history.model}
      onCancel={history.cancel}
      onChangeQuery={history.setQuery}
      onClear={history.requestClear}
      onConfirm={() => {
        void history.confirm();
      }}
      onOpen={(item) => onWatch(history.open(item, "open"))}
      onRemove={history.requestRemove}
      onRefresh={() => history.refresh()}
      refreshing={history.refreshing}
      onReplay={(item) => onWatch(history.open(item, "replay"))}
      onResume={(item) => onWatch(history.open(item, "resume"))}
      onRetry={() => {
        void history.refresh();
      }}
    />
  );
}

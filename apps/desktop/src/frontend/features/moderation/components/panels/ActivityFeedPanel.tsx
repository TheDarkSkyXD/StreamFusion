import { WorkspaceFeedPanel } from "./WorkspaceFeedPanel";
import type { WorkspacePanelProps } from "./useWorkspaceFeed";
export function ActivityFeedPanel(props: WorkspacePanelProps) {
  return <WorkspaceFeedPanel {...props} kind="activity" />;
}

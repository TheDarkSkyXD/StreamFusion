import { WorkspaceFeedPanel } from "./WorkspaceFeedPanel";
import type { WorkspacePanelProps } from "./useWorkspaceFeed";
export function SuspiciousActivityPanel(props: WorkspacePanelProps) {
  return <WorkspaceFeedPanel {...props} kind="suspicious" />;
}

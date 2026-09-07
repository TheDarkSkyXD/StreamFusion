import { WorkspaceFeedPanel } from "./WorkspaceFeedPanel";
import type { WorkspacePanelProps } from "./useWorkspaceFeed";
export function WhispersPanel(props: WorkspacePanelProps) {
  return <WorkspaceFeedPanel {...props} kind="whispers" />;
}

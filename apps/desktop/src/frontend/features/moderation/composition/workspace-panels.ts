import { desktopWorkspacePanels } from "../adapters/electron/workspace-panels";
import type { WorkspacePanelsPort } from "../capabilities/workspace-panels";
export const getWorkspacePanelsPort = (): WorkspacePanelsPort => desktopWorkspacePanels;

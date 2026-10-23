import type { DeveloperWidgetLayout } from "@shared/developer-widget-layout";

export interface DeveloperWidgetOverlayCapability {
  supported(): boolean;
  arm(): Promise<boolean>;
  updateLayout(layout: DeveloperWidgetLayout): Promise<{ applied: boolean; revision: number }>;
  close(): Promise<void>;
}

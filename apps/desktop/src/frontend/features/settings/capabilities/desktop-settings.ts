import type {
  AppEnvironment,
  ProxyApplyConfig,
  ProxyApplyResult,
  ProxyCredentialsInput,
  VersionInfo,
} from "@shared/ipc-channels";
import type { LiveNotificationCoverageStatus } from "@shared/auth-types";
import type { SlotQualityMode } from "@shared/slot-types";

export interface DesktopControls {
  getVersion(): Promise<string>;
  getVersionInfo(): Promise<VersionInfo>;
  isMaximized(): Promise<boolean>;
  onMaximizeChange(callback: (maximized: boolean) => void): () => void;
  minimizeWindow(): void;
  maximizeWindow(): void;
  closeWindow(): void;
  toggleDevTools(): void;
  openExternal(url: string): Promise<void>;
}

export interface EnvironmentReader {
  get(): Promise<AppEnvironment>;
}

export interface PlaybackBudgetSettings {
  setPlaybackBudget(budget: number): Promise<void>;
  setBackgroundQuality(mode: SlotQualityMode): Promise<void>;
}

export interface NotificationCoverageReader {
  getCoverageStatus(): Promise<LiveNotificationCoverageStatus>;
}

export interface ProxySettings {
  apply(config: ProxyApplyConfig): Promise<ProxyApplyResult>;
  setCredentials(credentials: ProxyCredentialsInput | null): Promise<{ hasCredentials: boolean }>;
  hasCredentials(): Promise<{ hasCredentials: boolean }>;
}

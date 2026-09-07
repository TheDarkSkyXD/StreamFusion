import type { DiscoveryResult } from "@streamfusion/core/discovery";
import type { Platform } from "@streamfusion/core/platform";
import type { LocalFollow, UserPreferences } from "@shared/auth-types";
import type { AuthStatus } from "@shared/ipc-channels";
import type { UnifiedStream } from "@shared/platform-types";

type RefreshResult = { success: boolean; error?: string };
type FollowSyncEvent = { platform: Platform; count: number; pendingCount?: number; addedCount?: number; removedCount?: number };
type DeviceCodeEvent = { status: string };
type FollowSyncResult = { success?: boolean; error?: string; synced?: Platform[]; failed?: Platform[]; failureReasons?: Partial<Record<Platform, string>> };

export interface AuthRuntime {
  readonly auth: {
    getStatus(): Promise<AuthStatus>;
    refreshTwitchToken(): Promise<RefreshResult>;
    refreshKickToken(): Promise<RefreshResult>;
    onKickSessionExpired(callback: () => void): () => void;
    onFollowsSynced(callback: (event: FollowSyncEvent) => void): () => void;
    onTwitchAuthLost(callback: () => void): () => void;
    syncFollows(platform: Platform): Promise<FollowSyncResult>;
    onDeviceCodeStatus(callback: (event: DeviceCodeEvent) => void): () => void;
    openTwitchLogin(): Promise<void>;
    logoutTwitch(): Promise<RefreshResult>;
    openKickLogin(): Promise<void>;
    logoutKick(): Promise<RefreshResult>;
  };
  readonly follows: {
    getAll(): Promise<LocalFollow[]>;
    add(follow: Omit<LocalFollow, "id" | "followedAt">): Promise<LocalFollow>;
    remove(id: string): Promise<boolean>;
    update(id: string, updates: Partial<LocalFollow>): Promise<LocalFollow | null>;
    isFollowing(platform: Platform, channelId: string): Promise<boolean>;
  };
  readonly preferences: { get(): Promise<UserPreferences>; update(updates: Partial<UserPreferences>): Promise<UserPreferences> };
  readonly streams: { getFollowed(request?: { platform?: Platform }): Promise<DiscoveryResult<UnifiedStream[]>> };
}

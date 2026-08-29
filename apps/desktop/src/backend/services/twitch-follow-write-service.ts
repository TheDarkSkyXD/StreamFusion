import type { UnifiedChannel } from "@shared/platform-types";
import {
  TwitchFollowWriteError,
  writeTwitchAccountFollow,
} from "@backend/api/platforms/twitch/endpoints/follow-endpoints";
import { twitchClient } from "@backend/api/platforms/twitch/twitch-client";
import {
  twitchFollowWriteCredentialService,
  type TwitchFollowWriteCredential,
} from "@backend/auth/twitch-follow-write-credential";
import type { LocalFollow } from "@shared/auth-types";
import { storageService } from "./storage-service";

type TwitchFollowInput = Omit<LocalFollow, "id" | "followedAt"> & { platform: "twitch" };
type TwitchFollowAction = "follow" | "unfollow";

interface TwitchFollowStorage {
  hasToken(platform: "twitch"): boolean;
  upsertSyncedFollows(
    platform: "twitch",
    follows: TwitchFollowInput[],
    options: { pruneAbsent: true }
  ): { accountCount: number; pendingCount: number; addedCount: number; removedCount: number };
  getActiveFollowsByPlatform(platform: "twitch"): LocalFollow[];
}

interface TwitchFollowWriteServiceDependencies {
  storage: TwitchFollowStorage;
  getCredential: () => Promise<TwitchFollowWriteCredential>;
  clearCredential: () => void;
  getCurrentUser: () => Promise<{ id: string } | null>;
  writeTwitchAccountFollow: (request: {
    action: TwitchFollowAction;
    channelId: string;
    credential: TwitchFollowWriteCredential;
  }) => Promise<{ status: "accepted" }>;
  getAllFollowedChannels: () => Promise<UnifiedChannel[]>;
}

export class TwitchFollowWriteService {
  constructor(private readonly dependencies: TwitchFollowWriteServiceDependencies) {}

  async write(
    target: TwitchFollowInput,
    action: TwitchFollowAction
  ): Promise<{ status: "confirmed"; activeFollows: LocalFollow[] }> {
    if (!this.dependencies.storage.hasToken("twitch")) {
      throw new TwitchFollowWriteError(
        "authorization-required",
        "Connect Twitch, then try the follow change again."
      );
    }

    let credential: TwitchFollowWriteCredential;
    try {
      credential = await this.dependencies.getCredential();
    } catch {
      throw new TwitchFollowWriteError(
        "authorization-required",
        "Reconnect Twitch follow access, then try again."
      );
    }
    const currentUser = await this.dependencies.getCurrentUser();
    if (!currentUser) {
      throw new TwitchFollowWriteError(
        "authorization-required",
        "Reconnect Twitch, then try the follow change again."
      );
    }
    if (currentUser.id !== credential.userId) {
      this.dependencies.clearCredential();
      throw new TwitchFollowWriteError(
        "authorization-required",
        "Authorize Twitch follow access with the same Twitch account, then try again."
      );
    }
    try {
      await this.dependencies.writeTwitchAccountFollow({
        action,
        channelId: target.channelId,
        credential,
      });
    } catch (error) {
      if (error instanceof TwitchFollowWriteError && error.code === "authorization-required") {
        this.dependencies.clearCredential();
      }
      throw error;
    }

    let authoritativeChannels: UnifiedChannel[];
    try {
      authoritativeChannels = await this.dependencies.getAllFollowedChannels();
    } catch {
      throw new TwitchFollowWriteError(
        "transient",
        "Twitch could not confirm the follow change. Try again."
      );
    }
    const authoritativeFollows = authoritativeChannels.map((channel): TwitchFollowInput => ({
      platform: "twitch",
      channelId: channel.id,
      channelName: channel.username,
      displayName: channel.displayName,
      profileImage: channel.avatarUrl,
    }));
    this.dependencies.storage.upsertSyncedFollows("twitch", authoritativeFollows, {
      pruneAbsent: true,
    });

    const isFollowed = authoritativeChannels.some((channel) => channel.id === target.channelId);
    if (isFollowed !== (action === "follow")) {
      throw new TwitchFollowWriteError(
        "transient",
        "Twitch could not confirm the follow change. Try again."
      );
    }

    return {
      status: "confirmed",
      activeFollows: this.dependencies.storage.getActiveFollowsByPlatform("twitch"),
    };
  }
}

export function createTwitchFollowWriteService(
  dependencies: Partial<TwitchFollowWriteServiceDependencies> = {}
): TwitchFollowWriteService {
  return new TwitchFollowWriteService({
    storage: storageService,
    getCredential: () => twitchFollowWriteCredentialService.getCredential(),
    clearCredential: () => twitchFollowWriteCredentialService.clearCredential(),
    getCurrentUser: () => twitchClient.getUser(),
    writeTwitchAccountFollow,
    getAllFollowedChannels: () => twitchClient.getAllFollowedChannels(),
    ...dependencies,
  });
}

export const twitchFollowWriteService = createTwitchFollowWriteService();

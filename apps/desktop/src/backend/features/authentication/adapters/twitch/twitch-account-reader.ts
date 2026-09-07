import type { TwitchHelixRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import type {
  PaginatedResult,
  PaginationOptions,
} from "@backend/api/platforms/twitch/twitch-types";
import type { TwitchUser } from "@shared/auth-types";
import type { UnifiedChannel } from "@shared/platform-types";
import type {
  AccountFollowReader,
  AccountFollowReadResult,
  FollowedChannelReader,
} from "@streamfusion/core/follows";
import * as UserEndpoints from "./account-endpoints";

export class TwitchAccountReader
  implements
    AccountFollowReader<"twitch", UnifiedChannel>,
    FollowedChannelReader<"twitch", UnifiedChannel>
{
  readonly platform = "twitch" as const;
  constructor(private readonly requestor: TwitchHelixRequestPort) {}
  async getUser(): Promise<TwitchUser | null> {
    return UserEndpoints.getUser(this.requestor);
  }

  async getFollowedChannels(
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedChannel>> {
    return UserEndpoints.getFollowedChannels(this.requestor, options);
  }

  async getAllFollowedChannels(): Promise<UnifiedChannel[]> {
    return UserEndpoints.getAllFollowedChannels(this.requestor);
  }

  async readAccountFollows(): Promise<AccountFollowReadResult<UnifiedChannel>> {
    try {
      return {
        kind: "available",
        follows: await this.getAllFollowedChannels(),
        authoritative: true,
      };
    } catch (error) {
      return {
        kind: "unavailable",
        reason: error instanceof Error ? error.message : "twitch-follow-fetch-failed",
      };
    }
  }
}

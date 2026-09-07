import {
  type PaginatedResult,
  type PaginationOptions,
} from "@backend/api/platforms/kick/kick-types";
import * as FollowEndpoints from "@backend/features/authentication/adapters/kick/follow-endpoints";
import type { KickUser } from "@shared/auth-types";
import type { UnifiedChannel } from "@shared/platform-types";
import type {
  AccountFollowReader,
  AccountFollowReadOptions,
  AccountFollowReadResult,
  FollowedChannelReader,
} from "@streamfusion/core/follows";
import * as UserEndpoints from "./account-endpoints";

export class KickAccountReader
  implements
    AccountFollowReader<"kick", UnifiedChannel>,
    FollowedChannelReader<"kick", UnifiedChannel>
{
  readonly platform = "kick" as const;
  async getUser(): Promise<KickUser | null> {
    return UserEndpoints.getUser();
  }

  async getFollowedChannels(
    _options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedChannel>> {
    const result = await FollowEndpoints.getAllFollowedChannels();
    return { data: result.status === "ok" ? result.channels : [] };
  }

  async getAllFollowedChannels(): Promise<UnifiedChannel[]> {
    const result = await FollowEndpoints.getAllFollowedChannels();
    return result.status === "ok" ? result.channels : [];
  }

  async readAccountFollows(
    options: AccountFollowReadOptions = {}
  ): Promise<AccountFollowReadResult<UnifiedChannel>> {
    const result = await FollowEndpoints.getAllFollowedChannels({
      allowBrowserWindowFallback: options.allowInteractiveFallback === true,
    });
    return result.status === "ok"
      ? {
          kind: "available",
          follows: result.channels,
          authoritative: result.canPruneAbsent,
        }
      : { kind: "unavailable", reason: result.reason };
  }
}

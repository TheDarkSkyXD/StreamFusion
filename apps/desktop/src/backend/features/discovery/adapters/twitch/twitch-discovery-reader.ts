import * as GqlClient from "@backend/features/discovery/adapters/twitch/twitch-gql-discovery";
import type { TwitchHelixRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import type {
  PaginatedResult,
  PaginationOptions,
} from "@backend/api/platforms/twitch/twitch-types";
import { twitchAuthService } from "@backend/features/authentication/adapters/twitch/twitch-auth";
import * as StreamEndpoints from "@backend/features/discovery/adapters/twitch/stream-endpoints";
import * as UserEndpoints from "@backend/features/discovery/adapters/twitch/user-endpoints";
import { logger } from "@backend/logging/logger";
import type { TwitchUser } from "@shared/auth-types";
import type { UnifiedCategory, UnifiedChannel, UnifiedStream } from "@shared/platform-types";
import type {
  CategoryReader,
  CategoryStreamReader,
  CategoryStreamsOptions,
  ChannelReader,
  ChannelRef,
  ChannelSearchOptions,
  DiscoverySearchOptions,
  DiscoverySearchReader,
  DiscoverySearchResult,
  IPlatformReader,
  PageOptions,
  PageResult,
  TopStreamsOptions,
} from "@streamfusion/core/discovery";
import { Platform } from "@streamfusion/core/platform";

export type TwitchFollowedStreamAccess =
  { kind: "guest" } | { kind: "ready" } | { kind: "unavailable" };
const TWITCH_STREAM_LANGUAGES: ReadonlySet<string> = new Set([
  "ar",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "fi",
  "fr",
  "he",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pl",
  "pt",
  "ru",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh",
]);
function mergeCategoryViewerCounts(
  result: PaginatedResult<UnifiedCategory>,
  countsById: Record<string, number>
): PaginatedResult<UnifiedCategory> {
  return {
    ...result,
    data: result.data.map((category) => {
      const viewerCount = countsById[category.id];
      return viewerCount === undefined ? category : { ...category, viewerCount };
    }),
  };
}

function toTwitchPageOptions(options: PageOptions | PaginationOptions): PaginationOptions {
  const first = "limit" in options ? options.limit : "first" in options ? options.first : undefined;
  const after =
    "cursor" in options ? options.cursor : "after" in options ? options.after : undefined;
  return {
    ...(first === undefined ? {} : { first }),
    ...(after === undefined ? {} : { after }),
  };
}

function toTwitchChannelSearchOptions(
  options: ChannelSearchOptions | (PaginationOptions & { liveOnly?: boolean })
): PaginationOptions & { liveOnly?: boolean } {
  const page = toTwitchPageOptions(options);
  return {
    ...page,
    ...(options.liveOnly === undefined ? {} : { liveOnly: options.liveOnly }),
  };
}

export class TwitchDiscovery
  implements
    IPlatformReader<UnifiedStream>,
    ChannelReader<Platform, UnifiedChannel, ChannelRef>,
    CategoryReader<Platform, UnifiedCategory>,
    CategoryStreamReader<Platform, UnifiedStream>,
    DiscoverySearchReader<Platform, UnifiedStream, UnifiedChannel, UnifiedCategory, AbortSignal>
{
  readonly platform = "twitch" as const;
  constructor(private readonly requestor: TwitchHelixRequestPort) {}
  isAuthenticated(): boolean {
    return twitchAuthService.isAuthenticated();
  }

  async getFollowedStreamAccess(): Promise<TwitchFollowedStreamAccess> {
    if (!this.isAuthenticated()) return { kind: "guest" };

    const accessToken = await twitchAuthService.getValidAccessToken();
    return accessToken ? { kind: "ready" } : { kind: "unavailable" };
  }

  async getUsersById(ids: string[]): Promise<TwitchUser[]> {
    return UserEndpoints.getUsersById(this.requestor, ids);
  }

  async getUsersByLogin(logins: string[]): Promise<TwitchUser[]> {
    return UserEndpoints.getUsersByLogin(this.requestor, logins);
  }

  async getFollowerCounts(userIds: string[]): Promise<Map<string, number>> {
    return UserEndpoints.getFollowerCounts(this.requestor, userIds);
  }

  async getFollowedStreams(
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedStream>> {
    return StreamEndpoints.getFollowedStreams(this.requestor, options);
  }

  async getStreamsByLogins(logins: string[]): Promise<PaginatedResult<UnifiedStream>> {
    try {
      const streams = await GqlClient.gqlGetStreamsByLogins(logins);
      return { data: streams };
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getStreamsByLogins failed", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  async getTopStreams(
    options: (PaginationOptions & { gameId?: string; language?: string }) | TopStreamsOptions = {}
  ): Promise<PageResult<UnifiedStream>> {
    const requestedLanguage = options.language?.trim().toLowerCase();
    if (requestedLanguage && !TWITCH_STREAM_LANGUAGES.has(requestedLanguage)) {
      return { data: [] };
    }
    const normalized: PaginationOptions & { gameId?: string; language?: string } = {
      first: "first" in options ? options.first : (options as TopStreamsOptions).limit,
      after: "after" in options ? options.after : (options as TopStreamsOptions).cursor,
      gameId: "gameId" in options ? options.gameId : (options as TopStreamsOptions).categoryId,
      language: requestedLanguage,
    };
    try {
      return await GqlClient.gqlGetTopStreams(normalized);
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getTopStreams failed, falling back to Helix", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return StreamEndpoints.getTopStreams(this.requestor, normalized);
    }
  }

  async getStreamsByCategory(
    categoryId: string,
    options: CategoryStreamsOptions = {}
  ): Promise<PageResult<UnifiedStream>> {
    return this.getTopStreams({
      categoryId,
      limit: options.limit,
      cursor: options.cursor,
      language: options.language,
    });
  }

  async getStreamByLogin(login: string): Promise<UnifiedStream | null> {
    try {
      return await GqlClient.gqlGetStreamByLogin(login);
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getStreamByLogin failed, falling back to Helix", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return StreamEndpoints.getStreamByLogin(this.requestor, login);
    }
  }

  async getChannelByLogin(login: string): Promise<UnifiedChannel | null> {
    return GqlClient.gqlGetChannelByLogin(login);
  }

  async getChannelsById(ids: string[]): Promise<UnifiedChannel[]> {
    // GQL doesn't support lookup by ID directly for channels;
    // This is only used in the getFollowedChannels flow which is auth-gated.
    const ChannelEndpoints =
      await import("@backend/features/discovery/adapters/twitch/channel-endpoints");
    return ChannelEndpoints.getChannelsById(this.requestor, ids);
  }

  async resolveChannel(ref: ChannelRef): Promise<UnifiedChannel | null> {
    if (ref.kind === "slug") return this.getChannelByLogin(ref.value);
    return (await this.getChannelsById([ref.value]))[0] ?? null;
  }

  async searchChannels(
    query: string,
    options: ChannelSearchOptions | (PaginationOptions & { liveOnly?: boolean }) = {}
  ): Promise<PaginatedResult<UnifiedChannel>> {
    const normalized = toTwitchChannelSearchOptions(options);
    if (this.isAuthenticated()) {
      try {
        const SearchEndpoints =
          await import("@backend/features/discovery/adapters/twitch/search-endpoints");
        return await SearchEndpoints.searchChannels(this.requestor, query, normalized);
      } catch (error) {
        logger.warn("Twitch:Client", "Helix searchChannels failed, falling back to GQL", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
      }
    }

    return GqlClient.gqlSearchChannels(query, normalized);
  }

  async getTopCategories(
    options: PageOptions | PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedCategory>> {
    const normalized = toTwitchPageOptions(options);
    try {
      return await GqlClient.gqlGetTopCategories(normalized);
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getTopCategories failed, falling back to Helix", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      const CategoryEndpoints =
        await import("@backend/features/discovery/adapters/twitch/category-endpoints");
      return CategoryEndpoints.getTopCategories(this.requestor, normalized);
    }
  }

  async getAllTopCategories(): Promise<UnifiedCategory[]> {
    try {
      return await GqlClient.gqlGetAllTopCategories();
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getAllTopCategories failed, falling back to Helix", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      const CategoryEndpoints =
        await import("@backend/features/discovery/adapters/twitch/category-endpoints");
      return CategoryEndpoints.getAllTopCategories(this.requestor);
    }
  }

  async getAllCategories(): Promise<UnifiedCategory[]> {
    return this.getAllTopCategories();
  }

  async searchCategories(
    query: string,
    options: PageOptions | PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedCategory>> {
    const normalized = toTwitchPageOptions(options);
    if (this.isAuthenticated()) {
      const SearchEndpoints =
        await import("@backend/features/discovery/adapters/twitch/search-endpoints");
      let helixResult: PaginatedResult<UnifiedCategory>;
      try {
        helixResult = await SearchEndpoints.searchCategories(this.requestor, query, normalized);
      } catch (error) {
        logger.warn("Twitch:Client", "Helix searchCategories failed, falling back to GQL", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return GqlClient.gqlSearchCategories(query, normalized);
      }

      try {
        const countsById = await GqlClient.gqlGetCategoryViewerCountsByIds(
          helixResult.data.map((category) => category.id)
        );
        return mergeCategoryViewerCounts(helixResult, countsById);
      } catch (error) {
        logger.warn("Twitch:Client", "GQL category viewer count hydration failed", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return helixResult;
      }
    }

    return GqlClient.gqlSearchCategories(query, normalized);
  }

  async getCategoryById(id: string): Promise<UnifiedCategory | null> {
    try {
      return await GqlClient.gqlGetCategoryById(id);
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getCategoryById failed, falling back to Helix", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      const CategoryEndpoints =
        await import("@backend/features/discovery/adapters/twitch/category-endpoints");
      return CategoryEndpoints.getCategoryById(this.requestor, id);
    }
  }

  async searchDiscovery(
    query: string,
    options: DiscoverySearchOptions<UnifiedChannel, AbortSignal> = {}
  ): Promise<DiscoverySearchResult<UnifiedStream, UnifiedChannel, UnifiedCategory>> {
    const channels = options.channelSeeds
      ? { data: options.channelSeeds }
      : await this.searchChannels(query, { limit: options.limit, liveOnly: false });
    const categories =
      options.includeCategories === false
        ? { data: [] }
        : await this.searchCategories(query, { limit: options.limit });
    return {
      channels: channels.data,
      categories: categories.data,
      streams: [],
    };
  }

  async getCategoriesByIds(ids: string[]): Promise<UnifiedCategory[]> {
    const CategoryEndpoints =
      await import("@backend/features/discovery/adapters/twitch/category-endpoints");
    return CategoryEndpoints.getCategoriesByIds(this.requestor, ids);
  }

  async isChannelLive(login: string): Promise<boolean> {
    return GqlClient.gqlIsChannelLive(login);
  }

  async getFollowerCount(login: string): Promise<number | null> {
    return GqlClient.gqlGetFollowerCount(login);
  }
}

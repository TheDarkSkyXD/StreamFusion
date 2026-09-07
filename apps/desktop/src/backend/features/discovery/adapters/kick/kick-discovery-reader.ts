import type { KickRequestor } from "@backend/api/platforms/kick/kick-requestor";
import {
  type KickApiUser,
  type PaginatedResult,
  type PaginationOptions,
} from "@backend/api/platforms/kick/kick-types";
import * as CategoryEndpoints from "@backend/features/discovery/adapters/kick/category-endpoints";
import * as ChannelEndpoints from "@backend/features/discovery/adapters/kick/channel-endpoints";
import * as SearchEndpoints from "@backend/features/discovery/adapters/kick/search-endpoints";
import * as StreamEndpoints from "@backend/features/discovery/adapters/kick/stream-endpoints";
import * as UserEndpoints from "@backend/features/discovery/adapters/kick/user-endpoints";
import type { UnifiedCategory, UnifiedChannel, UnifiedStream } from "@shared/platform-types";
import type {
  CategoryReader,
  CategoryStreamReader,
  CategoryStreamsOptions,
  ChannelLookupOptions,
  ChannelReader,
  ChannelRef,
  DiscoverySearchOptions,
  DiscoverySearchReader,
  DiscoverySearchResult,
  IPlatformReader,
  PageResult,
  TopStreamsOptions,
} from "@streamfusion/core/discovery";
import { Platform } from "@streamfusion/core/platform";

export class KickDiscovery
  implements
    IPlatformReader<UnifiedStream>,
    ChannelReader<Platform, UnifiedChannel, ChannelRef>,
    CategoryReader<Platform, UnifiedCategory>,
    CategoryStreamReader<Platform, UnifiedStream>,
    DiscoverySearchReader<Platform, UnifiedStream, UnifiedChannel, UnifiedCategory, AbortSignal>
{
  readonly platform = "kick" as const;
  constructor(private readonly requestor: KickRequestor) {}
  isAuthenticated(): boolean {
    return this.requestor.isAuthenticated();
  }

  async getUsersById(ids: number[]): Promise<KickApiUser[]> {
    return UserEndpoints.getUsersById(this.requestor, ids);
  }

  async getUsersByIdStrict(ids: number[]): Promise<KickApiUser[]> {
    return UserEndpoints.getUsersByIdStrict(this.requestor, ids);
  }

  async getPublicChannelUserProfile(
    channelSlug: string,
    username: string
  ): Promise<UserEndpoints.KickPublicChannelUserProfile | null> {
    return UserEndpoints.getPublicChannelUserProfile(channelSlug, username);
  }

  async getPublicChannelUserProfiles(
    requests: Array<{ channelSlug: string; username: string }>
  ): Promise<
    Array<{
      channelSlug: string;
      profile: UserEndpoints.KickPublicChannelUserProfile | null;
    }>
  > {
    return UserEndpoints.getPublicChannelUserProfiles(requests);
  }

  async getChannel(
    slug: string,
    options?: { freshChatroomSettings?: boolean }
  ): Promise<UnifiedChannel | null> {
    return options
      ? ChannelEndpoints.getChannel(this.requestor, slug, options)
      : ChannelEndpoints.getChannel(this.requestor, slug);
  }

  async resolveChannel(
    ref: ChannelRef,
    options: ChannelLookupOptions = {}
  ): Promise<UnifiedChannel | null> {
    return options.freshness === "refresh"
      ? this.getChannel(ref.value, { freshChatroomSettings: true })
      : this.getChannel(ref.value);
  }

  async getOfficialChannelAccountStatus(slug: string) {
    return ChannelEndpoints.getOfficialKickChannelAccountStatus(this.requestor, slug);
  }

  async getChannelsBySlugs(slugs: string[]): Promise<UnifiedChannel[]> {
    return ChannelEndpoints.getChannelsBySlugs(this.requestor, slugs);
  }

  async getChannelsByBroadcasterIds(broadcasterUserIds: number[]): Promise<UnifiedChannel[]> {
    return ChannelEndpoints.getChannelsByBroadcasterIds(this.requestor, broadcasterUserIds);
  }

  async getPublicChannel(slug: string): Promise<UnifiedChannel | null> {
    return ChannelEndpoints.getPublicChannel(slug);
  }

  async searchChannels(
    query: string,
    options: SearchEndpoints.ChannelSearchOptions = {}
  ): Promise<PaginatedResult<UnifiedChannel>> {
    return SearchEndpoints.searchChannels(this.requestor, query, options);
  }

  async getStreamBySlug(
    slug: string,
    options: { freshStatus?: boolean } = {}
  ): Promise<UnifiedStream | null> {
    return StreamEndpoints.getStreamBySlug(this.requestor, slug, options);
  }

  async getStreamsByBroadcasterIds(broadcasterUserIds: number[]): Promise<UnifiedStream[]> {
    return StreamEndpoints.getStreamsByBroadcasterIds(this.requestor, broadcasterUserIds);
  }

  async getPublicStreamBySlug(
    slug: string,
    staggerOffsetMs?: number,
    signal?: AbortSignal
  ): Promise<UnifiedStream | null> {
    return StreamEndpoints.getPublicStreamBySlug(slug, staggerOffsetMs, signal);
  }

  async getTopStreams(options: TopStreamsOptions = {}): Promise<PageResult<UnifiedStream>> {
    const result = await StreamEndpoints.getTopStreams(this.requestor, options);
    return { data: result.data, cursor: result.cursor };
  }

  async getPublicTopStreams(
    options: PaginationOptions & { categoryId?: string; language?: string } = {}
  ): Promise<PaginatedResult<UnifiedStream>> {
    return StreamEndpoints.getPublicTopStreams(options);
  }

  async getStreamsByCategory(
    categoryId: string,
    options: CategoryStreamsOptions = {}
  ): Promise<PaginatedResult<UnifiedStream>> {
    return StreamEndpoints.getStreamsByCategory(this.requestor, categoryId, options);
  }

  async getFollowedStreams(
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedStream>> {
    return StreamEndpoints.getFollowedStreams(this.requestor, options);
  }

  async getTopCategories(
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedCategory>> {
    return CategoryEndpoints.getTopCategories(this.requestor, options);
  }

  async searchCategories(
    query: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedCategory>> {
    return CategoryEndpoints.searchCategories(this.requestor, query, options);
  }

  async getCategoryById(id: string): Promise<UnifiedCategory | null> {
    return CategoryEndpoints.getCategoryById(this.requestor, id);
  }

  async getAllCategories(): Promise<UnifiedCategory[]> {
    return CategoryEndpoints.getAllCategories(this.requestor);
  }

  async search(
    query: string,
    options: { channelSeeds?: UnifiedChannel[]; signal?: AbortSignal } = {}
  ): Promise<Awaited<ReturnType<typeof SearchEndpoints.search>>> {
    return SearchEndpoints.search(this.requestor, query, options);
  }

  async searchDiscovery(
    query: string,
    options: DiscoverySearchOptions<UnifiedChannel, AbortSignal> = {}
  ): Promise<DiscoverySearchResult<UnifiedStream, UnifiedChannel, UnifiedCategory>> {
    if (options.includeCategories === false) {
      const channels = options.channelSeeds
        ? [...options.channelSeeds]
        : (await this.searchChannels(query, { limit: options.limit })).data;
      return { channels, categories: [], streams: [] };
    }

    const result = await this.search(query, {
      ...(options.channelSeeds ? { channelSeeds: [...options.channelSeeds] } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return {
      channels: result.channels,
      categories: result.categories,
      streams: result.streams,
    };
  }
}

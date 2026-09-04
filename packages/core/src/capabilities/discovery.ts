export interface DiscoveryCancellationSignal {
  readonly aborted: boolean;
}

export interface DiscoveryPageRequest {
  readonly query: string;
  readonly cursor?: string;
  readonly limit: number;
  readonly signal?: DiscoveryCancellationSignal;
}

export type DiscoveryPageResult<TItem> =
  | {
      readonly kind: "success";
      readonly items: readonly TItem[];
      readonly cursor?: string;
    }
  | {
      readonly kind: "rate-limited";
      readonly items: readonly TItem[];
      readonly retryAfterMs?: number;
    }
  | {
      readonly kind: "failure";
      readonly error: unknown;
    };

export interface DiscoveryPageSource<TItem> {
  loadPage(request: DiscoveryPageRequest): Promise<DiscoveryPageResult<TItem>>;
}

export interface PageOptions {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface PageResult<TItem> {
  readonly data: TItem[];
  readonly cursor?: string;
}

export interface TopStreamsOptions extends PageOptions {
  readonly categoryId?: string;
  readonly language?: string;
}

export interface TopStreamReader<TPlatform, TStream> {
  readonly platform: TPlatform;
  isAuthenticated(): boolean;
  getTopStreams(options?: TopStreamsOptions): Promise<PageResult<TStream>>;
}

export interface ChannelLookupOptions {
  readonly freshness?: "default" | "refresh";
}

export interface ChannelSearchOptions extends PageOptions {
  readonly liveOnly?: boolean;
}

export interface ChannelReader<TPlatform, TChannel, TChannelRef> {
  readonly platform: TPlatform;
  resolveChannel(
    ref: TChannelRef,
    options?: ChannelLookupOptions,
  ): Promise<TChannel | null>;
  searchChannels(
    query: string,
    options?: ChannelSearchOptions,
  ): Promise<PageResult<TChannel>>;
}

export interface CategoryReader<TPlatform, TCategory> {
  readonly platform: TPlatform;
  getTopCategories(options?: PageOptions): Promise<PageResult<TCategory>>;
  getAllCategories(): Promise<TCategory[]>;
  getCategoryById(id: string): Promise<TCategory | null>;
  searchCategories(
    query: string,
    options?: PageOptions,
  ): Promise<PageResult<TCategory>>;
}

export interface CategoryStreamsOptions extends PageOptions {
  readonly categoryName?: string;
  readonly language?: string;
}

export interface CategoryStreamReader<TPlatform, TStream> {
  readonly platform: TPlatform;
  getStreamsByCategory(
    categoryId: string,
    options?: CategoryStreamsOptions,
  ): Promise<PageResult<TStream>>;
}

export interface DiscoverySearchOptions<TChannel, TSignal> {
  readonly channelSeeds?: readonly TChannel[];
  readonly includeCategories?: boolean;
  readonly limit?: number;
  readonly signal?: TSignal;
}

export interface DiscoverySearchResult<TStream, TChannel, TCategory> {
  readonly streams: readonly TStream[];
  readonly channels: readonly TChannel[];
  readonly categories: readonly TCategory[];
}

export interface DiscoverySearchReader<
  TPlatform,
  TStream,
  TChannel,
  TCategory,
  TSignal,
> {
  readonly platform: TPlatform;
  searchDiscovery(
    query: string,
    options?: DiscoverySearchOptions<TChannel, TSignal>,
  ): Promise<DiscoverySearchResult<TStream, TChannel, TCategory>>;
}

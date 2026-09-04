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

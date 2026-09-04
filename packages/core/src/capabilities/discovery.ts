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

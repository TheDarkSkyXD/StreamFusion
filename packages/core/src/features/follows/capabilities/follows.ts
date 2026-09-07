export interface AccountFollowReadOptions {
  readonly allowInteractiveFallback?: boolean;
}

export type AccountFollowReadResult<TFollow> =
  | {
      readonly kind: "available";
      readonly follows: readonly TFollow[];
      readonly authoritative: boolean;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: string;
    };

export interface AccountFollowReader<TPlatform extends string, TFollow> {
  readonly platform: TPlatform;
  readAccountFollows(
    options?: AccountFollowReadOptions,
  ): Promise<AccountFollowReadResult<TFollow>>;
}

export interface FollowedChannelReader<TPlatform extends string, TChannel> {
  readonly platform: TPlatform;
  getAllFollowedChannels(): Promise<TChannel[]>;
}

export interface FollowedStreamReader<
  TPlatform extends string,
  TStream,
  TOptions,
> {
  readonly platform: TPlatform;
  getFollowedStreams(options?: TOptions): Promise<{
    readonly data: TStream[];
    readonly cursor?: string;
  }>;
}

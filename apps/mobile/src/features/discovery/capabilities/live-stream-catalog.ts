import type { Channel, Stream } from "@streamfusion/core/content";

export type LiveStreamCatalogEntry = {
  readonly stream: Stream;
  readonly channel: Channel;
  readonly playbackUrl: string | null;
};

export type LiveStreamCatalogRead =
  | {
      readonly kind: "ready";
      readonly entries: readonly LiveStreamCatalogEntry[];
    }
  | {
      readonly kind: "unavailable";
      readonly failure:
        | { readonly kind: "cancelled" }
        | { readonly kind: "offline" }
        | { readonly kind: "invalid-response" }
        | { readonly kind: "provider-rejected"; readonly status: number };
    };

export interface LiveStreamCatalog {
  read(input: {
    readonly signal?: AbortSignal;
  }): Promise<LiveStreamCatalogRead>;
}

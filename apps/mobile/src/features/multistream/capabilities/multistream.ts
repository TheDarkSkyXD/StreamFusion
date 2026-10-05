import type { Platform } from "@streamfusion/core/platform";
import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";
import type { MultistreamResourcePressure } from "./resource-admission";

export type MultistreamTile = {
  readonly id: string;
  readonly target: WatchTarget;
  readonly state: "buffering" | "playing" | "paused" | "failed";
  readonly detail: string | null;
};
export type MultistreamSnapshot = {
  readonly tiles: readonly MultistreamTile[];
  readonly audioOwner: string | null;
  readonly busy: boolean;
  readonly limit: number;
  readonly status: string | null;
  readonly resourcePressure: MultistreamResourcePressure;
};
export interface MultistreamChannelReader {
  find(
    platform: Platform,
    login: string,
    signal: AbortSignal,
  ): Promise<WatchTarget | null>;
}
export interface MultistreamSession {
  snapshot(): MultistreamSnapshot;
  subscribe(listener: () => void): () => void;
  add(platform: Platform, login: string): Promise<void>;
  focus(id: string): Promise<void>;
  mute(): Promise<void>;
  remove(id: string): Promise<void>;
  move(id: string, direction: "earlier" | "later"): void;
  pause(id: string, paused: boolean): Promise<void>;
  recheckResources(): Promise<void>;
  reduceToOne(): Promise<void>;
  close(): Promise<void>;
  dispose(): Promise<void>;
}

import type { KickCallbackInput } from "@streamfusion/core/auth";

export type KickFixtureCallbackKind =
  | "accepted"
  | "denied"
  | "expired"
  | "stale"
  | "duplicate"
  | "state-mismatch"
  | "wrong-redirect"
  | "superseded";

export interface KickCallbackSource {
  subscribe(listener: (input: KickCallbackInput) => void): () => void;
}

export interface KickFixtureInjector {
  inject(
    kind: KickFixtureCallbackKind,
    attempt: { readonly state: string } | null,
  ): KickCallbackInput;
}

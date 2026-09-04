export type RuntimeLayer = "transport" | "persistence";

export type RuntimeLayerState =
  | { readonly kind: "ready"; readonly layer: RuntimeLayer }
  | {
      readonly kind: "unavailable";
      readonly layer: RuntimeLayer;
      readonly reason: string;
    };

export interface RuntimeProbe {
  check(): RuntimeLayerState;
}

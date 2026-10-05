export type MultistreamResourcePressure =
  | { readonly kind: "clear" }
  | { readonly kind: "unavailable"; readonly detail: string }
  | { readonly kind: "pressured"; readonly detail: string };

export interface MultistreamResourceAdmission {
  read(): Promise<MultistreamResourcePressure>;
}

export interface MultistreamResourceMonitor {
  subscribe(recheck: () => Promise<void>): () => void;
  dispose(): void;
}

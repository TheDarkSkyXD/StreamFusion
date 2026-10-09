export type UpdateRelease = {
  readonly tag: string;
  readonly version: string;
  readonly apkBytes: number;
  readonly apkSha256: string;
  readonly notes: string;
  readonly releaseUrl: string;
};

export type UpdateFailure =
  | "network"
  | "storage"
  | "metadata"
  | "checksum"
  | "signature"
  | "package"
  | "version"
  | "sdk"
  | "install-blocked"
  | "install-failed"
  | "interrupted";

export type ActiveUpdate = {
  readonly operation: string;
  readonly release: UpdateRelease;
};

export type InstallerFailureDetail = {
  readonly status: number;
  readonly message: string;
};

export type UpdatePhase =
  | { readonly kind: "idle" }
  | { readonly kind: "unsupported"; readonly message: string }
  | (ActiveUpdate & { readonly kind: "downloading"; readonly bytes: number; readonly total: number })
  | (ActiveUpdate & { readonly kind: "paused"; readonly bytes: number; readonly reason: "network" | "service-limit" | "process-interrupted" })
  | (ActiveUpdate & { readonly kind: "verifying" | "ready" | "permission-needed" | "staging" | "awaiting-approval" })
  | (ActiveUpdate & { readonly kind: "installed" | "canceled" })
  | (ActiveUpdate & { readonly kind: "failed"; readonly code: UpdateFailure; readonly retry: "download" | "install" | "none"; readonly installerFailure: InstallerFailureDetail | null });

export type UpdateSnapshot = {
  readonly revision: number;
  readonly phase: UpdatePhase;
};

export type NativeUpdateCommand =
  | { readonly kind: "download"; readonly release: UpdateRelease }
  | { readonly kind: "cancel" | "retry" | "install"; readonly operation: string };

export interface AndroidUpdaterPort {
  snapshot(): Promise<UpdateSnapshot>;
  command(command: NativeUpdateCommand): Promise<UpdateSnapshot>;
  subscribe(listener: () => void): () => void;
}

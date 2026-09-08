import type {
  ActivityRepository,
  PersistenceRuntimeState,
} from "@mobile/features/storage/capabilities/persistence";

export type DevelopmentActivityProofMainBaseline = Readonly<{
  count: number;
  digest: string;
}>;

export type DevelopmentActivityProofPhase =
  "initializing" | "active" | "cleanup";

export type DevelopmentActivityProofSession = Readonly<{
  mainActivity: DevelopmentActivityProofMainBaseline;
  namespace: string;
  phase: DevelopmentActivityProofPhase;
  version: 1;
}>;

export type DevelopmentActivityProofSessionRead =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "session"; session: DevelopmentActivityProofSession }>;

export interface DevelopmentActivityProofSessionPort {
  clear(): Promise<void>;
  read(): Promise<DevelopmentActivityProofSessionRead>;
  write(session: DevelopmentActivityProofSession): Promise<void>;
}

export interface DevelopmentActivityProofStore {
  readonly activity: ActivityRepository;
  cleanup(): Promise<void>;
  close(): Promise<void>;
  initialize(): Promise<PersistenceRuntimeState>;
}

export interface DevelopmentActivityProofStoreFactory {
  open(namespace: string): DevelopmentActivityProofStore;
}

export interface DevelopmentActivityReadFailurePort {
  deactivate(): void;
  drain(): Promise<void>;
  queueNextListFailure(): { readonly kind: "queued" };
  readonly repository: ActivityRepository;
}

export type DevelopmentActivityProofViewModel =
  | Readonly<{ detail: string; kind: "main" }>
  | Readonly<{ detail: string; kind: "proof"; namespace: string }>
  | Readonly<{ detail: string; kind: "unavailable" }>
  | Readonly<{
      detail: string;
      kind: "cleanup-required";
      namespace: string;
      selected: boolean;
    }>;

export interface DevelopmentActivityProof {
  exit(): Promise<void>;
  recover(): Promise<void>;
  replayCompleted(): Promise<void>;
  readonly repository: ActivityRepository;
  retryCleanup(): Promise<void>;
  start(): Promise<void>;
  subscribe(
    listener: (model: DevelopmentActivityProofViewModel) => void,
  ): () => void;
  queueNextReadFailure(): void;
  snapshot(): DevelopmentActivityProofViewModel;
}

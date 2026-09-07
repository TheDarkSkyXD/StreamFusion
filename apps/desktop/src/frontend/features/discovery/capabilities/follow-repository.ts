import type {
  AccountFollowWriteRequest,
  AccountFollowWriteResult,
  KickAccountFollowWriteChangedEvent,
  KickAccountFollowWriteSnapshot,
  LocalFollow,
} from "@shared/auth-types";

export interface FollowRepository {
  getAll(): Promise<LocalFollow[]>;
  add(follow: Omit<LocalFollow, "id" | "followedAt">): Promise<LocalFollow>;
  remove(id: string): Promise<boolean>;
  getAccountWrites(): Promise<KickAccountFollowWriteSnapshot[]>;
  writeAccount(request: AccountFollowWriteRequest): Promise<AccountFollowWriteResult>;
  onAccountWriteChanged(callback: (event: KickAccountFollowWriteChangedEvent) => void): () => void;
}

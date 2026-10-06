import type { ModerationChannel } from "./moderation";

export type ModerationLogEntry = {
  readonly id: string;
  readonly at: number;
  readonly channel: ModerationChannel;
  readonly actorId: string;
  readonly userId: string | null;
  readonly action: string;
  readonly detail: string;
  readonly source: "app-issued" | "app-observed";
  readonly outcome: "submitted" | "confirmed" | "rejected" | "uncertain";
};
export type ModerationLog = {
  readonly retentionDays: number;
  readonly startedAt: number;
  readonly entries: readonly ModerationLogEntry[];
};
export interface ModerationLogRepository {
  read(channel: ModerationChannel, actorId: string): Promise<ModerationLog>;
  record(entry: ModerationLogEntry): Promise<void>;
  setRetention(
    channel: ModerationChannel,
    actorId: string,
    days: number,
  ): Promise<void>;
}

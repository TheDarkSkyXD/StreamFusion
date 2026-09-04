/**
 * Mod-Log Shared Types
 *
 * Shapes for mod-log entries, query filters, and retention scopes. Mirrors the
 * database-service definitions so the renderer can speak the same vocabulary
 * over IPC without statically importing `database-service.ts` (which would
 * pull `better-sqlite3` into the renderer bundle).
 */

import { Platform } from "@streamfusion/core/platform";

export type ModLogProvenance =
  | "twitch-eventsub"
  | "twitch-observed"
  | "twitch-helix-current-state"
  | "kick-observed"
  | "streamfusion-confirmed"
  | "legacy-unattributed";

export interface ModLogEntry {
  id?: number;
  /** Null only for rows created before platform provenance was persisted. */
  platform: Platform | null;
  channelId: string;
  channelSlug: string;
  action: string;
  targetUserId: string;
  targetUsername: string;
  moderatorUserId: string;
  moderatorUsername: string;
  durationSeconds?: number | null;
  reason?: string | null;
  provenance: ModLogProvenance;
  providerEventId: string | null;
  occurredAt: number;
  observedAt: number;
  /** @deprecated Compatibility alias for occurredAt. */
  createdAt: number;
}

export interface ModLogQueryFilters {
  platform?: Platform;
  channelId: string;
  channelSlug?: string;
  targetUserId?: string;
  action?: string;
  moderatorUsername?: string;
  limit?: number;
  offset?: number;
}

export type ModLogWriteEntry = Omit<ModLogEntry, "id" | "createdAt"> & {
  /** @deprecated Accepted while older action writers migrate to occurredAt. */
  createdAt?: number;
};

export type ModLogCoverage = "complete" | "partial";

export interface ModLogCoverageRecord {
  platform: Platform;
  channelId: string;
  coverage: ModLogCoverage;
  source: string;
  coverageStartAt: number | null;
  coverageEndAt: number | null;
  observedAt: number;
}

export type ModerationHistoryResult =
  | { state: "loading"; entries: [] }
  | { state: "ready"; entries: ModLogEntry[]; coverage: "complete" }
  | { state: "verified-empty"; entries: []; coverage: "complete" }
  | {
      state: "partial";
      entries: ModLogEntry[];
      coverage: "partial";
      reason: "observation-window" | "provider-limit";
    }
  | {
      state: "error";
      entries: [];
      code: "unauthorized" | "forbidden" | "unverified" | "query-failed";
      retryable: boolean;
    };

export type ModLogInsertResult =
  | { success: true; id: number }
  | {
      success: false;
      code: "forbidden" | "unauthorized" | "unverified" | "invalid-entry" | "write-failed";
      retryable: boolean;
    };

export type RetentionScope = "global" | `channel:${string}`;

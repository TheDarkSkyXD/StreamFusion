import {
  parseGuestFollowWrite,
  type GuestFollow,
} from "@streamfusion/core/follows";
import { toSerializedTimestamp } from "@streamfusion/core/activity";
import type { Platform } from "@streamfusion/core/platform";

import type { StoreDatabase } from "./database-contracts";

interface GuestFollowRow {
  readonly platform: string;
  readonly channel_id: string;
  readonly channel_login: string;
  readonly display_name: string;
  readonly followed_at: number;
}

export class GuestFollowStore {
  constructor(private readonly database: StoreDatabase) {}

  async list(): Promise<readonly GuestFollow[]> {
    const rows = await this.database.query<GuestFollowRow>(
      `SELECT platform, channel_id, channel_login, display_name, followed_at
       FROM guest_follows
       ORDER BY followed_at DESC, platform ASC, channel_id ASC`,
    );
    return rows.flatMap((row) => {
      const follow = followFromRow(row);
      return follow ? [follow] : [];
    });
  }

  async upsert(value: unknown): Promise<GuestFollow> {
    const follow = parseGuestFollowWrite(value);
    if (!follow) throw new RangeError("Guest Follow write is invalid.");
    await this.database.run(
      `INSERT INTO guest_follows (
         platform, channel_id, channel_login, display_name, followed_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(platform, channel_id) DO UPDATE SET
         channel_login = excluded.channel_login,
         display_name = excluded.display_name`,
      [
        follow.platform,
        follow.channelId,
        follow.channelLogin,
        follow.displayName,
        Date.parse(follow.followedAt),
      ],
    );
    const stored = await this.read(follow.platform, follow.channelId);
    if (!stored) throw new Error("Guest Follow upsert did not persist.");
    return stored;
  }

  async remove(identity: {
    readonly platform: Platform;
    readonly channelId: string;
  }): Promise<void> {
    await this.database.run(
      "DELETE FROM guest_follows WHERE platform = ? AND channel_id = ?",
      [identity.platform, identity.channelId],
    );
  }

  private async read(
    platform: Platform,
    channelId: string,
  ): Promise<GuestFollow | null> {
    const row = await this.database.first<GuestFollowRow>(
      `SELECT platform, channel_id, channel_login, display_name, followed_at
       FROM guest_follows WHERE platform = ? AND channel_id = ?`,
      [platform, channelId],
    );
    return row ? followFromRow(row) : null;
  }
}

function followFromRow(row: GuestFollowRow): GuestFollow | null {
  const followedAt = timestampFromMs(row.followed_at);
  if (!followedAt) return null;
  return parseGuestFollowWrite({
    platform: row.platform,
    channelId: row.channel_id,
    channelLogin: row.channel_login,
    displayName: row.display_name,
    followedAt,
  });
}

function timestampFromMs(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  try {
    return toSerializedTimestamp(new Date(value).toISOString());
  } catch {
    return null;
  }
}

import { z } from "zod";
import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";
import type { ModerationChannel } from "../capabilities/moderation";
import type {
  ModerationLog,
  ModerationLogRepository,
} from "../capabilities/moderation-log";

const logSchema = z.object({
  retentionDays: z.number().int().min(1).max(365),
  startedAt: z.number().finite(),
  entries: z.array(
    z.object({
      id: z.string(),
      at: z.number().finite(),
      channel: z.object({
        platform: z.enum(["twitch", "kick"]),
        id: z.string(),
        login: z.string(),
        name: z.string(),
      }),
      actorId: z.string(),
      userId: z.string().nullable(),
      action: z.string(),
      detail: z.string(),
      source: z.enum(["app-issued", "app-observed"]),
      outcome: z.enum(["submitted", "confirmed", "rejected", "uncertain"]),
    }),
  ),
});
export function createModerationLogRepository(
  store: ProductSettingsStore,
  now = Date.now,
): ModerationLogRepository {
  let queue: Promise<void> = Promise.resolve();
  const key = (channel: ModerationChannel, actorId: string) =>
    `moderation-log:v1:${channel.platform}:${actorId}:${channel.id}`;
  async function read(
    channel: ModerationChannel,
    actorId: string,
  ): Promise<ModerationLog> {
    const raw = await store.read(key(channel, actorId));
    const empty: ModerationLog = {
      retentionDays: 30,
      startedAt: now(),
      entries: [],
    };
    if (!raw) return empty;
    const parsed = logSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      throw new Error("The local moderation log could not be read.");
    const value = parsed.data;
    const retentionDays = value.retentionDays;
    return {
      retentionDays,
      startedAt: value.startedAt,
      entries: value.entries
        .filter(
          (entry) =>
            entry.channel.id === channel.id &&
            entry.channel.platform === channel.platform &&
            entry.actorId === actorId &&
            entry.at >= now() - retentionDays * 86400000,
        )
        .slice(-1000),
    };
  }
  function change(
    channel: ModerationChannel,
    actorId: string,
    update: (value: ModerationLog) => ModerationLog,
  ): Promise<void> {
    const task = queue.then(async () => {
      const value = update(await read(channel, actorId));
      await store.write(key(channel, actorId), JSON.stringify(value), now());
    });
    queue = task.catch(() => undefined);
    return task;
  }
  return {
    async read(channel, actorId) {
      const task = queue.then(async () => {
        const value = await read(channel, actorId);
        await store.write(key(channel, actorId), JSON.stringify(value), now());
        return value;
      });
      queue = task.then(() => undefined).catch(() => undefined);
      return task;
    },
    record(entry) {
      return change(entry.channel, entry.actorId, (value) => ({
        ...value,
        entries: [
          ...value.entries.filter((item) => item.id !== entry.id),
          entry,
        ]
          .sort((a, b) => a.at - b.at)
          .slice(-1000),
      }));
    },
    setRetention(channel, actorId, days) {
      if (!Number.isInteger(days) || days < 1 || days > 365)
        return Promise.reject(
          new Error("Choose 1 to 365 days of local history."),
        );
      return change(channel, actorId, (value) => ({
        ...value,
        retentionDays: days,
        entries: value.entries.filter(
          (entry) => entry.at >= now() - days * 86400000,
        ),
      }));
    },
  };
}

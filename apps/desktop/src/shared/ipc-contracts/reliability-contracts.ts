import { z } from "zod";

import type { IpcReply, SafeAppError } from "../reliability-types";

export const safeAppErrorSchema = z
  .object({
    code: z.enum([
      "invalid_input",
      "unauthenticated",
      "forbidden",
      "not_found",
      "conflict",
      "rate_limited",
      "transient",
      "timeout",
      "offline",
      "canceled",
      "corrupt_local_data",
      "upstream_schema",
      "internal",
    ]),
    retry: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z.object({ kind: z.literal("manual") }).strict(),
      z.object({ kind: z.literal("after"), retryAtMs: z.number().finite() }).strict(),
    ]),
    diagnosticId: z.string().uuid(),
    platform: z.enum(["twitch", "kick"]).optional(),
  })
  .strict() satisfies z.ZodType<SafeAppError>;

export function ipcReplySchema<T>(value: z.ZodType<T>): z.ZodType<IpcReply<T>> {
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ok"), value }).strict(),
    z.object({ kind: z.literal("error"), error: safeAppErrorSchema }).strict(),
  ]) as z.ZodType<IpcReply<T>>;
}

import { z } from "zod";
import { helixResponseSchema } from "./twitch-helix-schemas";
import type { TwitchHelixRequestPort as TwitchRequestPort } from "./twitch-transport";

export const unknownResponseSchema = helixResponseSchema(z.unknown());

export const emptyResponseSchema = z.null();

export const resolvedUserResponseSchema = helixResponseSchema(
  z.object({ id: z.string(), login: z.string(), display_name: z.string() })
);

export type TwitchResponseSchema<T> = z.ZodType<T>;

export async function requestDecoded<T>(
  requestor: TwitchRequestPort,
  schema: TwitchResponseSchema<T>,
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = options
    ? await requestor.request(endpoint, options)
    : await requestor.request(endpoint);
  return schema.parse(response);
}

export function query(path: string, values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}

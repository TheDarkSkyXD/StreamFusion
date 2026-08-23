import { z } from "zod";

import { IPC_CHANNELS } from "../shared/ipc-channels";
import type {
  AccountCreatedFieldState,
  KickPublicIdentity,
  KickResolvedChannel,
  ProfileFieldState,
  TwitchPublicIdentity,
  TwitchResolvedChannel,
} from "../shared/user-profile-types";

const identifierSchema = z.string().min(1).max(256);
const usernameSchema = z.string().min(1).max(256);

const twitchIdentityRequestSchema = z
  .object({ userId: identifierSchema, username: usernameSchema })
  .strict();
const twitchFollowRequestSchema = z
  .object({ broadcasterId: identifierSchema, userId: identifierSchema, username: usernameSchema })
  .strict();
const twitchChannelRequestSchema = z.object({ username: usernameSchema }).strict();
const kickIdentityRequestSchema = z
  .object({ userId: identifierSchema, username: usernameSchema, channelSlug: usernameSchema })
  .strict();
const kickChannelRequestSchema = z.object({ username: usernameSchema }).strict();

const profileSourceSchema = z.enum(["official", "first-party-fallback", "chat-event"]);
const negativeSourceSchema = z.enum(["official", "first-party-fallback"]);
const publicIdentitySchema = z
  .object({
    userId: z.string(),
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string(),
  })
  .strict();
const resolvedChannelSchema = z
  .object({ id: z.string(), username: z.string(), displayName: z.string() })
  .strict();

function profileFieldStateSchema<T>(valueSchema: z.ZodType<T>) {
  return z.discriminatedUnion("state", [
    z
      .object({ state: z.literal("known"), value: valueSchema, source: profileSourceSchema })
      .strict(),
    z.object({ state: z.literal("negative"), source: negativeSourceSchema }).strict(),
    z
      .object({ state: z.literal("reconnect-required"), missingScopes: z.array(z.string()) })
      .strict(),
    z.object({ state: z.literal("unavailable"), message: z.string() }).strict(),
    z.object({ state: z.literal("failed"), message: z.string() }).strict(),
  ]);
}

const accountCreatedFieldStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("known"), value: z.string(), source: profileSourceSchema }).strict(),
  z.object({ state: z.literal("reconnect-required"), missingScopes: z.array(z.string()) }).strict(),
  z.object({ state: z.literal("unavailable"), message: z.string() }).strict(),
  z.object({ state: z.literal("failed"), message: z.string() }).strict(),
]) satisfies z.ZodType<AccountCreatedFieldState>;

const stringFieldStateSchema = profileFieldStateSchema(z.string()) satisfies z.ZodType<
  ProfileFieldState<string>
>;
const twitchIdentityFieldStateSchema = profileFieldStateSchema(
  publicIdentitySchema
) satisfies z.ZodType<ProfileFieldState<TwitchPublicIdentity>>;
const kickIdentityFieldStateSchema = profileFieldStateSchema(
  publicIdentitySchema
) satisfies z.ZodType<ProfileFieldState<KickPublicIdentity>>;
const twitchChannelFieldStateSchema = profileFieldStateSchema(
  resolvedChannelSchema
) satisfies z.ZodType<ProfileFieldState<TwitchResolvedChannel>>;
const kickChannelFieldStateSchema = profileFieldStateSchema(
  resolvedChannelSchema
) satisfies z.ZodType<ProfileFieldState<KickResolvedChannel>>;

export const userProfileIpcContracts = {
  [IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY]: {
    request: twitchIdentityRequestSchema,
    response: twitchIdentityFieldStateSchema,
  },
  [IPC_CHANNELS.USER_PROFILE_TWITCH_ACCOUNT_CREATED]: {
    request: twitchIdentityRequestSchema,
    response: accountCreatedFieldStateSchema,
  },
  [IPC_CHANNELS.USER_PROFILE_TWITCH_FOLLOW]: {
    request: twitchFollowRequestSchema,
    response: stringFieldStateSchema,
  },
  [IPC_CHANNELS.USER_PROFILE_TWITCH_CHANNEL]: {
    request: twitchChannelRequestSchema,
    response: twitchChannelFieldStateSchema,
  },
  [IPC_CHANNELS.USER_PROFILE_KICK_IDENTITY]: {
    request: kickIdentityRequestSchema,
    response: kickIdentityFieldStateSchema,
  },
  [IPC_CHANNELS.USER_PROFILE_KICK_ACCOUNT_CREATED]: {
    request: kickIdentityRequestSchema,
    response: accountCreatedFieldStateSchema,
  },
  [IPC_CHANNELS.USER_PROFILE_KICK_FOLLOW]: {
    request: kickIdentityRequestSchema,
    response: stringFieldStateSchema,
  },
  [IPC_CHANNELS.USER_PROFILE_KICK_CHANNEL]: {
    request: kickChannelRequestSchema,
    response: kickChannelFieldStateSchema,
  },
} as const;

export type UserProfileChannel = keyof typeof userProfileIpcContracts;
export type UserProfileRequest<Channel extends UserProfileChannel> = z.input<
  (typeof userProfileIpcContracts)[Channel]["request"]
>;
export type UserProfileResponse<Channel extends UserProfileChannel> = z.output<
  (typeof userProfileIpcContracts)[Channel]["response"]
>;

import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import type {
  ModerationChannel,
  ModerationGateway,
} from "../capabilities/moderation";
import { moderationScopes } from "./moderation-controller";

export type WatchModerationRoleReader = {
  readonly read: (
    channel: ModerationChannel,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly subscribe: AuthenticatedPlatformAccess["subscribe"];
};

export async function readWatchModerationRole({
  access,
  gateway,
  channel,
  signal,
}: {
  readonly access: AuthenticatedPlatformAccess;
  readonly gateway: Pick<ModerationGateway, "verify">;
  readonly channel: ModerationChannel;
  readonly signal: AbortSignal;
}): Promise<boolean> {
  try {
    const identity = await access.read(channel.platform);
    if (signal.aborted || identity.kind !== "ready") return false;
    const scopes =
      channel.platform === "twitch" && identity.userId === channel.id
        ? []
        : moderationScopes(channel.platform);
    const credential = await access.read(channel.platform, scopes);
    if (
      signal.aborted ||
      credential.kind !== "ready" ||
      credential.userId !== identity.userId ||
      credential.generation !== identity.generation
    )
      return false;
    const role = await gateway.verify(channel, credential, signal);
    if (signal.aborted || role.kind !== "success") return false;
    const latest = await access.read(channel.platform);
    return (
      !signal.aborted &&
      latest.kind === "ready" &&
      latest.userId === credential.userId &&
      latest.generation === credential.generation
    );
  } catch {
    return false;
  }
}

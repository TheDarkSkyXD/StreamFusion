import type { Platform } from "@streamfusion/core/platform";

import type {
  InstallationIdentityRead,
  NetworkRead,
  PlatformReadPath,
  UserTokenRead,
} from "../capabilities/platform-reads";

export function selectPlatformReadPath(input: {
  readonly installation: InstallationIdentityRead;
  readonly network: NetworkRead;
  readonly platform: Platform;
  readonly userToken: UserTokenRead;
}): PlatformReadPath {
  if (input.network === "offline") {
    return unavailable(input.platform, "offline");
  }
  if (input.userToken.kind === "ready") {
    return { kind: "direct", platform: input.platform };
  }
  return { kind: "relay", platform: input.platform };
}

export function followedStreamsPath(input: {
  readonly platform: Platform;
  readonly userToken: UserTokenRead;
}): PlatformReadPath {
  if (input.userToken.kind === "ready") {
    return { kind: "direct", platform: input.platform };
  }
  if (input.userToken.kind === "auth-lost") {
    return unavailable(input.platform, "auth-lost");
  }
  return unavailable(input.platform, "signed-out-login-required");
}

function unavailable(
  platform: Platform,
  reason: Extract<PlatformReadPath, { kind: "unavailable" }>["reason"],
): PlatformReadPath {
  return { kind: "unavailable", platform, reason };
}

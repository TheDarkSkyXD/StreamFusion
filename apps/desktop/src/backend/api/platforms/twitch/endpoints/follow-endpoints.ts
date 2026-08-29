import type { TwitchFollowWriteCredential } from "@backend/auth/twitch-follow-write-credential";

const TWITCH_GQL_ENDPOINT = "https://gql.twitch.tv/gql";
const FOLLOW_WRITE_TIMEOUT_MS = 10_000;
const OPERATIONS = {
  follow: {
    name: "FollowButton_FollowUser",
    sha256Hash: "800e7346bdf7e5278a3c1d3f21b2b56e2639928f86815677a7126b093b2fdd08",
  },
  unfollow: {
    name: "FollowButton_UnfollowUser",
    sha256Hash: "f7dae976ebf41c755ae2d758546bfd176b4eeb856656098bb40e0a672ca0d880",
  },
} as const;

interface TwitchFollowRequest {
  action: keyof typeof OPERATIONS;
  channelId: string;
  credential: Pick<TwitchFollowWriteCredential, "clientId" | "accessToken">;
}

interface TwitchFollowDependencies {
  fetch?: typeof fetch;
}

export class TwitchFollowWriteError extends Error {
  readonly name = "TwitchFollowWriteError";

  constructor(
    readonly code: "authorization-required" | "transient",
    message: string
  ) {
    super(message);
  }
}

export async function writeTwitchAccountFollow(
  request: TwitchFollowRequest,
  dependencies: TwitchFollowDependencies = {}
): Promise<{ status: "accepted" }> {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const operation = OPERATIONS[request.action];
  const input =
    request.action === "follow"
      ? { disableNotifications: false, targetID: request.channelId }
      : { targetID: request.channelId };
  let response: Response;
  try {
    response = await fetchImpl(TWITCH_GQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${request.credential.accessToken}`,
        "Client-Id": request.credential.clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        extensions: {
          persistedQuery: {
            sha256Hash: operation.sha256Hash,
            version: 1,
          },
        },
        operationName: operation.name,
        variables: { input },
      }),
      signal: AbortSignal.timeout(FOLLOW_WRITE_TIMEOUT_MS),
    });
  } catch {
    throw new TwitchFollowWriteError(
      "transient",
      "Twitch could not confirm the follow change. Try again."
    );
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new TwitchFollowWriteError(
        "authorization-required",
        "Reconnect Twitch follow access, then try again."
      );
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new TwitchFollowWriteError(
        "transient",
        "Twitch could not confirm the follow change. Try again."
      );
    }
    throw new Error(`Twitch follow request failed (${response.status}).`);
  }

  const result = (await response.json()) as { errors?: Array<{ message?: string }> };
  if (result.errors?.length) {
    const message = result.errors[0]?.message?.toLowerCase() ?? "";
    if (/(auth|integrity|permission|scope)/.test(message)) {
      throw new TwitchFollowWriteError(
        "authorization-required",
        "Reconnect Twitch follow access, then try again."
      );
    }
    throw new TwitchFollowWriteError(
      "transient",
      "Twitch could not confirm the follow change. Try again."
    );
  }

  return { status: "accepted" };
}

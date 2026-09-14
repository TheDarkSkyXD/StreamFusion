import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import type { FollowingSession } from "@mobile/features/follows/capabilities/following-session";

import type { FollowView } from "../capabilities/platform-reads";
import { composeGuestFollowView } from "../domain/channel-follow";

export function membershipQueryKey(): readonly ["follows", "membership"] {
  return ["follows", "membership"];
}

export function useChannelFollow(input: {
  readonly channel: ChannelIdentity;
  readonly enabled?: boolean;
  readonly following: FollowingSession;
}): {
  readonly follow: FollowView;
  readonly openProviderPage: () => void;
  readonly toggle: () => void;
} {
  const queryClient = useQueryClient();
  const enabled = input.enabled !== false;
  const membership = useQuery({
    enabled,
    queryFn: () => input.following.listMembership(),
    queryKey: membershipQueryKey(),
    retry: false,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const membershipError =
    membership.isError && membership.data === undefined
      ? membershipFailureCopy(membership.error)
      : null;
  return {
    follow: composeGuestFollowView({
      channel: input.channel,
      error: error ?? membershipError,
      membership: membership.data ?? [],
      pending: pending || (enabled && membership.isLoading),
    }),
    openProviderPage() {
      void input.following.openProviderPage({
        channelLogin: input.channel.username,
        platform: input.channel.platform,
      });
    },
    toggle() {
      if (pending) return;
      void mutateFollow({
        channel: input.channel,
        following: input.following,
        queryClient,
        setError,
        setPending,
      });
    },
  };
}

async function mutateFollow(input: {
  readonly channel: ChannelIdentity;
  readonly following: FollowingSession;
  readonly queryClient: ReturnType<typeof useQueryClient>;
  readonly setError: (reason: string | null) => void;
  readonly setPending: (pending: boolean) => void;
}): Promise<void> {
  input.setPending(true);
  input.setError(null);
  try {
    const result = await input.following.mutateFollow({
      channelId: input.channel.id,
      channelLogin: input.channel.username,
      platform: input.channel.platform,
    });
    if (result.kind === "rejected") {
      input.setError(rejectedCopy(result.reason));
      return;
    }
    await input.queryClient.invalidateQueries({ queryKey: ["follows"] });
  } catch {
    input.setError("Guest Follow could not be saved.");
  } finally {
    input.setPending(false);
  }
}

function membershipFailureCopy(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return "Guest Follows could not be loaded.";
}

function rejectedCopy(
  reason: "guest-only-scope" | "unresolved-channel" | "invalid",
): string {
  if (reason === "unresolved-channel") {
    return "That channel could not be found for a Guest Follow.";
  }
  if (reason === "invalid") return "Guest Follow could not be saved.";
  return "Guest Follows stay on this device and cannot use a signed-in account write.";
}

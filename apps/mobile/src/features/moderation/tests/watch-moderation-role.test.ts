import { describe, expect, it, vi } from "vitest";
import type {
  AuthenticatedPlatformAccess,
  PlatformAccess,
} from "@mobile/features/auth/capabilities/platform-access";
import type {
  ModerationChannel,
  ModerationGateway,
} from "../capabilities/moderation";
import { readWatchModerationRole } from "../domain/watch-moderation-role";

const channel: ModerationChannel = {
  platform: "twitch",
  id: "2",
  login: "channel",
  name: "Channel",
};
const moderator: Extract<PlatformAccess, { kind: "ready" }> = {
  kind: "ready",
  platform: "twitch",
  accessToken: "token",
  clientId: "client",
  userId: "1",
  username: "moderator",
  generation: 1,
  scopes: ["user:read:moderated_channels"],
};

function setup(account: PlatformAccess = moderator) {
  let current = account;
  const access: AuthenticatedPlatformAccess = {
    read: vi.fn(async () => current),
    subscribe: vi.fn(() => () => undefined),
  };
  const gateway: Pick<ModerationGateway, "verify"> = {
    verify: vi.fn(async () => ({ kind: "success", value: "moderator" })),
  };
  return {
    access,
    gateway,
    change(next: PlatformAccess) {
      current = next;
    },
  };
}

describe("watch chat moderation role", () => {
  it("shows a verified moderator for the current channel", async () => {
    const { access, gateway } = setup();
    expect(
      await readWatchModerationRole({
        access,
        gateway,
        channel,
        signal: new AbortController().signal,
      }),
    ).toBe(true);
    expect(gateway.verify).toHaveBeenCalledWith(
      channel,
      moderator,
      expect.any(AbortSignal),
    );
  });

  it("shows the signed-in broadcaster after verification", async () => {
    const owner = { ...moderator, userId: channel.id, scopes: [] };
    const { access, gateway } = setup(owner);
    expect(
      await readWatchModerationRole({
        access,
        gateway,
        channel,
        signal: new AbortController().signal,
      }),
    ).toBe(true);
    expect(access.read).toHaveBeenCalledWith("twitch", []);
  });

  it("hides the action for a guest or an unverified user", async () => {
    const guest = setup({
      kind: "blocked",
      reason: "sign-in",
      detail: "Sign in",
    });
    expect(
      await readWatchModerationRole({
        access: guest.access,
        gateway: guest.gateway,
        channel,
        signal: new AbortController().signal,
      }),
    ).toBe(false);
    expect(guest.gateway.verify).not.toHaveBeenCalled();

    const user = setup();
    vi.mocked(user.gateway.verify).mockResolvedValue({
      kind: "failure",
      reason: "permission",
      detail: "No role",
    });
    expect(
      await readWatchModerationRole({
        access: user.access,
        gateway: user.gateway,
        channel,
        signal: new AbortController().signal,
      }),
    ).toBe(false);
  });

  it("discards a role result if the account changes during verification", async () => {
    const { access, gateway, change } = setup();
    vi.mocked(gateway.verify).mockImplementation(async () => {
      change({ ...moderator, userId: "3", generation: 2 });
      return { kind: "success", value: "moderator" };
    });
    expect(
      await readWatchModerationRole({
        access,
        gateway,
        channel,
        signal: new AbortController().signal,
      }),
    ).toBe(false);
  });
});

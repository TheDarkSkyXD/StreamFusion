import { describe, expect, it, vi } from "vitest";
import type {
  AuthenticatedPlatformAccess,
  PlatformAccess,
} from "@mobile/features/auth/capabilities/platform-access";
import type {
  ModerationChannel,
  ModerationGateway,
  ProviderCredential,
  ProviderResult,
} from "../capabilities/moderation";
import { createModerationController } from "../domain/moderation-controller";

const credential: ProviderCredential = {
  kind: "ready",
  platform: "twitch",
  accessToken: "token",
  clientId: "client",
  userId: "1",
  username: "owner",
  generation: 1,
  scopes: [],
};
const channel: ModerationChannel = {
  platform: "twitch",
  id: "2",
  login: "channel",
  name: "Channel",
};
function setup() {
  let account: PlatformAccess = credential;
  const listeners = new Set<() => void>();
  const access: AuthenticatedPlatformAccess = {
    read: vi.fn(async () => account),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const gateway: ModerationGateway = {
    review: vi.fn(async (_channel, tool) => ({
      kind: "success",
      value: { tool, items: [], cursor: null },
    })),
    channels: vi.fn(async () => ({ kind: "success", value: [channel] })),
    verify: vi.fn(async () => ({ kind: "success", value: "moderator" })),
    execute: vi.fn(async () => ({ kind: "success", value: undefined })),
    settings: vi.fn(async () => ({
      kind: "success",
      value: {
        slowMode: false,
        slowSeconds: 30,
        followersOnly: false,
        followerMinutes: 0,
        subscribersOnly: false,
        emoteOnly: false,
        uniqueChat: false,
      },
    })),
    banned: vi.fn(async () => ({
      kind: "success",
      value: { users: [], cursor: null },
    })),
  };
  const controller = createModerationController({ access, gateway });
  return {
    controller,
    gateway,
    access,
    change(next: PlatformAccess, notify = true) {
      account = next;
      if (notify) for (const listener of listeners) listener();
    },
  };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
describe("mobile moderation authority and request lifecycle", () => {
  it("selects a verified channel and submits a ban only once while pending", async () => {
    const { controller, gateway } = setup();
    await controller.loadChannels("twitch");
    await controller.selectChannel(channel);
    expect(controller.getSnapshot().selection).toEqual({
      channel,
      role: "moderator",
    });
    const pending = deferred<ProviderResult<void>>();
    vi.mocked(gateway.execute).mockReturnValueOnce(pending.promise);
    const command = { kind: "ban", userId: "3", reason: "spam" } as const;
    const first = controller.execute(command);
    const second = controller.execute(command);
    await vi.waitFor(() => expect(gateway.execute).toHaveBeenCalledTimes(1));
    expect(controller.getSnapshot().activity).toEqual({
      kind: "pending",
      label: "ban",
    });
    pending.resolve({ kind: "success", value: undefined });
    await Promise.all([first, second]);
    expect(controller.getSnapshot().activity).toEqual({
      kind: "success",
      detail: "ban confirmed by Twitch.",
    });
    expect(vi.mocked(gateway.execute).mock.calls[0]?.slice(0, 3)).toEqual([
      channel,
      command,
      credential,
    ]);
    controller.dispose();
  });
  it("rechecks role authority before destructive actions", async () => {
    const { controller, gateway } = setup();
    await controller.selectChannel(channel);
    vi.mocked(gateway.verify).mockResolvedValueOnce({
      kind: "failure",
      reason: "permission",
      detail: "Moderator role revoked",
    });
    await controller.execute({
      kind: "timeout",
      userId: "3",
      durationSeconds: 600,
      reason: "spam",
    });
    expect(controller.getSnapshot().activity).toEqual({
      kind: "failure",
      detail: "Moderator role revoked",
      scopes: [],
    });
    expect(gateway.execute).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("blocks only an operation missing its required scopes", async () => {
    const { controller, change, gateway } = setup();
    await controller.selectChannel(channel);
    change(
      {
        kind: "blocked",
        reason: "scope",
        detail: "Grant banned-user management",
      },
      false,
    );
    await controller.execute({ kind: "ban", userId: "3", reason: "" });
    expect(controller.getSnapshot().activity).toEqual({
      kind: "failure",
      detail: "Grant banned-user management",
      scopes: ["moderator:manage:banned_users"],
    });
    expect(controller.getSnapshot().selection?.role).toBe("moderator");
    expect(gateway.execute).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("discards a late response after cancellation", async () => {
    const { controller, gateway } = setup();
    await controller.selectChannel(channel);
    const pending = deferred<ProviderResult<void>>();
    vi.mocked(gateway.execute).mockReturnValueOnce(pending.promise);
    const operation = controller.execute({
      kind: "ban",
      userId: "3",
      reason: "",
    });
    await vi.waitFor(() => expect(gateway.execute).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(gateway.execute).mock.calls[0]?.[3];
    controller.cancel();
    expect(signal?.aborted).toBe(true);
    pending.resolve({ kind: "success", value: undefined });
    await operation;
    expect(controller.getSnapshot().activity.kind).toBe("cancelled");
    controller.dispose();
  });
  it("clears authority and rejects stale results when the account changes", async () => {
    const { controller, gateway, change } = setup();
    await controller.selectChannel(channel);
    const pending = deferred<ProviderResult<void>>();
    vi.mocked(gateway.execute).mockReturnValueOnce(pending.promise);
    const operation = controller.execute({
      kind: "ban",
      userId: "3",
      reason: "",
    });
    await vi.waitFor(() => expect(gateway.execute).toHaveBeenCalledTimes(1));
    change({ ...credential, userId: "9", generation: 2 });
    pending.resolve({ kind: "success", value: undefined });
    await operation;
    expect(controller.getSnapshot()).toMatchObject({
      selection: null,
      channels: [],
      activity: {
        kind: "cancelled",
        detail:
          "Account changed. A submitted action may already have been applied. Refresh before retrying.",
      },
    });
    controller.dispose();
  });
  it("does not submit when the account changes during role verification", async () => {
    const { controller, gateway, change } = setup();
    await controller.selectChannel(channel);
    vi.mocked(gateway.verify).mockImplementationOnce(async () => {
      change({ ...credential, generation: 2 }, false);
      return { kind: "success", value: "moderator" };
    });
    await controller.execute({ kind: "ban", userId: "3", reason: "" });
    expect(controller.getSnapshot().activity.kind).toBe("cancelled");
    expect(gateway.execute).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("rejects invalid durations before any provider mutation", async () => {
    const { controller, gateway } = setup();
    await controller.selectChannel(channel);
    await controller.execute({
      kind: "timeout",
      userId: "3",
      durationSeconds: Number.NaN,
      reason: "",
    });
    expect(controller.getSnapshot().activity).toMatchObject({
      kind: "failure",
      detail: "Twitch timeouts must be between 1 second and 14 days.",
    });
    expect(gateway.execute).not.toHaveBeenCalled();
    controller.dispose();
  });
});

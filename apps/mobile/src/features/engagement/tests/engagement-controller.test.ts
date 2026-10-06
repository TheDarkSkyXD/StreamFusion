import { describe, expect, it, vi } from "vitest";
import type {
  AuthenticatedPlatformAccess,
  PlatformAccess,
} from "@mobile/features/auth/capabilities/platform-access";
import type {
  ModerationChannel,
  ProviderCredential,
  ProviderResult,
} from "@mobile/features/moderation/capabilities/moderation";
import type {
  ChannelPrediction,
  EngagementGateway,
  EngagementUpdate,
} from "../capabilities/engagement";
import { createEngagementController } from "../domain/engagement-controller";

const credential: ProviderCredential = {
  kind: "ready",
  platform: "twitch",
  accessToken: "token",
  clientId: "client",
  userId: "10",
  username: "owner",
  generation: 1,
  scopes: [],
};
const channel: ModerationChannel = {
  platform: "twitch",
  id: "10",
  login: "owner",
  name: "Owner",
};
const prediction: ChannelPrediction = {
  id: "prediction",
  title: "Win?",
  status: "ACTIVE",
  winningOutcomeId: null,
  outcomes: [
    { id: "yes", title: "Yes", votes: 12 },
    { id: "no", title: "No", votes: 8 },
  ],
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
  const gateway: EngagementGateway = {
    polls: vi.fn(async () => ({ kind: "success", value: [] })),
    predictions: vi.fn(async () => ({ kind: "success", value: [prediction] })),
    execute: vi.fn(async () => ({
      kind: "success",
      value: {
        kind: "prediction",
        prediction: { ...prediction, status: "LOCKED" },
      },
    })),
  };
  return {
    access,
    gateway,
    controller: createEngagementController({ access, gateway }),
    change(next: PlatformAccess) {
      account = next;
      for (const listener of listeners) listener();
    },
  };
}
describe("engagement account ownership and lifecycle", () => {
  it("loads broadcaster data and applies a provider-confirmed prediction state", async () => {
    const { controller, gateway } = setup();
    await controller.open(channel);
    expect(controller.getSnapshot()).toMatchObject({
      authority: "broadcaster",
      predictions: [prediction],
    });
    await controller.execute({ kind: "lock-prediction", id: "prediction" });
    expect(controller.getSnapshot().predictions[0]?.status).toBe("LOCKED");
    expect(controller.getSnapshot().activity).toEqual({
      kind: "success",
      detail: "lock prediction confirmed by Twitch.",
    });
    expect(vi.mocked(gateway.execute).mock.calls[0]?.slice(0, 3)).toEqual([
      channel,
      { kind: "lock-prediction", id: "prediction" },
      credential,
    ]);
    controller.dispose();
  });
  it("hands viewers and Kick off without fetching owner-only data", async () => {
    const { controller, gateway } = setup();
    await controller.open({ ...channel, id: "20" });
    expect(controller.getSnapshot().authority).toBe("provider");
    expect(gateway.polls).not.toHaveBeenCalled();
    await controller.open({ ...channel, platform: "kick" });
    expect(controller.getSnapshot().authority).toBe("provider");
    await controller.open(channel);
    expect(controller.getSnapshot().authority).toBe("broadcaster");
    controller.dispose();
  });
  it("rejects invalid creation and a winner that is not an outcome", async () => {
    const { controller, gateway } = setup();
    await controller.open(channel);
    await controller.execute({
      kind: "create-poll",
      title: "Next?",
      choices: ["Chess"],
      durationSeconds: 120,
    });
    expect(controller.getSnapshot().activity).toMatchObject({
      kind: "failure",
      detail: "Enter 2 to 5 choices, each up to 25 characters.",
    });
    await controller.execute({
      kind: "resolve-prediction",
      id: "prediction",
      winningOutcomeId: "invented",
    });
    expect(controller.getSnapshot().activity).toMatchObject({
      kind: "failure",
      detail: "Select a winning outcome from this prediction.",
    });
    expect(gateway.execute).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("keeps failures honest and never applies a local prediction result", async () => {
    const { controller, gateway } = setup();
    await controller.open(channel);
    vi.mocked(gateway.execute).mockResolvedValueOnce({
      kind: "failure",
      reason: "permission",
      detail: "Twitch returned 403",
    });
    await controller.execute({ kind: "cancel-prediction", id: "prediction" });
    expect(controller.getSnapshot().predictions[0]?.status).toBe("ACTIVE");
    expect(controller.getSnapshot().activity).toEqual({
      kind: "failure",
      detail: "Twitch returned 403",
      scopes: [],
    });
    controller.dispose();
  });
  it("does not repeat destructive actions while pending and discards account-stale results", async () => {
    const { controller, gateway, change } = setup();
    await controller.open(channel);
    let complete: (result: ProviderResult<EngagementUpdate>) => void = () =>
      undefined;
    vi.mocked(gateway.execute).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const command = { kind: "cancel-prediction", id: "prediction" } as const;
    const first = controller.execute(command);
    const second = controller.execute(command);
    await vi.waitFor(() => expect(gateway.execute).toHaveBeenCalledTimes(1));
    expect(controller.getSnapshot().activity).toEqual({
      kind: "pending",
      label: "cancel prediction",
    });
    const signal = vi.mocked(gateway.execute).mock.calls[0]?.[3];
    change({ ...credential, userId: "20", generation: 2 });
    expect(signal?.aborted).toBe(true);
    complete({
      kind: "success",
      value: {
        kind: "prediction",
        prediction: { ...prediction, status: "CANCELED" },
      },
    });
    await Promise.all([first, second]);
    expect(controller.getSnapshot()).toMatchObject({
      authority: "unchecked",
      predictions: [],
      activity: {
        kind: "cancelled",
        detail:
          "Account changed. A submitted action may already have been applied. Refresh before retrying.",
      },
    });
    controller.dispose();
  });
  it("accepts manage scopes as the official alternative to read scopes", async () => {
    const { controller, access, change } = setup();
    change({
      ...credential,
      scopes: ["channel:manage:polls", "channel:manage:predictions"],
    });
    await controller.open(channel);
    expect(controller.getSnapshot().authority).toBe("broadcaster");
    expect(access.read).toHaveBeenCalledWith("twitch", [
      "channel:manage:polls",
      "channel:manage:predictions",
    ]);
    controller.dispose();
  });
  it("reads only enabled records and requests only their scope", async () => {
    const { controller, access, gateway } = setup();
    await controller.open(channel, { polls: true, predictions: false });
    expect(access.read).toHaveBeenCalledWith("twitch", ["channel:read:polls"]);
    expect(gateway.polls).toHaveBeenCalledOnce();
    expect(gateway.predictions).not.toHaveBeenCalled();
    expect(controller.getSnapshot().predictions).toEqual([]);
    await controller.open(channel, { polls: false, predictions: true });
    expect(access.read).toHaveBeenCalledWith("twitch", [
      "channel:read:predictions",
    ]);
    expect(gateway.polls).toHaveBeenCalledOnce();
    expect(gateway.predictions).toHaveBeenCalledOnce();
    controller.dispose();
  });
});

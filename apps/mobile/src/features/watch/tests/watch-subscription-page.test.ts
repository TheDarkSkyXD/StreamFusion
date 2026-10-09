import { describe, expect, it, vi } from "vitest";

import {
  createExpoWatchSubscriptionPageOpener,
  twitchSubscriptionPageUrl,
} from "../adapters/expo/expo-watch-subscription-page";

const openURL = vi.hoisted(() => vi.fn<(_: string) => Promise<void>>());
vi.mock("expo-linking", () => ({ openURL }));

describe("Twitch subscription page handoff", () => {
  it("encodes the channel login in Twitch's subscription URL", async () => {
    openURL.mockResolvedValueOnce(undefined);
    await createExpoWatchSubscriptionPageOpener().open({
      channelLogin: "some/name",
    });
    expect(openURL).toHaveBeenCalledWith("https://subs.twitch.tv/some%2Fname");
    expect(twitchSubscriptionPageUrl("First Tour")).toBe(
      "https://subs.twitch.tv/First%20Tour",
    );
  });

  it("returns a failed external open to the route", async () => {
    openURL.mockRejectedValueOnce(new Error("No browser"));
    await expect(
      createExpoWatchSubscriptionPageOpener().open({ channelLogin: "ada" }),
    ).rejects.toThrow("No browser");
  });
});

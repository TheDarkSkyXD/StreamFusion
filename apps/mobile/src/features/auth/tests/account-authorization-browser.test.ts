import { beforeEach, describe, expect, it, vi } from "vitest";

const { launch } = vi.hoisted(() => ({ launch: vi.fn(async (_url: string) => undefined) }));
vi.mock("../../../../modules/streamfusion-native-contracts/src/platform", () => ({
  getPlatformModule: () => ({ openAuthorizationTab: launch }),
}));

import { openAccountAuthorization } from "../adapters/account-authorization-browser";

const twitchUrl = "https://www.twitch.tv/activate";
const kickUrl = "https://id.kick.com/oauth/authorize?state=abc";

beforeEach(() => launch.mockReset().mockResolvedValue(undefined));

describe("account authorization browser", () => {
  it.each([twitchUrl, kickUrl])("opens the allowed in-app authorization page %s", async (url) => {
    await openAccountAuthorization(url, { aborted: false });
    expect(launch).toHaveBeenCalledExactlyOnceWith(url);
  });

  it("normalizes the default HTTPS port", async () => {
    await openAccountAuthorization("https://www.twitch.tv:443/activate", { aborted: false });
    expect(launch).toHaveBeenCalledExactlyOnceWith(twitchUrl);
  });

  it("does not launch a cancelled attempt", async () => {
    await openAccountAuthorization(twitchUrl, { aborted: true });
    expect(launch).not.toHaveBeenCalled();
  });

  it.each([
    "http://www.twitch.tv/activate",
    "https://user@www.twitch.tv/activate",
    "https://www.twitch.tv:8443/activate",
    "https://www.twitch.tv/activate#fragment",
    "https://www.twitch.tv.evil/activate",
    "https://id.kick.com/oauth/token",
  ])("rejects unsafe initial URL %s", async (url) => {
    await expect(openAccountAuthorization(url, { aborted: false })).rejects.toThrow(
      "authorization page URL is invalid",
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it("reports a missing Custom Tabs browser", async () => {
    launch.mockRejectedValueOnce(new Error("No Custom Tabs browser"));
    await expect(openAccountAuthorization(twitchUrl, { aborted: false })).rejects.toThrow(
      "Install or enable a browser with Custom Tabs support.",
    );
  });
});
